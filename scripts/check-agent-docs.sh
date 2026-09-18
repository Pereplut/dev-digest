#!/usr/bin/env bash
# Agent docs live in AGENTS.md (the cross-tool convention); every AGENTS.md has a
# sibling CLAUDE.md that imports it, because Claude Code reads only CLAUDE.md.
# This check keeps the two in lockstep. Run from anywhere: bash scripts/check-agent-docs.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

fail=0

# Skill payloads ship their own AGENTS.md (a compiled guide, not repo instructions).
tracked() { git ls-files "$1" "*/$1" | grep -v '^\.claude/skills/' || true; }

for agents in $(tracked AGENTS.md); do
  dir=$(dirname "$agents")
  claude="${dir%/}/CLAUDE.md"
  [ "$dir" = "." ] && claude="CLAUDE.md"

  if [ ! -f "$claude" ]; then
    echo "MISSING: $agents has no sibling $claude (Claude Code would not see it)"
    fail=1
  elif ! grep -qx '@AGENTS\.md' "$claude"; then
    echo "BAD STUB: $claude must contain a bare '@AGENTS.md' line (backticked = literal, not imported)"
    fail=1
  else
    echo "ok: $agents <- $claude"
  fi
done

for claude in $(tracked CLAUDE.md); do
  dir=$(dirname "$claude")
  agents="${dir%/}/AGENTS.md"
  [ "$dir" = "." ] && agents="AGENTS.md"

  if [ ! -f "$agents" ]; then
    echo "ORPHAN: $claude has no sibling $agents (content belongs in AGENTS.md)"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "Agent docs are out of sync. See the root AGENTS.md section 'Where things go'."
  exit 1
fi

echo
echo "All agent docs are paired."
