#!/usr/bin/env sh
# Lists likely flaky patterns in test files under the given directory
# (default: current directory). Read-only: it only runs grep.
#
# DevDigest never runs this file. On import it is listed as
# "executable, not processed"; only SKILL.md becomes the skill.
dir="${1:-.}"
grep -rnE 'setTimeout|sleep\(|Date\.now\(|new Date\(\)|Math\.random\(' \
  --include='*.test.ts' --include='*.test.tsx' "$dir" || true
