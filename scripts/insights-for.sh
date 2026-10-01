#!/usr/bin/env bash
# Which INSIGHTS.md entries bear on the paths you are about to touch.
#
# Replaces "read root INSIGHTS.md and the INSIGHTS.md of every package you touch", which
# measured 22k-44k tokens before an agent read any code. Routing is derived from each
# entry's mandatory `**Evidence:**` citations, so there is no index to maintain; the
# titles of every non-matching entry are printed too, so nothing is hidden.
#
# The logic lives in scripts/insights_for.py so it can be tested; that file's docstring
# states the ceiling — in particular that it under-routes a universal lesson which
# happens to cite only one file, which is why you still skim the titles.
#
#   bash scripts/insights-for.sh server/src/modules/reviews/service.ts
#   bash scripts/insights-for.sh --base origin/main
#   python3 -m unittest discover -s scripts -p 'test_insights_for.py'
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$root/scripts/insights_for.py" --repo "$root" "$@"
