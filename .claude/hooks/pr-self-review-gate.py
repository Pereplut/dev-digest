#!/usr/bin/env python3
"""PreToolUse hook: no PR goes out without a passing pr-self-review of exactly this diff.

Bash: denies `gh pr create|merge|ready`, `git push`, and the `gh api` equivalents (REST
POST .../pulls, .../merges, PUT .../pulls/N/merge, GraphQL PR mutations) unless
`review_scope.py check` passes — i.e. a verdict exists, its fingerprint matches the current
local changes, and it found no CRITICAL. The deny reason tells the agent to ask the user to
run /pr-self-review: the skill has `disable-model-invocation: true`, so only a person starts it.

Bash, ahead of any review state: denies `git ... --output=<file>` and `git diff --no-index`.
`git diff|log|show` sit on the permission allowlist as "read-only", but an allowlist entry
matches a command PREFIX, so it approves every flag that follows — and `--output` writes and
truncates an arbitrary path, while `--no-index` diffs two paths anywhere on disk and prints
them, which reads any file the process can open, `deny`-listed ones included. A `deny` entry
cannot close either (deny matching is prefix/word based; the flag trails the subcommand), so
the check happens here, on tokens.

That check corrects a mistaken belief; it is NOT a barrier, and anyone who wants to evade it
can — `git diff > file` and the Write tool are allowed and reach the same paths, other allowed
readers reach the same files, and any indirection (an unknown wrapper, eval, a variable holding
"git", a quote inside the word) defeats it. Treat every shape not covered by a test as
uncovered.

MAYBE_GATED below is a raw-text regex while `git_escape` matches de-quoted tokens, so it can
never be as wide, and the deny above is conditional on it. It therefore matches the escape
flags as well as the program names: `gi"t" diff --output=x`, whose only literal `git` is broken
by quoting, used to be a live bypass because the filter dropped it before the check ran.
`--out\\put=` escaped the same way earlier still. Treat this regex as a cost filter, never as
part of the guard: when in doubt, widen it.

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
MAYBE_GATED = re.compile(r"\bpush\b|\bgh\b|\bgit\b|--output|--no-index")


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

        # Unconditional: no verdict makes an arbitrary file write — or a read around the
        # settings deny list — acceptable, so this is checked before the review state and
        # never passes on a green verdict.
        escape = rs.git_escape(command)
        if escape:
            deny(f"A git command and the token `{escape.split()[1]}` appear in the same Bash "
                 "call. Neither is the read-only git the permission allowlist takes it for: "
                 "`--output=<file>` writes and truncates that path, and `--no-index` diffs two "
                 "paths anywhere on disk, which reads files the settings `deny` list covers. "
                 "Redirect instead (`git diff > file`), or use Write, or read the file with "
                 "Read. If the flag belongs to a DIFFERENT program in the same call, this check "
                 "cannot tell them apart: run the two commands separately. Either way, do not "
                 "re-spell the flag to get past this.")

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
         "Ask the user to run /pr-self-review (it is manual-only: disable-model-invocation), "
         "fix every CRITICAL it reports, then retry. Do not bypass this gate "
         "(no --no-verify, no editing the verdict).")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        pass  # unreadable hook input: not a gated action we can identify
    sys.exit(0)
