#!/usr/bin/env bash
# `.claude/` had no CI of any kind: skills, the session hook and skills-lock.json
# were unvalidated, so a skill with broken frontmatter, a catalog row pointing at
# a directory that does not exist, or a syntactically invalid hook would all ship
# silently. This check closes that. Run from anywhere:
#   bash scripts/check-claude-skills.sh
#
# HARD FAILURES are things that are unambiguously broken — a skill Claude Code
# cannot load, a dead catalog link, malformed JSON, a hook that will not run.
#
# KNOWN DRIFT is reported and tolerated. skills-lock.json and the skill
# directories have diverged in BOTH directions on purpose (see
# .claude/skills/README.md): two locked entries were never installed, and seven
# skills are authored in this repo rather than vendored. Failing on that would
# make this gate red from its first run, which is how gates get ignored. The
# allowlists below pin the known set; anything NEW fails.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

fail=0
SKILLS_DIR=".claude/skills"
LOCKFILE="skills-lock.json"
README="$SKILLS_DIR/README.md"

# Locked, but deliberately not installed here.
KNOWN_LOCKED_WITHOUT_DIR='
architecture-patterns
github-workflow-automation
'
# Present here, but authored in-repo rather than vendored via the lockfile.
KNOWN_DIR_WITHOUT_LOCK='
engineering-insights
mermaid-diagram
onion-architecture
react-best-practices
react-code-organization
react-testing-library
security
'

in_list() { echo "$2" | tr -d ' ' | grep -qx "$1"; }

# ---------------------------------------------------------------- skills
# Only tracked directories count: an untracked local experiment is not CI's
# business, and CI would not see it anyway.
skill_dirs=$(git ls-files "$SKILLS_DIR/*/SKILL.md" | xargs -r -n1 dirname | xargs -r -n1 basename | sort -u)

if [ -z "$skill_dirs" ]; then
  echo "NO SKILLS: no tracked $SKILLS_DIR/*/SKILL.md found — did the path change?"
  exit 1
fi

for name in $skill_dirs; do
  skill="$SKILLS_DIR/$name/SKILL.md"

  # Frontmatter must open on line 1 and close again, or Claude Code will treat
  # the whole file as prose and the skill will never match a prompt.
  if [ "$(head -n 1 "$skill")" != "---" ]; then
    echo "BAD FRONTMATTER: $skill does not start with '---'"
    fail=1
    continue
  fi
  if ! awk 'NR>1 && /^---[[:space:]]*$/ { found=1; exit } END { exit !found }' "$skill"; then
    echo "BAD FRONTMATTER: $skill has no closing '---'"
    fail=1
    continue
  fi

  # The frontmatter block: everything between the first and second '---'.
  fm=$(awk 'NR==1 && /^---/ { inside=1; next } inside && /^---[[:space:]]*$/ { exit } inside' "$skill")

  # `description:` may be a bare string, a quoted string, or a folded scalar
  # (`>-`) continued on later lines — all three are in use here, so match the
  # key only, never the value's shape.
  echo "$fm" | grep -qE '^description:[[:space:]]*\S' || {
    echo "NO DESCRIPTION: $skill frontmatter has no non-empty 'description:' (Claude Code uses it to decide relevance)"
    fail=1
  }

  fm_name=$(echo "$fm" | sed -nE 's/^name:[[:space:]]*"?([A-Za-z0-9_-]+)"?[[:space:]]*$/\1/p' | head -n 1)
  if [ -z "$fm_name" ]; then
    echo "NO NAME: $skill frontmatter has no 'name:'"
    fail=1
  elif [ "$fm_name" != "$name" ]; then
    echo "NAME MISMATCH: $skill declares name '$fm_name' but lives in '$name/' (invoked by directory name)"
    fail=1
  fi

  # Every skill must be findable from the catalog, or nobody knows it exists.
  if ! grep -q "($name/SKILL.md)" "$README"; then
    echo "NOT IN CATALOG: $name is missing from $README"
    fail=1
  fi
done

# Catalog rows must point at something real.
for linked in $(grep -oE '\(([a-z0-9-]+)/SKILL\.md\)' "$README" | tr -d '()' | sed 's|/SKILL.md||' | sort -u); do
  if [ ! -f "$SKILLS_DIR/$linked/SKILL.md" ]; then
    echo "DEAD CATALOG LINK: $README lists '$linked' but $SKILLS_DIR/$linked/SKILL.md does not exist"
    fail=1
  fi
done

# ---------------------------------------------------------------- lockfile
if ! python3 -c "import json,sys; json.load(open('$LOCKFILE'))" 2>/dev/null; then
  echo "BAD JSON: $LOCKFILE is not valid JSON"
  fail=1
else
  locked=$(python3 -c "import json; print('\n'.join(sorted(json.load(open('$LOCKFILE')).get('skills', {}))))")

  for name in $locked; do
    if [ ! -f "$SKILLS_DIR/$name/SKILL.md" ]; then
      if in_list "$name" "$KNOWN_LOCKED_WITHOUT_DIR"; then
        echo "note: '$name' is locked but not installed (known)"
      else
        echo "LOCKED WITHOUT DIRECTORY: '$name' is in $LOCKFILE but has no $SKILLS_DIR/$name/ — install it, or drop the entry with the skills manager"
        fail=1
      fi
    fi
  done

  for name in $skill_dirs; do
    if ! echo "$locked" | grep -qx "$name"; then
      if in_list "$name" "$KNOWN_DIR_WITHOUT_LOCK"; then
        echo "note: '$name' is authored in-repo, not vendored (known)"
      else
        echo "UNLOCKED SKILL: '$name' exists but is absent from $LOCKFILE — vendor it, or add it to KNOWN_DIR_WITHOUT_LOCK in this script"
        fail=1
      fi
    fi
  done
fi

# ---------------------------------------------------------------- hooks + settings
# A hook that will not parse breaks the insights loop silently: the failure
# surfaces as "the wrap-up never ran", not as an error.
# `ast.parse`, deliberately NOT `python3 -m py_compile`: py_compile writes a
# __pycache__ directory next to the hook, so the check would litter the repo it
# is checking on every local run (.gitignore does not cover it). Caught by
# running this script and then looking at `git status`.
for hook in $(git ls-files '.claude/hooks/*.py'); do
  if python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$hook" 2>/dev/null; then
    echo "ok: $hook parses"
  else
    echo "BROKEN HOOK: $hook is not valid Python"
    fail=1
  fi
done

if git ls-files --error-unmatch .claude/settings.json >/dev/null 2>&1; then
  if python3 -c "import json; json.load(open('.claude/settings.json'))" 2>/dev/null; then
    echo "ok: .claude/settings.json is valid JSON"
  else
    echo "BAD JSON: .claude/settings.json is not valid JSON"
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo ".claude assets are inconsistent. See .claude/skills/README.md."
  exit 1
fi

echo
echo "All $(echo "$skill_dirs" | wc -w) skills validate; lockfile, hooks and settings are consistent."
