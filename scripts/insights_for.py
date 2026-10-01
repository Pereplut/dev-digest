#!/usr/bin/env python3
"""Route INSIGHTS.md entries to the paths a task actually touches.

WHY. The rule was "read root INSIGHTS.md and the INSIGHTS.md of every package you
touch". Measured 2026-10-01, that is 22,542 tokens for a client-only change, 36,820 for
a server-only one and 44,148 for both — before the agent reads a line of code, and
62-71% of its whole intake. The files are append-only, so every session makes the next
one more expensive. Most of it is irrelevant to any given task: the fourteen root
entries about the `git diff` allowlist are real history and near-zero value to someone
writing a React component.

HOW RELEVANCE IS DERIVED, not declared. Every entry's `**Evidence:**` line is mandatory
and carries `path:line` citations — measured across all 171 entries: 171 have an Evidence
line and 165 cite a path. So the routing data already exists and cannot rot, the same
reason `check_specs.py` reads its section list out of `specs/README.md` instead of
keeping a copy. There is no index to maintain and no tag to forget.

NOTHING IS HIDDEN. This prints two sections: the entries that match, with
`file:start-end` so you can `Read` just those, and then the TITLE of every entry it
excluded. The full index of 171 titles costs ~4,256 tokens, so you always see what
exists and can pull any body on a hunch. This is a filter over a visible index, not a
subset pretending to be the whole.

CEILING, not a gap list (root `INSIGHTS.md`, 2026-09-23). It matches on paths an entry
cites. It therefore UNDER-ROUTES a lesson that is universal but happens to cite one
file — "parallel agent shell calls share one working directory" cites `AGENTS.md`, and
applies to everyone. That is why excluded titles are printed rather than dropped, why an
entry citing no path at all is always included, and why `**Applies:** always` exists as a
declared override. It cannot judge relevance by meaning, it does not rank, and it is not
a substitute for reading a title that looks like it matters.

THE SAVING SCALES WITH FOCUS, and collapses without it. Measured on this repo: one
client component routes 170 entries down to 18 (~4.7k tokens instead of ~54.7k), one
server module to 21 — but `--base origin/main` on a 116-path branch matched 165 of 170
and routed away 2.2k, because a change touching every package legitimately needs almost
every entry. Pass the paths of the step you are on. The report says so itself when it
filters less than a fifth away, rather than letting a caller read a big number as a win.

    bash scripts/insights-for.sh server/src/modules/reviews/service.ts
    bash scripts/insights-for.sh --base origin/main
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ENTRY = re.compile(r"^### (.+)$", re.M)
CITED = re.compile(r"`([A-Za-z0-9_./\-]+\.(?:ts|tsx|js|mjs|cjs|py|sh|json|yaml|yml|md|sql))")

# A package INSIGHTS.md is only relevant when that package is touched.
PACKAGES = ("server", "client", "reviewer-core", "mcp", "e2e")


def strip_fences(text: str) -> str:
    """Blank out fenced code blocks, keeping line numbers intact.

    The header of every INSIGHTS.md shows the entry format inside a ```markdown fence,
    complete with a `### YYYY-MM-DD — [tag] Short title` line. Parsing that as a real
    entry put a phantom row in the index on the first run.
    """
    out, fenced = [], False
    for line in text.split("\n"):
        if line.lstrip().startswith("```"):
            fenced = not fenced
            out.append("")
            continue
        out.append("" if fenced else line)
    return "\n".join(out)


class Entry:
    def __init__(self, source: str, title: str, start: int, end: int, body: str):
        self.source = source
        self.title = title
        self.start = start  # 1-based line of the `### ` heading
        self.end = end
        self.bytes = len(body)
        evidence = body.split("**Evidence:**")[-1] if "**Evidence:**" in body else ""
        self.cited = set(CITED.findall(evidence))
        # The one declared escape from path routing, for a lesson that is universal but
        # cites one file. Derived routing cannot infer this; see the module docstring.
        self.always = bool(re.search(r"\*\*Applies:\*\*\s*always", body))


def collect(repo: Path) -> list[Entry]:
    sources = [repo / "INSIGHTS.md"] + sorted(
        p for pkg in PACKAGES if (p := repo / pkg / "INSIGHTS.md").exists()
    )
    out: list[Entry] = []
    for path in sources:
        if not path.exists():
            continue
        text = strip_fences(path.read_text(encoding="utf-8"))
        rel = path.relative_to(repo).as_posix()
        marks = list(ENTRY.finditer(text))
        for i, m in enumerate(marks):
            stop = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            line = text.count("\n", 0, m.start()) + 1
            end = text.count("\n", 0, stop) + 1
            out.append(Entry(rel, m.group(1), line, end, text[m.start():stop]))
    return out


def dirname(p: str) -> str:
    return p.rsplit("/", 1)[0] if "/" in p else ""


def relevant(entry: Entry, changed: list[str]) -> bool:
    """Does this entry bear on any changed path?"""
    if entry.always:
        return True  # declared universal, overrides path routing
    pkg = entry.source.split("/")[0] if "/" in entry.source else None
    if pkg and not any(c == pkg or c.startswith(pkg + "/") for c in changed):
        return False  # a package's own insights, package untouched
    if not entry.cited:
        return True  # cites no path — fail safe toward including it
    for cited in entry.cited:
        cd = dirname(cited)
        for c in changed:
            chd = dirname(c)
            if cited == c:
                return True
            if cd and (chd == cd or chd.startswith(cd + "/") or cd.startswith(chd + "/")):
                return True
    return False


def changed_from_git(repo: Path, base: str) -> list[str]:
    """Paths changed against `base`, plus untracked files.

    `base` comes from the operator's argv, and git parses options anywhere before the
    end-of-options marker — so a `base` beginning with `-` is read as a FLAG, not a
    revision, and `git diff` has flags that write and truncate a path (`--output=`).
    Without the guard below, `--base --output=/some/file` would turn this read-only tool
    into one that clobbers that file. Root `INSIGHTS.md` carries nine entries on exactly
    this escape, and this repo's own PreToolUse gate denies the shape by name.

    `--end-of-options` (git >= 2.24) is the right separator, not a bare `--`: `--` would
    make git read `base` as a pathspec rather than a revision.
    """
    if base.startswith("-"):
        raise SystemExit(
            f"--base must be a git revision, not an option: {base!r}. "
            "git reads a leading '-' as a flag, and some git flags write files."
        )
    resolved = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--verify", "--quiet",
         "--end-of-options", f"{base}^{{commit}}"],
        capture_output=True, text=True, check=False,
    )
    if resolved.returncode != 0:
        raise SystemExit(
            f"--base {base!r} does not resolve to a commit in {repo}. "
            "Left unchecked this returns an empty path list and a report that looks fine."
        )
    out = subprocess.run(
        ["git", "-C", str(repo), "diff", "--name-only", "--end-of-options", base],
        capture_output=True, text=True, check=False,
    )
    tracked = [l.strip() for l in out.stdout.splitlines() if l.strip()]
    untracked = subprocess.run(
        ["git", "-C", str(repo), "ls-files", "--others", "--exclude-standard"],
        capture_output=True, text=True, check=False,
    )
    return tracked + [l.strip() for l in untracked.stdout.splitlines() if l.strip()]


def report(entries: list[Entry], changed: list[str]) -> str:
    hit = [e for e in entries if relevant(e, changed)]
    miss = [e for e in entries if e not in hit]
    read_cost = sum(e.bytes for e in hit)
    all_cost = sum(e.bytes for e in entries)
    lines: list[str] = []

    lines.append(f"# INSIGHTS for {len(changed)} changed path(s)")
    lines.append("")
    lines.append(
        f"{len(hit)} of {len(entries)} entries bear on these paths. Read those bodies; the rest "
        "are listed by title below so you can pull any of them if a title looks relevant."
    )
    lines.append(
        "Routing is by the paths each entry's `**Evidence:**` line cites, so a universal lesson "
        "that happens to cite one file can be under-routed — the titles are the backstop."
    )
    lines.append("")
    lines.append("## Read these")
    lines.append("")
    current = None
    for e in hit:
        if e.source != current:
            current = e.source
            lines.append(f"**{e.source}**")
        lines.append(f"- `{e.source}:{e.start}-{e.end}` — {e.title}")
    if not hit:
        lines.append("_none matched; read the titles below._")
    lines.append("")
    lines.append(f"## Index of the other {len(miss)} entries (titles only)")
    lines.append("")
    current = None
    for e in miss:
        if e.source != current:
            current = e.source
            lines.append(f"**{e.source}**")
        lines.append(f"- {e.title}  (`:{e.start}`)")
    lines.append("")
    lines.append("## Per file")
    lines.append("")
    for src in dict.fromkeys(e.source for e in entries):
        h = sum(1 for e in hit if e.source == src)
        n = sum(1 for e in entries if e.source == src)
        pkg = src.split("/")[0] if "/" in src else None
        untouched = pkg is not None and not any(
            c == pkg or c.startswith(pkg + "/") for c in changed
        )
        if untouched:
            note = "  (package not touched)"
        elif h == 0:
            note = "  ← nothing matched although this file is in scope; skim its titles"
        else:
            note = ""
        lines.append(f"- `{src}`: {h}/{n} matched{note}")
    lines.append("")
    saved = all_cost - read_cost
    lines.append(
        f"Bodies to read: {read_cost} bytes (~{read_cost // 4} tokens). "
        f"All bodies would be {all_cost} (~{all_cost // 4}); this routes away "
        f"{saved} bytes (~{saved // 4} tokens)."
    )
    if entries and len(hit) / len(entries) > 0.8:
        lines.append("")
        lines.append(
            f"**This filtered almost nothing** ({len(hit)}/{len(entries)}). That is what a wide "
            f"path set does — {len(changed)} paths across several packages legitimately touch most "
            "entries. Pass the paths of the step you are on rather than a whole branch diff; "
            "`--base origin/main` on a long-lived branch is the worst case for this tool."
        )
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    args = argv[1:]
    repo = Path(__file__).resolve().parent.parent
    if args and args[0] == "--repo":
        repo = Path(args[1])
        args = args[2:]
    if args and args[0] == "--base":
        changed = changed_from_git(repo, args[1] if len(args) > 1 else "origin/main")
    else:
        changed = args
    if not changed:
        print(
            "usage: insights-for.sh <changed path>...  |  insights-for.sh --base <ref>\n"
            "Prints the INSIGHTS entries that bear on those paths, plus the titles of the rest.",
            file=sys.stderr,
        )
        return 2
    print(report(collect(repo), changed))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
