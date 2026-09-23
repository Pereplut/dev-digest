#!/usr/bin/env python3
"""PreToolUse hook: no PR goes out without a passing pr-self-review of exactly this diff.

Bash: denies `gh pr create|merge|ready`, `git push`, and the `gh api` equivalents (REST
POST .../pulls, .../merges, PUT .../pulls/N/merge, GraphQL PR mutations) unless
`review_scope.py check` passes — i.e. a verdict exists, its fingerprint matches the current
local changes, and it found no CRITICAL. The deny reason tells the agent to ask the user to
run /pr-self-review: the skill has `disable-model-invocation: true`, so only a person starts it.

Bash, ahead of any review state: denies the flags and operands that make an otherwise read-only
command open a path the caller names — `git ... --output=<file>`, `git blame --contents=<file>`,
`wc --files0-from=<file>`, and `git diff` given an operand outside the working tree, which puts
git in no-index mode where it PRINTS both files. git enters that mode on its own, with no
`--no-index` in the command, which is why the check matches operands and not just spellings. A
`deny` entry cannot close any of them — deny matching is prefix/word based and the flag or path
trails the subcommand — so the check happens here, on tokens.

Why here at all: an allowlist entry matches a command PREFIX, so `Bash(<cmd>:*)` approves every
flag and path that follows. The prefix grants that made this exploitable (`git diff`, `git
blame`, `wc`) have since been REMOVED from `.claude/settings.json`; what is still granted is
`git status|log|show|ls-files|rev-parse`, `ls` and one exact `pnpm` command. So this hook is now
defence in depth rather than the only barrier, and the commands it denies mostly prompt anyway.

What it does NOT claim: that nothing else can read a file. An earlier version of this docstring
said "no other allowlisted command prints a file outside the repo" — that sentence was wrong
about `git blame` and `wc`, and believing it is why two review rounds stopped looking. The
guard covers the spellings that have tests. Assume every shape not tested is uncovered, and
note that any indirection (an unknown wrapper, eval, a variable holding "git", a quote inside
the word) defeats it regardless.

There is NO raw-text pre-filter any more, deliberately. There used to be one, to save the import
on ordinary Bash calls, and it was the weakest link four times running: a regex over un-lexed
text can never be as wide as a check over de-quoted tokens, so every time the check got wider
the filter became the hole. `--out\\put=` escaped it, then `gi"t" diff --output=x` (no literal
`git` once quoted), then `gi"t" diff /etc/passwd /dev/null`, then `gi"t" di"ff" …` with both
words quoted. Each fix widened the regex and the next round found the next spelling. So the
check now runs on every Bash command.

It is not free, and the honest number is not "a few ms": measured here, median over 15 runs,
this hook takes **41 ms** per Bash call against **22 ms** with the old short-circuit, so the
check costs about **19 ms every time you run anything**. (Of the 41, ~17 ms is bare Python
startup, which was paid either way.) That is the price of the guard not depending on how the
command happens to be spelled. If it ever needs to come back, make it a filter that cannot be
narrower than the check — not another regex.

Write/Edit: denies hand-writing the verdict file; only `review_scope.py write-verdict` may.

Fails OPEN for everything that is not a gated action, and CLOSED for gated ones: if the
check itself errors, the PR action is denied with the error.
"""
import json
import os
import sys

SCRIPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills", "pr-self-review", "scripts")


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
            why = {
                "git --output": "`--output=<file>` writes and TRUNCATES that path.",
                "git --no-index": "no-index mode diffs two paths anywhere on disk and PRINTS "
                                  "both.",
                "git --contents": "`git blame --contents=<file>` reads that file and prints "
                                  "every line of it.",
                "git --extcmd": "`git difftool --extcmd=<prog>` runs an arbitrary program.",
                "wc --files0-from": "`wc --files0-from=<file>` reads that file and echoes its "
                                    "bytes back in the error message.",
                "git blame -S": "`git blame -S <file>` reads that file and prints every line of "
                                "it back through `error: bad graft data:`. (`-S` elsewhere is "
                                "the pickaxe or GPG signing and is not denied.)",
                "git --ignore-revs-file": "`git blame --ignore-revs-file=<file>` reads that file "
                                          "and reports its first line back.",
                "git brace expansion": "the command contains a brace the shell will expand, and "
                                       "this check cannot expand it — `git diff "
                                       "{/etc/passwd,/dev/null}` is one token here and two "
                                       "paths by the time git runs. Write the paths out.",
                "wc brace expansion": "the command contains a brace the shell will expand, and "
                                      "this check cannot expand it. Write the path out.",
                "git diff on a path outside the tree": "a diff operand outside the working tree "
                                                       "— absolute, `..`, `/dev/null`, or one "
                                                       "the shell still has to expand — puts "
                                                       "git in no-index mode, where it prints "
                                                       "both files, with or without "
                                                       "`--no-index`.",
            }.get(escape, "it opens a path the caller names.")
            deny(f"Denied: {escape} — {why} That is not the read-only command the permission "
                 "allowlist takes it for, and it reaches the paths the settings `deny` list "
                 "covers. Read files with Read, write them with Write, and keep diff operands "
                 "repo-relative. If the flag or path belongs to a DIFFERENT program in the same "
                 "call, this check cannot tell them apart: run the two commands separately. Do "
                 "not re-spell it to get past this.")

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
