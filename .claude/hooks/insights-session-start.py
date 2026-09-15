#!/usr/bin/env python3
"""UserPromptSubmit hook: the engineering-insights loop, run on a session's first request.

1. Wrap-up of previous sessions: finds recent past sessions of this project that
   edited files with no engineering-insights run afterwards, writes a condensed
   transcript for each into .claude/.insights-state/, and asks the agent to run the
   wrap-up over them before starting the new request (no edits if nothing is new).
2. Read step: asks the agent to read the INSIGHTS.md files relevant to the request.

Fires once per session, never writes INSIGHTS.md itself, and fails open.
"""
import glob
import json
import os
import sys
import time

SKILL = "engineering-insights"
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
LOOKBACK_SESSIONS = 5   # how many past transcripts to inspect
MAX_WRAPUPS = 3         # wrap up at most this many sessions at once
MAX_CHARS = 150_000     # keep the tail of very long sessions
FIELD_CHARS = 1_500
STATE_TTL_DAYS = 14

READ_STEP = (
    "engineering-insights (read step): before working on this request, read the root "
    "INSIGHTS.md and the INSIGHTS.md of every module the request touches (server/, client/, "
    "reviewer-core/, e2e/), and apply the relevant entries. If work later moves into another "
    "module, read that module's INSIGHTS.md too. Don't mention this step unless an entry is relevant."
)

WRAPUP_STEP = (
    f"engineering-insights (wrap-up of previous session): first run the `{SKILL}` skill's "
    "wrap-up over the condensed transcript(s) of earlier session(s) listed below, then handle "
    "the user's request. Record only findings confirmed in those transcripts that aren't already "
    "in the target INSIGHTS.md. If nothing passes the quality bar, make NO edits and just say "
    "'no insights worth recording from the previous session'.\n"
)


def clip(text: str, limit: int = FIELD_CHARS) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[:limit] + " …[truncated]"


def condense(path: str) -> tuple:
    """Return (condensed transcript, whether it has edits no wrap-up covered)."""
    out, pending = [], False
    with open(path) as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            kind = entry.get("type")
            content = (entry.get("message") or {}).get("content")
            if kind == "user":
                blocks = [{"type": "text", "text": content}] if isinstance(content, str) else content or []
                for block in blocks:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text":
                        text = block.get("text", "")
                        if f"<command-name>/{SKILL}</command-name>" in text:
                            pending = False  # user ran the skill as a slash command
                        out.append(f"USER: {clip(text)}")
                    elif block.get("type") == "tool_result" and block.get("is_error"):
                        result = block.get("content")
                        if isinstance(result, list):
                            result = " ".join(b.get("text", "") for b in result if isinstance(b, dict))
                        out.append(f"TOOL ERROR: {clip(str(result))}")
            elif kind == "assistant":
                for block in content or []:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text":
                        out.append(f"ASSISTANT: {clip(block.get('text', ''))}")
                    elif block.get("type") == "tool_use":
                        name, tool_input = block.get("name"), block.get("input") or {}
                        out.append(f"TOOL {name}: {clip(json.dumps(tool_input), 400)}")
                        if name == "Skill" and tool_input.get("skill") == SKILL:
                            pending = False  # a wrap-up already covered earlier edits
                        elif name in EDIT_TOOLS:
                            target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
                            if not target.endswith("INSIGHTS.md"):
                                pending = True
    return "\n".join(out)[-MAX_CHARS:], pending


def prune(state_dir: str) -> None:
    cutoff = time.time() - STATE_TTL_DAYS * 86400
    for path in glob.glob(os.path.join(state_dir, "*")):
        if os.path.getmtime(path) < cutoff:
            os.remove(path)


def main() -> None:
    data = json.load(sys.stdin)
    session = data.get("session_id", "unknown")
    transcript = data.get("transcript_path") or ""
    project = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()

    state_dir = os.path.join(project, ".claude", ".insights-state")
    os.makedirs(state_dir, exist_ok=True)
    started = os.path.join(state_dir, f"{session}.started")
    if os.path.exists(started):
        return  # not the first request of this session
    open(started, "w").close()
    prune(state_dir)

    wrapups = []
    transcripts_dir = os.path.dirname(transcript)
    if transcripts_dir and os.path.isdir(transcripts_dir):
        past = [p for p in glob.glob(os.path.join(transcripts_dir, "*.jsonl"))
                if os.path.basename(p)[:-len(".jsonl")] != session]
        past.sort(key=os.path.getmtime, reverse=True)
        for path in past[:LOOKBACK_SESSIONS]:
            past_id = os.path.basename(path)[:-len(".jsonl")]
            handled = os.path.join(state_dir, f"{past_id}.handled")
            if os.path.exists(handled):
                continue
            condensed, pending = condense(path)
            open(handled, "w").close()  # inspected: never offer this session again
            if pending:
                out_path = os.path.join(state_dir, f"{past_id}.transcript.md")
                with open(out_path, "w") as f:
                    f.write(condensed)
                wrapups.append(os.path.relpath(out_path, project))
            if len(wrapups) >= MAX_WRAPUPS:
                break

    context = READ_STEP
    if wrapups:
        context = WRAPUP_STEP + "\n".join(f"- {p}" for p in wrapups) + "\n\n" + READ_STEP

    print(json.dumps({
        "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": context}
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
