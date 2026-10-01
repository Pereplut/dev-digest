#!/usr/bin/env python3
"""PreToolUse hook: the `spec-creator` agent writes specs, and nothing else.

It denies every `Write`/`Edit`/`MultiEdit`/`NotebookEdit` from that agent whose target is not a
Markdown file under a `specs/` directory — `specs/**/*.md` at the repo root, or `<pkg>/specs/**/*.md`
one level down. Every other caller, the main session included, passes through untouched: this is a
boundary for one agent, not a repo-wide lock.

WHY A HOOK AND NOT PERMISSIONS. `permissions.allow` / `deny` in settings.json cannot be scoped to an
agent — a `deny` there would block the main session too, and an `allow` cannot carve an exception out
of a deny. Agent frontmatter has no path key either. A PreToolUse hook is the only place the two
facts meet: which agent is calling, and which path it wants.

HOW THE CALLER IS IDENTIFIED. `agent_type` in the hook payload, set by the harness. Measured on CLI
2.1.285, three runs, `.claude/.insights-state` probes:
  * main session's own Write          -> agent_id None, agent_type None
  * Agent tool, subagent_type: <name> -> agent_id set,  agent_type "<name>"
  * claude -p --agent <name>          -> agent_id None, agent_type "<name>"
So `agent_type` is the reliable key and `agent_id` is not (absent in --agent mode). An absent
`agent_type` means the main session, which is why this fails OPEN for it and CLOSED for anything
that names itself spec-creator.

PATHS ARE RESOLVED, NOT MATCHED AS WRITTEN. `os.path.realpath` first, then containment against the
resolved repo root. `specs/../server/src/x.ts`, an absolute path outside the repo, and a `specs`
symlink pointing elsewhere all fail the containment check rather than the string check. This repo
spent seven review rounds learning that a guard which reasons about a path as typed loses to the
first spelling nobody thought of (root INSIGHTS.md, 2026-09-23).

THE CEILING — what this actually guarantees, stated instead of a list of gaps, because a gap list is
a promise that everything absent from it is covered:

  It closes the file-writing tools for one named agent. That is a real boundary ONLY while
  `spec-creator` holds no tool that writes by another route — `Bash` (a redirect writes anywhere
  and no token check survives contact with the shell), `Agent` (it could delegate the write),
  `NotebookEdit`, or anything else that reaches the filesystem. This hook cannot see the
  frontmatter, so `test_spec_scope_gate.py`'s `KNOWN_SAFE` holds the assessed tool set and fails
  on anything newly granted.

  That set is deliberately NOT restated here. An earlier draft of this docstring listed the tools
  inline and was wrong within a day — it omitted `Skill`, which the agent had been granted — while
  the test, which reads the frontmatter, stayed correct. Root INSIGHTS.md, 2026-10-01: a list
  restated in prose drifts from the thing it describes, and nothing checks that two paragraphs
  agree. Read the frontmatter or the test; both are derived from reality.

  It does not police CONTENT. The agent is told never to write `status: approved` — that stays a
  prompt rule. A content guard keyed on a spelling is the thing this repo has already documented as
  unwinnable, and `## Phases` dates, index rows and EARS wording are the user's to check.

  Assume any shape without a test in `test_spec_scope_gate.py` is uncovered.
"""
import json
import os
import sys

sys.dont_write_bytecode = True  # an untracked .pyc would itself change the reviewed tree

AGENT = "spec-creator"
WRITE_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def repo_root(start):
    """Nearest ancestor holding a .git entry; falls back to `start` itself."""
    cur = os.path.realpath(start or os.getcwd())
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return os.path.realpath(start or os.getcwd())
        cur = parent


def is_spec_path(root, target):
    """True for `specs/**/*.md` and `<pkg>/specs/**/*.md`, after resolution.

    Resolution happens first so that `..`, an absolute path and a symlinked directory are judged by
    where they LAND, not by how they are spelled.
    """
    if not target:
        return False
    resolved = os.path.realpath(os.path.join(root, target))
    root = os.path.realpath(root)

    # Containment: the target must sit inside the repo. commonpath raises on different drives or a
    # mix of absolute and relative, both of which mean "not inside".
    #
    # Measured redundancy, stated rather than hidden: deleting this block leaves all 15 tests green.
    # Everything outside the root comes back from relpath() below with a leading `..`, which the
    # structural check already refuses — so containment catches nothing the shape check misses, and
    # no test distinguishes the two. It stays because it says the intent out loud and survives a
    # refactor of the parts logic, not because the suite proves it. The other five guards here were
    # each broken deliberately and each failed a test; this one was not.
    try:
        if os.path.commonpath([root, resolved]) != root:
            return False
    except ValueError:
        return False

    rel = os.path.relpath(resolved, root)
    parts = rel.split(os.sep)
    if not parts[-1].endswith(".md"):
        return False
    # specs/<...>.md  — at the root, or one package level down.
    if parts[0] == "specs" and len(parts) >= 2:
        return True
    if len(parts) >= 3 and parts[1] == "specs" and not parts[0].startswith("."):
        return True
    return False


def main():
    data = json.load(sys.stdin)
    if data.get("agent_type") != AGENT:
        return  # the main session and every other agent: not ours to gate

    tool = data.get("tool_name")
    if tool not in WRITE_TOOLS:
        return

    # Past this point the caller IS spec-creator, so a failure must deny: an error here must not
    # hand the agent the write it was asking for.
    try:
        tool_input = data.get("tool_input") or {}
        target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        root = repo_root(data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR"))
        allowed = is_spec_path(root, target)
    except Exception as exc:  # noqa: BLE001
        deny(f"spec-scope-gate could not resolve the target of this write "
             f"({type(exc).__name__}: {exc}), so it is denied. Write specs under `specs/` with a "
             "plain repo-relative path.")
        return

    if allowed:
        return
    deny(
        f"Denied: `{AGENT}` may only write Markdown under a specs directory — `specs/**/*.md` at "
        f"the repo root, or `<pkg>/specs/**/*.md`. `{target}` is not one of those.\n"
        "Specs are the only artifact this agent owns. Code, tests, docs/, INSIGHTS.md, AGENTS.md "
        "and .claude/ belong to other agents or to the user. If the spec needs a change somewhere "
        "else, write it into the spec as a requirement and say so in your report — do not make it."
    )


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001
        # Only reachable BEFORE the caller is known — unreadable stdin, no JSON. The caller could be
        # the main session, and denying every one of its writes because a payload was malformed is a
        # worse failure than not gating one call, so this direction is open. Once `agent_type` says
        # spec-creator, main() denies on error instead.
        pass
    sys.exit(0)
