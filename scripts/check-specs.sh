#!/usr/bin/env bash
# Structural checks for specs in the current template (spec 0013).
#
# Four of spec 0013's acceptance criteria were filed as "not unit-testable — they are
# prompt behaviour". Four of them are not: the section set, unique `AC-N` identifiers,
# every identifier referenced in `## Test plan`, and the index row are all claims about
# the file on disk. This runs them.
#
# The logic lives in scripts/check_specs.py so it can be tested; that file's docstring
# states the ceiling — what is checked and, more importantly, what is not.
#
#   bash scripts/check-specs.sh            # from the repo root
#   python3 -m unittest discover -s scripts -p 'test_check_specs.py'
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$root/scripts/check_specs.py" "$root"
