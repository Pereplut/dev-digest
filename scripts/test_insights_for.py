#!/usr/bin/env python3
"""Tests for scripts/insights_for.py.

Every rule gets a PAIRED NEGATIVE — a filter that includes everything and a filter that
includes nothing both "work" on a one-sided suite, and this one decides what an agent
reads, so a silent over- or under-match is expensive either way.

Two cases are regressions, not hypotheticals, both caught on the first live run:
  - the `### YYYY-MM-DD — [tag] Short title` line inside each INSIGHTS.md header's
    ```markdown fence was parsed as a real entry;
  - routing by cited path alone gave root INSIGHTS.md zero matches for a client change,
    which is why `**Applies:** always` exists.

Run: python3 -m unittest discover -s scripts -p 'test_insights_for.py'
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import insights_for  # noqa: E402

HEADER = """# Insights

Entry format:

```markdown
### YYYY-MM-DD — [tag] Short title
**Context:** what you were doing.
**Evidence:** `path/to/file.ts:42`
```

---

"""


def entry(title, evidence, applies=False):
    extra = "**Applies:** always\n" if applies else ""
    return (
        f"### {title}\n"
        f"**Context:** ctx.\n"
        f"**Insight:** fact.\n"
        f"{extra}"
        f"**Apply:** do the thing.\n"
        f"**Evidence:** {evidence}\n\n"
    )


class Repo:
    """A throwaway repo with a root and package INSIGHTS.md."""

    def __init__(self, root_entries="", server_entries="", client_entries=""):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        (self.repo / "INSIGHTS.md").write_text(HEADER + root_entries, encoding="utf-8")
        for pkg, body in (("server", server_entries), ("client", client_entries)):
            if body:
                (self.repo / pkg).mkdir(parents=True, exist_ok=True)
                (self.repo / pkg / "INSIGHTS.md").write_text(HEADER + body, encoding="utf-8")

    def titles(self, changed):
        es = insights_for.collect(self.repo)
        return [e.title for e in es if insights_for.relevant(e, changed)]

    def all_titles(self):
        return [e.title for e in insights_for.collect(self.repo)]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.dir.cleanup()


class RoutingTest(unittest.TestCase):
    # --- the fenced-template regression ---

    def test_the_format_example_in_the_header_is_not_an_entry(self):
        with Repo(root_entries=entry("real one", "`AGENTS.md:1`")) as r:
            self.assertEqual(r.all_titles(), ["real one"])

    # --- path routing, both directions ---

    def test_an_entry_citing_a_touched_directory_matches(self):
        body = entry("server reviews thing", "`server/src/modules/reviews/service.ts:10`")
        with Repo(server_entries=body) as r:
            self.assertEqual(
                r.titles(["server/src/modules/reviews/routes.ts"]), ["server reviews thing"]
            )

    def test_an_entry_citing_an_untouched_area_does_not_match(self):
        """The paired negative: same fixture, a path nowhere near it."""
        body = entry("server reviews thing", "`server/src/modules/reviews/service.ts:10`")
        with Repo(server_entries=body) as r:
            self.assertEqual(r.titles(["server/src/db/schema/reviews.ts"]), [])

    def test_a_package_file_is_skipped_when_its_package_is_untouched(self):
        with Repo(server_entries=entry("srv", "`server/src/a.ts:1`"),
                  client_entries=entry("cli", "`client/src/b.tsx:1`")) as r:
            self.assertEqual(r.titles(["client/src/b.tsx"]), ["cli"])
            self.assertEqual(r.titles(["server/src/a.ts"]), ["srv"])

    def test_the_package_gate_holds_even_when_the_entry_cites_the_other_package(self):
        """What makes the package gate load-bearing rather than redundant.

        A cross-package entry in `server/INSIGHTS.md` that cites a CLIENT path would
        match on path alone during a client-only change. The gate is the only thing that
        keeps a package's insights scoped to that package. A mutation run that removed
        the gate survived until this case existed.
        """
        body = entry("server note about a client file", "`client/src/b.tsx:1`")
        with Repo(server_entries=body) as r:
            self.assertEqual(
                r.titles(["client/src/b.tsx"]), [],
                "a server insight leaked into a client-only change",
            )
            self.assertEqual(
                r.titles(["server/src/a.ts", "client/src/b.tsx"]),
                ["server note about a client file"],
                "it should return once the server IS touched",
            )

    # --- the Applies:always escape, and that it is actually needed ---

    def test_applies_always_matches_regardless_of_path(self):
        body = entry("universal lesson", "`AGENTS.md:3`", applies=True)
        with Repo(root_entries=body) as r:
            self.assertEqual(r.titles(["client/src/x.tsx"]), ["universal lesson"])
            self.assertEqual(r.titles(["server/src/y.ts"]), ["universal lesson"])

    def test_without_the_marker_the_same_entry_would_be_missed(self):
        """The paired negative that justifies the marker existing at all."""
        body = entry("universal lesson", "`AGENTS.md:3`", applies=False)
        with Repo(root_entries=body) as r:
            self.assertEqual(r.titles(["client/src/x.tsx"]), [])

    # --- the fail-safe for an entry with no citation ---

    def test_an_entry_citing_no_path_is_always_included(self):
        body = entry("no citable path", "a measurement, no file")
        with Repo(root_entries=body) as r:
            self.assertEqual(r.titles(["client/src/x.tsx"]), ["no citable path"])

    # --- the report tells the whole truth ---

    def test_the_report_lists_every_excluded_title(self):
        with Repo(root_entries=entry("kept", "`client/src/a.tsx:1`") +
                               entry("routed away", "`server/src/b.ts:1`")) as r:
            out = insights_for.report(insights_for.collect(r.repo), ["client/src/a.tsx"])
            self.assertIn("kept", out)
            self.assertIn("routed away", out, "an excluded entry vanished from the index")
            self.assertIn("## Index of the other 1 entries", out)

    def test_the_report_flags_an_in_scope_file_that_matched_nothing(self):
        with Repo(root_entries=entry("elsewhere", "`server/src/b.ts:1`")) as r:
            out = insights_for.report(insights_for.collect(r.repo), ["client/src/a.tsx"])
            self.assertIn("nothing matched although this file is in scope", out)

    def test_an_untouched_package_is_not_flagged_as_a_concern(self):
        with Repo(root_entries=entry("root", "`client/src/a.tsx:1`"),
                  server_entries=entry("srv", "`server/src/b.ts:1`")) as r:
            out = insights_for.report(insights_for.collect(r.repo), ["client/src/a.tsx"])
            self.assertIn("(package not touched)", out)


class ChangedFromGitTest(unittest.TestCase):
    """`changed_from_git` had NO test, which is why an argument-injection shape in it
    survived to review. These cover the argv handling specifically."""

    repo = Path(__file__).resolve().parent.parent

    def test_an_option_shaped_base_is_refused(self):
        """`--base --output=<path>` must never reach git: that flag writes and truncates."""
        for hostile in ("--output=/tmp/pwned", "-o", "--no-index"):
            with self.subTest(base=hostile):
                with self.assertRaises(SystemExit) as caught:
                    insights_for.changed_from_git(self.repo, hostile)
                self.assertIn("not an option", str(caught.exception))

    def test_a_ref_that_does_not_resolve_is_refused(self):
        """The paired negative for the silent-empty-result path."""
        with self.assertRaises(SystemExit) as caught:
            insights_for.changed_from_git(self.repo, "no-such-ref-xyz")
        self.assertIn("does not resolve", str(caught.exception))

    def test_a_real_ref_is_accepted(self):
        """The positive: the guards must not reject a legitimate revision."""
        paths = insights_for.changed_from_git(self.repo, "HEAD")
        self.assertIsInstance(paths, list)


class RealRepoTest(unittest.TestCase):
    """Against the real tree, so the fixtures cannot drift from reality."""

    repo = Path(__file__).resolve().parent.parent

    def test_every_entry_parses_and_most_cite_a_path(self):
        es = insights_for.collect(self.repo)
        self.assertGreater(len(es), 100, "entry parsing broke")
        cited = sum(1 for e in es if e.cited)
        self.assertGreater(cited / len(es), 0.9, "citation rate dropped; routing degrades")

    def test_routing_actually_reduces_the_read(self):
        es = insights_for.collect(self.repo)
        changed = ["client/src/app/x/_components/Foo/Foo.tsx"]
        hit = [e for e in es if insights_for.relevant(e, changed)]
        self.assertLess(len(hit), len(es) / 2, "the filter is not filtering")
        self.assertGreater(len(hit), 0, "the filter excludes everything")

    def test_the_universal_entries_are_marked_and_route_everywhere(self):
        es = insights_for.collect(self.repo)
        always = [e for e in es if e.always]
        self.assertGreater(len(always), 0, "no entry carries **Applies:** always")
        for e in always:
            self.assertTrue(insights_for.relevant(e, ["mcp/src/registry.ts"]), e.title)


if __name__ == "__main__":
    unittest.main(verbosity=2)
