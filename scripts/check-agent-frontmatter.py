#!/usr/bin/env python3
"""Run-once-per-change checks over `.claude/agents/*.md` frontmatter (spec 0015, S19).

WHAT THIS IS FOR. `scripts/check-claude-skills.sh` validates skills, hooks and
`settings.json`, but it does not walk `.claude/agents/` at all
(`.claude/agents/README.md:283-291`: "Not covered by CI"). That left three claims
about the agent roster checkable only by eyeballing the files:

    AC-9  architecture-reviewer.md's frontmatter `model` is `sonnet`
    AC-10 plan-verifier.md's frontmatter `model` is `sonnet`
    AC-11 the README catalog's Model column agrees with each agent's own file

Spec 0015 files this as a declined non-goal for CI WIRING ("CI over
`.claude/agents/**` frontmatter", `specs/0015-impl-skill.md:72-74`) but not for
the CHECK itself — AC-9/AC-10/AC-11 are checked by "a run-once script" per the
spec's own `## Non-functional` section. This is that script. **It is not wired
into `scripts/check-claude-skills.sh` or any CI workflow, deliberately** — doing
that would be the declined non-goal, and needs a spec amendment this one change
does not have. Run it by hand, or from a future workflow once that amendment
lands.

DERIVE, NEVER DUPLICATE. The set of agents to check comes from `git ls-files
.claude/agents/*.md` (minus `README.md`) and from parsing the README's own
catalog table — never a hardcoded list of agent names. The same principle as
`scripts/check_specs.py` reading its required section list out of
`specs/README.md` instead of copying it (see that script's docstring). A
hardcoded name list silently stops covering a new agent; an earlier draft of
this exact checker made that mistake and a mutation run caught it (see
`scripts/test_check_agent_frontmatter.py`).

The only names this script hardcodes are `architecture-reviewer` and
`plan-verifier` themselves, for AC-9 and AC-10 — those two criteria are
specifically ABOUT those two agents, not a general rule over whichever agents
happen to exist, so there is nothing to derive there. AC-11's cross-check
(README vs. frontmatter) is fully derived and runs over every agent file found,
so it also exercises the "everyone else must NOT have moved" direction without
a separate hardcoded exemption list.

CEILING, not a gap list. This checks three things: two agents' `model:` value,
and whether the README catalog's Model column matches every agent file's own
`model:`. It does not check any other frontmatter key, does not check that an
agent file is paired with a catalog row at all (a different, undone check —
see `.claude/agents/README.md:283-291`), and says nothing about whether a
`model:` change actually takes effect in a running session (root
`INSIGHTS.md:139-143`: the registry resolves at session start; this script
reads files on disk).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

AGENTS_REQUIRED_SONNET = ("architecture-reviewer", "plan-verifier")

CATALOG_ROW = re.compile(
    r"^\|\s*\[([a-z0-9-]+)\]\([a-z0-9-]+\.md\)\s*\|\s*`([a-z]+)`\s*\|", re.M
)


def relative(path: Path, repo: Path | None) -> str:
    if repo is None:
        return path.as_posix()
    try:
        return path.relative_to(repo).as_posix()
    except ValueError:
        return path.as_posix()


def agent_files(repo: Path) -> dict[str, Path]:
    """Every `.claude/agents/<name>.md` except `README.md`, keyed by `<name>`.

    Derived from the directory listing, not a hardcoded roster — a new agent
    file is picked up on the next run with no code change here.
    """
    out: dict[str, Path] = {}
    for path in sorted((repo / ".claude" / "agents").glob("*.md")):
        if path.name == "README.md":
            continue
        out[path.stem] = path
    return out


def frontmatter_model(path: Path) -> str | None:
    """The frontmatter `model:` value, parsed with `yaml.safe_load` — never grepped.

    A bare scalar can pass a grep and still fail every real YAML parser (the
    exact trap `scripts/check-claude-skills.sh` documents for skill
    `description:` fields); parsing the way the harness would is the only
    check that proves the value, not just its presence.
    """
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end == -1:
        return None
    frontmatter = yaml.safe_load(text[4:end]) or {}
    model = frontmatter.get("model")
    return str(model) if model is not None else None


def readme_catalog(repo: Path) -> dict[str, str]:
    """`{agent name: Model column value}` from the README's own catalog table.

    Parsed out of the table, never copied into a second list — the table in
    `.claude/agents/README.md` is the single source for what the catalog says.
    """
    text = (repo / ".claude" / "agents" / "README.md").read_text(encoding="utf-8")
    return {name: model for name, model in CATALOG_ROW.findall(text)}


def check(repo: Path) -> list[str]:
    """Return a list of failure strings. Empty means everything checked passed."""
    problems: list[str] = []
    agents = agent_files(repo)
    catalog = readme_catalog(repo)

    if not agents:
        return ["no `.claude/agents/*.md` files found — did the path change?"]
    if not catalog:
        return ["no catalog rows parsed from `.claude/agents/README.md` — did the table shape change?"]

    # AC-9, AC-10 — the two specific agents named by the criteria.
    for name in AGENTS_REQUIRED_SONNET:
        path = agents.get(name)
        if path is None:
            problems.append(f".claude/agents/{name}.md not found (AC-9/AC-10 cannot be checked)")
            continue
        model = frontmatter_model(path)
        if model != "sonnet":
            problems.append(
                f"{relative(path, repo)}: frontmatter `model` is {model!r}, expected 'sonnet' "
                f"(AC-9/AC-10)"
            )

    # AC-11 — every discovered agent's frontmatter must agree with the README
    # catalog's Model column for that same agent. Fully derived: this is what
    # also proves spec-creator and implementation-planner were NOT flipped,
    # with no separate hardcoded exemption list.
    for name, path in agents.items():
        model = frontmatter_model(path)
        if model is None:
            problems.append(f"{relative(path, repo)}: frontmatter has no `model:` key (AC-11)")
            continue
        catalog_model = catalog.get(name)
        if catalog_model is None:
            problems.append(
                f"{relative(path, repo)}: no catalog row found for '{name}' in "
                ".claude/agents/README.md (AC-11)"
            )
            continue
        if catalog_model != model:
            problems.append(
                f".claude/agents/README.md: catalog Model column for '{name}' is "
                f"`{catalog_model}`, but {relative(path, repo)} says `model: {model}` (AC-11)"
            )

    return problems


def main(argv: list[str]) -> int:
    repo = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent.parent
    problems = check(repo)
    for problem in problems:
        print(f"FAIL: {problem}")
    if problems:
        print(f"\n{len(problems)} problem(s).")
        return 1
    print("ok: agent frontmatter `model` values agree with the README catalog (AC-9, AC-10, AC-11).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
