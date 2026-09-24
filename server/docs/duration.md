# Run durations in logs and the trace

`agent_runs.duration_ms` is nullable, and the null means **"not measured"**, not
"took no time". A run that failed before the model was called, and a run still in
flight, both land there.

`formatRunDuration` (`src/platform/duration.ts`) is the single place that decides
what that looks like:

| Input | Shown |
|---|---|
| `1500` | `1.5s` |
| `0` | `0ms` — a genuine measurement |
| `null` / `undefined` | `—` |
| `NaN` / `Infinity` / negative | `—` |

Zero is deliberately *not* folded in with the missing cases: a run that really
did complete in under a millisecond has been measured, and showing an em dash
there would hide a successful run behind the same placeholder as a crashed one.

Formatting comes from [`pretty-ms`](https://github.com/sindresorhus/pretty-ms),
so the thresholds (ms → s → m) match what the rest of the Node ecosystem prints.
