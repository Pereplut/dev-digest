---
name: flaky-test-patterns
description: >-
  Use when a PR adds or changes tests: flag patterns that make a test pass or
  fail depending on timing, date, run order, shared state, randomness or the
  network, and name the deterministic replacement.
type: rubric
---

**Flaky test patterns.** A flaky test fails without a code change. It erodes
trust in CI until people rerun or skip failures, and real regressions slip
through. Flag these patterns in test code the PR adds or changes:

- **Sleeps and real timeouts:** `await sleep(500)`, `setTimeout` in a test
  waiting "long enough" for async work. Use fake timers
  (`vi.useFakeTimers()` + `vi.advanceTimersByTime`) or await the actual
  promise/event.
- **Time and date dependence:** `new Date()`, `Date.now()` or a hardcoded
  "today" in an assertion; tests that break at midnight, month end, DST or in
  another time zone. Freeze the clock (`vi.setSystemTime`) and pass the time in.
- **Order dependence:** a test that relies on a previous test's rows, a
  module-level variable or a `beforeAll` fixture another test mutates. Each
  test sets up its own state (`beforeEach`) or uses unique ids.
- **Shared global state:** mutated `process.env`, singletons, module mocks not
  restored (`vi.restoreAllMocks`), a shared DB without per-test isolation.
- **Unseeded randomness:** `Math.random()`, `crypto.randomUUID()` feeding an
  assertion or a sort. Seed it or assert on properties, not exact values.
- **Real network:** calls to live HTTP APIs, DNS or a hosted LLM. Mock the
  boundary or use a recorded fixture.
- **Unordered collections asserted in order:** DB rows without `ORDER BY`,
  `Promise.all` side effects, object key order from a JSON API.

See `references/examples.md` for before/after pairs.

**Report** cited on the flaky line, titled "Flaky: <pattern> in <test name>",
with the deterministic replacement in the suggestion.

**Severity:** WARNING for a pattern that will fail intermittently in CI;
SUGGESTION for a latent risk (a sleep that is currently generous). Never
CRITICAL on its own.

**Do not flag:** timeouts configured on the test runner, or integration tests
that intentionally hit a local container the suite starts itself.
