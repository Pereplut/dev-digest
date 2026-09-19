#!/usr/bin/env python3
"""PreToolUse hook: no PR goes out without a passing pr-self-review of exactly this diff.

Bash: denies `gh pr create|merge|ready`, `git push`, and the `gh api` equivalents (REST
POST .../pulls, .../merges, PUT .../pulls/N/merge, GraphQL PR mutations) unless
`review_scope.py check` passes — i.e. a verdict exists, its fingerprint matches the current
local changes, and it found no CRITICAL. The deny reason tells the agent to run
/pr-self-review, which is how the review runs before every PR without being asked.

Write/Edit: denies hand-writing the verdict file; only `review_scope.py write-verdict` may.

Fails OPEN for everything that is not a gated action, and CLOSED for gated ones: if the
check itself errors, the PR action is denied with the error.
"""
import json
import os
import re
import sys

SCRIPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills", "pr-self-review", "scripts")
# Cheap pre-filter so ordinary Bash calls never pay for the import or a git call.
MAYBE_GATED = re.compile(r"\bpush\b|\bgh\b")


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def main():
    data = json.load(sys.stdin)
    tool = data.get("tool_name")
    tool_input = data.get("tool_input") or {}

    if tool in ("Write", "Edit", "MultiEdit"):
        target = os.path.normpath(tool_input.get("file_path") or "")
        if target.endswith(os.path.join(".claude", ".pr-self-review", "verdict.json")):
            deny("verdict.json is written only by `review_scope.py write-verdict` after a full "
                 "/pr-self-review run. Do not edit it by hand.")
        return

    if tool != "Bash":
        return
    command = tool_input.get("command") or ""
    if not MAYBE_GATED.search(command):
        return

    try:
        # No __pycache__: an untracked .pyc would itself change the reviewed tree.
        sys.dont_write_bytecode = True
        sys.path.insert(0, os.path.abspath(SCRIPTS))
        import review_scope as rs

        action = rs.is_gated_command(command)
        if not action:
            return
        root = rs.repo_root(data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR"))
        if not os.path.exists(os.path.join(root, ".claude", "skills", "pr-self-review", "SKILL.md")):
            return  # a different repository: not ours to gate
        code, message = rs.check(root)
    except Exception as exc:  # noqa: BLE001 — any failure on a gated action must deny
        deny(f"pr-self-review gate could not verify this PR action ({type(exc).__name__}: {exc}). "
             "Fix the gate or run /pr-self-review; do not work around it.")
        return

    if code == 0:
        return
    deny(f"Blocked `{action}`. {message}\n"
         "Run the pr-self-review skill now (/pr-self-review), fix every CRITICAL it reports, "
         "then retry. Do not bypass this gate (no --no-verify, no editing the verdict).")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        pass  # unreadable hook input: not a gated action we can identify
    sys.exit(0)
