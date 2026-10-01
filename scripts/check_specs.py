#!/usr/bin/env python3
"""Structural checks for specs written in the current template (spec 0013).

WHAT THIS IS FOR. Four of spec 0013's acceptance criteria were filed as "not
unit-testable — they are prompt behaviour", but they are not: they are claims about
the *artifact* on disk, and a script can read it.

    AC-1  the section set from `specs/README.md` is present
    AC-2  every `AC-N` identifier is unique within its spec
    AC-3  every `AC-N` is referenced in that spec's `## Test plan`
    AC-5  the spec has a row in its directory's `README.md` index

AC-3 is the one that needed a rule to become checkable at all. `specs/0013` covers
AC-2, AC-3 and AC-4 only through the range `AC-1..AC-5`, which nothing in the repo can
expand — so the coverage is real to a human reader and invisible to `plan-verifier`,
which enumerates `AC*` by identifier. This script therefore requires each identifier to
appear LITERALLY in the test plan and rejects range notation by name, so the fix is
legible rather than a mystery mismatch.

WHICH SPECS ARE CHECKED. Only those carrying `## Acceptance criteria (EARS)`. That
heading is the discriminator for the current template, so the 12 specs that predate it
are exempt by construction rather than by a hardcoded list that would rot — spec 0013's
non-goal ("Retrofitting the 12 existing specs") holds without this script knowing their
names.

WHERE THE SECTION LIST COMES FROM. Parsed out of the fenced template in
`specs/README.md`, never copied. `specs/0013-spec-creator.md:125` calls that file the
single source and notes the agent "restates it but does not own it"; a third copy in
here would be the drift it warns about. Add a section to the template and it is enforced
on the next run.

CEILING, not a gap list (root `INSIGHTS.md`, 2026-09-23). This checks the SHAPE of a
spec: headings present, identifiers unique, identifiers cross-referenced, index row
present. It cannot tell whether a criterion is well-formed EARS, whether the test named
against it exists or passes, or whether the spec describes anything true. Those stay
prompt behaviour and live-run review. Anything not listed above is unchecked.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Sections the template lists but a spec may legitimately not carry.
#   [NEEDS CLARIFICATION] — `spec-creator.md` says to delete the heading once it empties.
#   Decisions            — added only after the user answers; documented in the notes,
#                          not the template block.
OPTIONAL_SECTIONS = {"[NEEDS CLARIFICATION]", "Decisions"}

NEW_FORMAT_MARKER = "## Acceptance criteria (EARS)"

AC_RANGE = re.compile(r"AC-\d+\s*\.\.\s*AC-\d+")
AC_ID = re.compile(r"AC-(\d+)")
BOLD_AC = re.compile(r"\*\*(AC-\d+)\*\*")


def relative(path: Path, repo: Path | None) -> str:
    """Repo-relative path for messages, so output is pasteable as `file:line`."""
    if repo is None:
        return path.as_posix()
    try:
        return path.relative_to(repo).as_posix()
    except ValueError:
        return path.as_posix()


def template_sections(repo: Path) -> list[str]:
    """The `## ` headings inside the fenced template block of specs/README.md."""
    readme = (repo / "specs" / "README.md").read_text(encoding="utf-8")
    fence = re.search(r"^```markdown$(.*?)^```$", readme, re.M | re.S)
    if not fence:
        raise SystemExit(
            "specs/README.md has no ```markdown template block — this script reads the "
            "required section list from it, so there is nothing to check against."
        )
    return re.findall(r"^## (.+?)\s*$", fence.group(1), re.M)


def section_body(text: str, name: str) -> str | None:
    """The body under `## <name>`, up to the next `## ` heading.

    Anchored at line start on purpose. A first attempt used `text.split("## Test plan")`
    and matched an inline mention of that name inside a table cell, which reported 12
    false failures on a spec that was actually fine. A heading is a line, not a substring.
    """
    match = re.search(
        rf"^## {re.escape(name)}\s*$(.*?)(?=^## |\Z)", text, re.M | re.S
    )
    return None if match is None else match.group(1)


def has_section(text: str, name: str) -> bool:
    return re.search(rf"^## {re.escape(name)}\s*$", text, re.M) is not None


def covers_cells(plan: str) -> list[str] | None:
    """The first column of the `## Test plan` table — the cells that claim coverage.

    Scanning the whole section instead would be both too generous and too strict: an
    `AC-7` mentioned anywhere in prose would count as covered, and a spec DOCUMENTING
    the range rule (as spec 0013 now does) would be flagged for quoting the notation it
    forbids. Coverage is claimed in the Covers column; everything else is commentary.

    Returns None when the section has no table, so the caller can fall back rather than
    silently treat a prose test plan as covering nothing.
    """
    cells: list[str] = []
    for line in plan.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        parts = [c.strip() for c in line.strip("|").split("|")]
        if not parts:
            continue
        first = parts[0]
        if set(first) <= {"-", ":"} and first:  # the |---|---| separator row
            continue
        # The header row. Measured redundant: a mutation run that removed this skip
        # was the one mutant of nine the suite did NOT catch, because the literal cell
        # "Covers" holds no `AC-N` and no range, so scanning it changes nothing. Kept
        # for legible intent, not as a guard — same treatment as the containment check
        # in .claude/hooks/spec-scope-gate.py (root INSIGHTS.md, 2026-09-30).
        if first.lower() == "covers":
            continue
        cells.append(first)
    return cells or None


def index_files(repo: Path) -> dict[Path, str]:
    """Each specs directory's README.md text, keyed by directory."""
    out: dict[Path, str] = {}
    for readme in repo.glob("*/specs/README.md"):
        out[readme.parent] = readme.read_text(encoding="utf-8")
    root = repo / "specs" / "README.md"
    if root.exists():
        out[root.parent] = root.read_text(encoding="utf-8")
    return out


