#!/usr/bin/env python3
"""Tests for scripts/check_specs.py.

Every rule gets a PAIRED NEGATIVE: the failing case and the same fixture with only the
offending part fixed. Root `INSIGHTS.md` (2026-09-23, 2026-09-30) records why — a guard
suite that only ever asserts the happy path passes at full green while the hole is open,
and `test_spec_scope_gate.py` found exactly one blind guard that way.

The `## Test plan` heading-anchor case is a real regression, not a hypothetical: the
first version of this checker split on the substring and reported 12 false failures on a
spec that was fine, because `specs/0013-spec-creator.md` mentions `## Test plan` inside a
`## Decisions` table cell.

Run: python3 -m unittest discover -s scripts -p 'test_check_specs.py'
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # a sibling import must not litter scripts/__pycache__
sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_specs  # noqa: E402

TEMPLATE_README = """# specs

File name: `NNNN-short-name.md`. Template:

```markdown
---
title: Example
status: draft
packages: [server]
---

## Problem & why
## Goals / Non-goals
## Acceptance criteria (EARS)
## Test plan
## Phases
```

## Index
| Spec | Status | Packages |
|---|---|---|
| [0001-example](0001-example.md) | draft | server |
"""

GOOD_SPEC = """---
title: Example
status: draft
packages: [server]
---

## Problem & why
Something is wrong.

## Goals / Non-goals
Goals.

## Acceptance criteria (EARS)

| ID | Criterion | Pattern |
|---|---|---|
| **AC-1** | The API shall do a thing. | ubiquitous |
| **AC-2** | WHEN x, the API shall do another thing. | event-driven |

## Test plan

| Covers | Test |
|---|---|
| AC-1 | `test_one` |
| AC-2 | `test_two` |

## Phases

| Phase | Date | Note |
|---|---|---|
| Initiation | | |
"""


class Fixture:
    """A throwaway repo with specs/README.md and one spec."""

    def __init__(self, spec_text: str = GOOD_SPEC, readme: str = TEMPLATE_README,
                 name: str = "0001-example.md"):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        (self.repo / "specs").mkdir()
        (self.repo / "specs" / "README.md").write_text(readme, encoding="utf-8")
        (self.repo / "specs" / name).write_text(spec_text, encoding="utf-8")

    def run(self) -> list[str]:
        required = check_specs.template_sections(self.repo)
        indexes = check_specs.index_files(self.repo)
        problems: list[str] = []
        for path in check_specs.spec_files(self.repo):
            text = path.read_text(encoding="utf-8")
            if check_specs.NEW_FORMAT_MARKER not in text:
                continue
            problems += check_specs.check_spec(
                path, text, required, indexes.get(path.parent), self.repo
            )
        return problems

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.dir.cleanup()


class SpecCheckTest(unittest.TestCase):
    def assertProblem(self, problems: list[str], needle: str):
        self.assertTrue(
            any(needle in p for p in problems),
            f"expected a problem containing {needle!r}, got {problems}",
        )

    # --- the baseline. If this ever fails, every negative below is meaningless. ---

    def test_a_well_formed_spec_passes(self):
        with Fixture() as f:
            self.assertEqual(f.run(), [])

    # --- AC-1: the section set, paired ---

    def test_a_missing_section_fails(self):
        with Fixture(GOOD_SPEC.replace("## Goals / Non-goals\nGoals.\n", "")) as f:
            self.assertProblem(f.run(), "missing section `## Goals / Non-goals` (AC-1)")

    def test_the_required_list_comes_from_the_readme_template(self):
        """Adding a section to the template makes it required, with no code change."""
        readme = TEMPLATE_README.replace(
            "## Acceptance criteria (EARS)", "## Untrusted inputs\n## Acceptance criteria (EARS)"
        )
        with Fixture(readme=readme) as f:
            self.assertProblem(f.run(), "missing section `## Untrusted inputs` (AC-1)")
        # ...and the same spec with that section present passes again.
        fixed = GOOD_SPEC.replace(
            "## Acceptance criteria (EARS)", "## Untrusted inputs\nNone.\n\n## Acceptance criteria (EARS)"
        )
        with Fixture(fixed, readme=readme) as f:
            self.assertEqual(f.run(), [])

    def test_an_optional_section_is_not_required(self):
        readme = TEMPLATE_README.replace(
            "## Test plan", "## [NEEDS CLARIFICATION]\n## Test plan"
        )
        with Fixture(readme=readme) as f:
            self.assertEqual(f.run(), [])

    # --- AC-2: unique identifiers, paired ---

    def test_a_reused_identifier_fails(self):
        with Fixture(GOOD_SPEC.replace("| **AC-2** |", "| **AC-1** |")) as f:
            self.assertProblem(f.run(), "`AC-1` is declared 2 times")

    # --- AC-3: test-plan coverage and the range rule, paired ---

    def test_a_criterion_absent_from_the_test_plan_fails(self):
        with Fixture(GOOD_SPEC.replace("| AC-2 | `test_two` |\n", "")) as f:
            self.assertProblem(f.run(), "`AC-2` is never referenced in `## Test plan`")

    def test_range_notation_is_rejected_even_though_it_covers_every_criterion(self):
        """The exact shape specs/0013 used: a range a human reads and a machine cannot."""
        ranged = GOOD_SPEC.replace(
            "| AC-1 | `test_one` |\n| AC-2 | `test_two` |",
            "| AC-1..AC-2 | a live run |",
        )
        with Fixture(ranged) as f:
            self.assertProblem(f.run(), "claims coverage with the range `AC-1..AC-2`")

    def test_the_range_rule_reads_the_covers_column_not_the_prose(self):
        """A spec may DOCUMENT the notation it forbids without tripping the rule.

        spec 0013's own test plan now explains that `AC-1..AC-5` is rejected; scanning
        the whole section flagged it for quoting the rule. Coverage is claimed in the
        first column, so that is what the rule reads.
        """
        documented = GOOD_SPEC.replace(
            "| AC-2 | `test_two` |",
            "| AC-2 | `test_two`, which rejects range notation such as `AC-1..AC-9` |",
        )
        with Fixture(documented) as f:
            self.assertEqual(
                f.run(), [], "the notation was flagged in prose rather than in Covers"
            )

    def test_an_identifier_only_in_prose_does_not_count_as_covered(self):
        """The other direction: mentioning an id in the Test column is not coverage."""
        prose_only = GOOD_SPEC.replace(
            "| AC-2 | `test_two` |", "| AC-1 | also exercises AC-2 incidentally |"
        )
        with Fixture(prose_only) as f:
            self.assertProblem(f.run(), "`AC-2` is never referenced in `## Test plan`")

    def test_enumerating_the_same_criteria_passes(self):
        """The paired positive: same coverage, spelled out, is accepted."""
        enumerated = GOOD_SPEC.replace(
            "| AC-1 | `test_one` |\n| AC-2 | `test_two` |",
            "| AC-1, AC-2 | a live run |",
        )
        with Fixture(enumerated) as f:
            self.assertEqual(f.run(), [])

    def test_a_missing_test_plan_fails(self):
        without = GOOD_SPEC.split("## Test plan")[0] + "## Phases\n\n| Phase |\n|---|\n"
        with Fixture(without) as f:
            self.assertProblem(f.run(), "missing section `## Test plan` (AC-1)")

    # --- the regression that motivated the anchored regex ---

    def test_an_inline_mention_of_a_heading_is_not_a_heading(self):
        """`## Test plan` named inside a table cell must not be parsed as the section.

        This is what broke the first version: the real test plan was skipped and every
        criterion looked uncovered.
        """
        with_mention = GOOD_SPEC.replace(
            "## Goals / Non-goals\nGoals.",
            "## Goals / Non-goals\n\n| Question | Decision |\n|---|---|\n"
            "| Keep the wrapper? | Yes — frontmatter, `## Test plan` and `## Phases` stay |",
        )
        with Fixture(with_mention) as f:
            self.assertEqual(
                f.run(), [], "an inline mention was parsed as the heading again"
            )

    # --- AC-5: the index row, paired ---

    def test_a_spec_with_no_index_row_fails(self):
        with Fixture(readme=TEMPLATE_README.replace(
            "| [0001-example](0001-example.md) | draft | server |\n", ""
        )) as f:
            self.assertProblem(f.run(), "no row for it in specs/README.md")

    # --- the exemption for specs predating the template ---

    def test_a_spec_predating_the_template_is_skipped(self):
        old = "---\ntitle: Old\nstatus: done\n---\n\n## Problem\n## Scope\n## Design\n"
        with Fixture(old) as f:
            self.assertEqual(f.run(), [], "a pre-template spec must not be checked")


class RepoTest(unittest.TestCase):
    """The checker against the real repo, so the fixtures cannot drift from reality."""

    def test_the_real_template_block_parses(self):
        repo = Path(__file__).resolve().parent.parent
        sections = check_specs.template_sections(repo)
        self.assertIn("Acceptance criteria (EARS)", sections)
        self.assertIn("Test plan", sections)
        self.assertIn("Untrusted inputs", sections)

    def test_the_repo_has_specs_in_the_current_template(self):
        """If this ever hits zero the checker is passing vacuously."""
        repo = Path(__file__).resolve().parent.parent
        current = [
            p for p in check_specs.spec_files(repo)
            if check_specs.NEW_FORMAT_MARKER in p.read_text(encoding="utf-8")
        ]
        self.assertGreater(len(current), 0, "no spec uses the current template")


if __name__ == "__main__":
    unittest.main(verbosity=2)