def spec_files(repo: Path) -> list[Path]:
    found = sorted(repo.glob("specs/[0-9]*.md")) + sorted(
        repo.glob("*/specs/[0-9]*.md")
    )
    return [p for p in found if p.name != "README.md"]


def check_spec(
    path: Path, text: str, required: list[str], index: str | None, repo: Path | None = None
) -> list[str]:
    """Return a list of failure strings for one spec. Empty means it passed."""
    problems: list[str] = []
    rel = relative(path, repo)

    # AC-1 — the section set.
    for name in required:
        if name in OPTIONAL_SECTIONS:
            continue
        if not has_section(text, name):
            problems.append(f"{rel}: missing section `## {name}` (AC-1)")

    criteria = BOLD_AC.findall(section_body(text, "Acceptance criteria (EARS)") or "")

    # AC-2 — identifiers unique within the spec.
    for ident in sorted(set(criteria), key=lambda s: int(s[3:])):
        if criteria.count(ident) > 1:
            problems.append(
                f"{rel}: `{ident}` is declared {criteria.count(ident)} times; "
                "identifiers are never reused, even after a criterion is deleted (AC-2)"
            )

    # AC-3 — every identifier referenced literally in the test plan.
    plan = section_body(text, "Test plan")
    if plan is None:
        if has_section(text, "Acceptance criteria (EARS)"):
            problems.append(f"{rel}: has criteria but no `## Test plan` (AC-3)")
    else:
        cells = covers_cells(plan)
        scanned = "\n".join(cells) if cells is not None else plan
        for found in AC_RANGE.findall(scanned):
            problems.append(
                f"{rel}: `## Test plan` claims coverage with the range `{found}`. "
                "Enumerate the identifiers instead — nothing in this repo expands a "
                "range, so `plan-verifier` cannot resolve the criteria it hides (AC-3)"
            )
        referenced = set(AC_ID.findall(scanned))
        for ident in sorted(set(criteria), key=lambda s: int(s[3:])):
            if ident[3:] not in referenced:
                problems.append(
                    f"{rel}: `{ident}` is never referenced in `## Test plan` — a "
                    "criterion no test names is untestable or unowned (AC-3)"
                )

    # AC-5 — the index row.
    if index is None:
        problems.append(f"{rel}: its specs directory has no README.md to index it (AC-5)")
    elif path.name not in index:
        problems.append(
            f"{rel}: no row for it in {relative(path.parent, repo)}/README.md — "
            "a spec nobody links is a spec nobody finds (AC-5)"
        )

    return problems


def main(argv: list[str]) -> int:
    repo = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent.parent
    required = template_sections(repo)
    indexes = index_files(repo)

    problems: list[str] = []
    checked = skipped = 0
    for path in spec_files(repo):
        text = path.read_text(encoding="utf-8")
        if NEW_FORMAT_MARKER not in text:
            skipped += 1
            continue
        checked += 1
        found = check_spec(path, text, required, indexes.get(path.parent), repo)
        problems += found
        if found:
            for line in found:
                print(f"FAIL: {line}")
        else:
            print(f"ok: {relative(path, repo)}")

    print(
        f"\n{checked} spec(s) in the current template checked, "
        f"{skipped} predating the template skipped."
    )
    if problems:
        print(f"{len(problems)} problem(s). See scripts/check_specs.py for what is and is not checked.")
        return 1
    print("Sections, criterion identifiers, test-plan coverage and index rows are consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
