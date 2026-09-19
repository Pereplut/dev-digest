/**
 * Built-in skills used by the seed (spec 0006).
 *
 * A skill is a TEXT-ONLY instruction block: when it is enabled globally and on
 * an agent's Skills tab, `assemblePrompt` (reviewer-core/src/prompt.ts) appends
 * it to that agent's system message as `### Skill: <name>` + body, after the
 * agent prompt and before the injection guard. So a body:
 * - never describes the JSON output shape (the provider enforces it out of band,
 *   see docs/agent-prompts/README.md) and never introduces its own severity scale;
 * - uses `####` or bold labels at most, because it is nested under a `###` heading;
 * - says what to flag, how to phrase it, which severity, and what NOT to flag.
 *
 * `description` is the skill's interface: one directive sentence saying when it
 * applies and what the agent must check.
 *
 * The DB row is the source of truth at run time; editing a body here only
 * affects freshly seeded workspaces (the seed never overwrites an existing skill).
 */

export type SeedSkillType = 'rubric' | 'convention' | 'security' | 'custom';
export type SeedSkillSource =
  | 'manual'
  | 'imported_url'
  | 'imported_file'
  | 'extracted'
  | 'community';

export interface SeedSkill {
  name: string;
  description: string;
  type: SeedSkillType;
  source: SeedSkillSource;
  /** Global kill-switch; `false` keeps the skill out of every prompt. */
  enabled: boolean;
  body: string;
}

// ---------------------------------------------------------------- rubric

const PR_QUALITY_RUBRIC = `**PR Quality Rubric.** Judge the change on four dimensions, in this order, and
report only what a senior reviewer would actually block or ask for.

1. **Correctness** — does the changed code do what it claims on every path?
   Inverted conditions, missing \`await\`, wrong operator, an unhandled error path,
   a boundary (empty, zero, null, last page) that returns the wrong result.
2. **Security** — does the change widen what an untrusted caller can reach or
   read? Missing authz/tenant scope, unvalidated input reaching a sink, a secret
   in code or logs.
3. **Tests** — is the NEW behaviour exercised? A new branch, error path or
   contract change with no test that would fail if it broke is a gap.
4. **Scope** — does the PR do one thing? Unrelated refactors, drive-by renames or
   generated churn mixed into a behaviour change hide defects from review.

**Aim for 5 high-signal findings, not 50.** This is a ceiling for noise, not a
quota: two real findings beat five padded ones, and zero is a valid answer.

**Phrasing:** lead the title with the consequence ("Refund of 0 cents succeeds
and writes a ledger row"), then the mechanism in the rationale, then a concrete
fix. One finding per root cause, cited on the line that introduces it.

**Severity:** CRITICAL only for a defect that breaks correctness, security or a
caller contract once merged; WARNING for a real gap that does not block (a
missing test for a new branch, a mixed-scope PR); SUGGESTION for a minor
improvement.

**Do not flag:** formatting, naming taste, import order, comments, or anything
the diff did not introduce or make worse.`;

const UNTESTED_BRANCHES = `**Untested branches.** For every branch the PR adds or changes in production
code, check whether a test in the same PR (or an existing test visible in the
diff) actually exercises it. A branch is any \`if\`/\`else\`, \`switch\` case,
ternary, \`??\`/\`||\` fallback, early \`return\`/\`throw\`, \`catch\` block, or
status-code path in a route handler.

**How to check:**
- List the new branches in the changed source file. For each, find the test
  that drives execution into it and asserts its outcome.
- A test that only calls the function with valid input covers the happy path
  ONLY. The \`throw\`, the \`400\`, the \`catch\`, the \`else\` stay untested.
- Asserting "does not throw" or only the success value does not cover the error
  branch. Asserting the error type/message/status does.

**Bad:**
\`\`\`ts
// src/refund.ts
if (amount <= 0) throw new RangeError('amount must be positive');
if (amount > charge.amount) throw new RefundTooLargeError();
return issue(charge, amount);
// test: expect(refund(charge, 500)).toEqual(ok) — the two throws never run
\`\`\`
**Good:** one test per branch: \`refund(charge, 0)\` rejects with RangeError,
\`refund(charge, charge.amount + 1)\` rejects with RefundTooLargeError.

**Report** each uncovered branch as its own finding, cited on the line of the
branch in the SOURCE file (not the test), titled
"No test covers <condition> → <outcome>", with the missing test case spelled out
in the suggestion (input and expected result).

**Severity:** WARNING for an uncovered error/validation/fallback branch;
CRITICAL only when the untested branch guards money, auth, data deletion or a
public contract AND the diff shows it is wrong or unreachable; SUGGESTION for a
trivial branch (logging, a default label).

**Do not flag:** code the PR did not touch, type-only branches, exhaustive
\`never\` guards, or a branch that an existing test in the diff clearly covers.`;

const MISSING_CORNER_CASES = `**Missing corner cases.** When a PR adds or changes a function, parser, query or
route that takes input, check that its tests include the boundary inputs, not
just a typical value. Typical-value-only tests pass while the edge is broken.

**Corner cases to check, by input type:**
- Collections/strings: empty (\`[]\`, \`''\`), exactly one element, duplicates,
  the maximum page size / length limit and one past it.
- Numbers: \`0\`, negative, the documented max and max+1, non-integer, \`NaN\`.
- Optional values: \`null\`, \`undefined\`, a missing key vs a key set to \`null\`.
- Pagination/ranges: first page, last partial page, cursor past the end,
  \`limit=0\`, start == end.
- Time: an empty window, a boundary timestamp (inclusive vs exclusive), time zones.

**How to decide:** look at the code's own guards and limits. If the source has
\`if (items.length === 0)\`, \`Math.min(limit, 100)\` or \`z.number().max(50)\`,
the boundary is part of the contract and a test must pin it. If the source has
NO guard for an obvious edge (\`items[0].id\` with a possibly empty list,
division by a count that can be 0), that is a correctness finding, not just a
test gap — say which input breaks it and what happens (crash, NaN, wrong page).

**Bad:** \`expect(average([2, 4])).toBe(3)\` as the only test of
\`const average = (xs) => sum(xs) / xs.length\` — \`average([])\` returns \`NaN\`.
**Good:** also \`expect(average([])).toBe(0)\` (or a thrown error), with the
source handling the empty case.

**Report** titled "<function> not tested with <corner input>" cited on the
source line that handles (or fails to handle) it; name the exact input and the
expected result in the suggestion.

**Severity:** CRITICAL when the unhandled corner case crashes, corrupts data or
returns wrong results for input callers can send; WARNING when it is handled in
code but untested; SUGGESTION for an unlikely input on an internal helper.

**Do not flag:** every conceivable input. Pick the boundaries the code's own
logic makes relevant; one finding per function, listing the missing cases.`;

const OVER_MOCKING = `**Over-mocking.** When a PR adds or changes tests that use mocks, stubs or spies,
check that the test still exercises the code under test instead of the mocks.

**Flag when:**
- The unit under test is itself mocked (\`vi.mock('./refund')\` in
  \`refund.test.ts\`), so the test asserts the mock's canned return value.
- Every collaborator is mocked AND the assertions only check that mocks were
  called (\`expect(repo.save).toHaveBeenCalled()\`) — the test passes for any
  implementation that calls \`save\`, including a wrong one.
- A mock returns data the real dependency can never return (a shape that
  violates its type or schema, cast through \`as any\`/\`as unknown as\`), so the
  test covers an impossible state and misses the real one.
- The mock bakes in the branch being tested: the error path is "covered" only
  because the mock throws, while the code's own validation is never run.
- Pure logic (a formatter, a reducer, a parser) is mocked instead of called.

**Bad:**
\`\`\`ts
vi.mock('../db'); db.query.mockResolvedValue([{ id: 1 }]);
await listUsers(); expect(db.query).toHaveBeenCalledTimes(1);
\`\`\`
**Good:** assert the RESULT (\`expect(await listUsers()).toEqual([...])\`), mock
only the I/O boundary (network, clock, DB driver), or use the repo's fake/test
container for DB-backed logic.

**Report** cited on the test line that installs the mock, titled
"Test asserts the mock, not <unit>", naming what real behaviour is left
unverified and which boundary to mock instead.

**Severity:** WARNING when the over-mocked test is the only coverage of new
behaviour; SUGGESTION when other tests cover it. Never CRITICAL on its own.

**Do not flag:** mocking true external boundaries (HTTP, LLM, GitHub, clock,
randomness), fakes provided by the repo, or spies used alongside result asserts.`;

// ---------------------------------------------------------------- security

const SECRET_LEAKAGE_GATE = `**Secret leakage gate.** Block any PR that introduces a live credential or leaks
one at runtime.

**Flag:**
- Literal credentials in code, config, fixtures or docs: \`sk_live_\`, \`ghp_\`,
  \`github_pat_\`, \`xox[bp]-\`, \`AKIA…\`, \`-----BEGIN … PRIVATE KEY-----\`, JWTs,
  connection strings with a password, long high-entropy strings assigned to a
  name containing key/secret/token/password.
- A \`.env\` file, key file or credentials JSON added to the repo.
- Secrets reaching logs, error messages, API responses, telemetry or LLM prompts
  (\`logger.info({ config })\`, \`reply.send(err)\` with headers attached).
- A secret read from the DB or \`AppConfig\` instead of the secrets provider.

**Phrasing:** name the kind of secret and the file:line, never repeat the value
(write \`sk_live_…\` truncated). The fix is always two steps: move it to the
secrets provider/env AND rotate it, because it is already in git history.

**Severity:** CRITICAL for a real-looking live credential or a secret that
reaches logs/responses; WARNING for a test key or placeholder that looks live
(\`sk_test_\`) or a broad object logged that may contain one.

**Do not flag:** obvious placeholders (\`YOUR_KEY_HERE\`, \`xxx\`, \`changeme\` in
\`.env.example\`), public identifiers (publishable keys, client IDs), or hashes.`;

const LETHAL_TRIFECTA = `**Lethal trifecta.** Flag an AI-agent flow only when all three legs are present
in code the PR adds or changes:
1. **Untrusted input** reaches the LLM: a PR body, diff, issue, web page, file
   content or tool output an outsider can write.
2. **Private data** is available to that same LLM call or agent: secrets, other
   tenants' rows, private repo content, internal URLs.
3. **An exfiltration path** exists: the agent can make an outbound request, call
   a tool that writes somewhere visible, render a link/image, or its output is
   posted where the attacker can read it.

**How to check:** trace one concrete flow and cite a file:line for each leg. If
you cannot name all three with evidence, it is not a trifecta — report the
weakest link as a normal finding (unwrapped untrusted input, an over-privileged
tool) or nothing.

**Mitigations that break the chain:** untrusted content wrapped as data and
never granted tool access; no private data in that context; outbound calls
restricted to an allowlist; output never auto-posted.

**Severity:** CRITICAL when all three legs are proven with citations; WARNING
when two legs are present and the PR makes the third one easy to add.

**Do not flag:** an authenticated endpoint returning a user's own data, or an
LLM call with no tools and no private context. A false trifecta is worse than
none.`;

const PHANTOM_API_GATE = `**Phantom API gate.** Catch calls to APIs that do not exist — typical of
generated code: a method, option or import path that looks plausible but is
not part of the library version the repo uses.

**Flag:**
- A method or property called on a well-known library object that the library
  does not export in the version pinned by the repo (\`fastify.addRoutes\`,
  \`db.upsert\` on Drizzle, \`octokit.pulls.getAll\`).
- An import from a sub-path that the package does not ship.
- A config option passed to a library that silently ignores unknown options, so
  the intended behaviour (a timeout, a limit, a security flag) never applies.
- A new dependency whose name is one character away from a popular package
  (typo-squatting risk).

**How to check:** the diff must show the call; if the package version or its
types are in the diff (package.json, lockfile, a local type), use them. When you
cannot confirm the API is missing, say so and keep it at WARNING.

**Severity:** CRITICAL when a phantom security option (auth, TLS, rate limit)
means the protection is silently off; WARNING for other calls you believe do
not exist; SUGGESTION never.

**Do not flag:** project-local helpers, APIs you simply do not recognise without
a reason to believe they are missing.`;

// ---------------------------------------------------------------- convention

const NO_THEN_CHAINS = `**No \`.then()\` chains.** The codebase uses \`async\`/\`await\`. Flag new code that
builds promise chains with \`.then()\`/\`.catch()\` where \`await\` would do.

**Why it matters (the part worth a finding):** chains hide missing returns
(\`.then(() => { save(x) })\` drops the promise, so errors are unhandled and
ordering is lost), and a trailing \`.catch(() => {})\` swallows errors silently.

**Bad:** \`return fetchPr(id).then((pr) => { store(pr) }).catch(() => null);\`
**Good:**
\`\`\`ts
const pr = await fetchPr(id);
await store(pr);
return pr;
\`\`\`

**Severity:** WARNING when the chain drops a promise or swallows an error;
SUGGESTION for a pure style conversion with no behavioural difference.

**Do not flag:** \`Promise.all([...]).then\` in a one-liner that returns the
chain, \`.catch\` used deliberately on a fire-and-forget call with logging, or
code the PR did not touch.`;

const N_PLUS_ONE_QUERIES = `**N+1 queries.** Flag a DB query (Drizzle \`db.select\`, \`db.query.*\`, a repository
method) executed once per item of a collection the PR iterates.

**Look for:** a query inside \`for\`/\`for…of\`, \`.map(async …)\`, \`Promise.all(items.map(…))\`,
or a helper called per item that queries internally (follow one level of calls
visible in the diff).

**Bad:**
\`\`\`ts
for (const pr of prs) {
  pr.runs = await db.select().from(agentRuns).where(eq(agentRuns.prId, pr.id));
}
\`\`\`
**Good:** one query with \`inArray(agentRuns.prId, prs.map((p) => p.id))\`, then
group in memory with a \`Map\`; or a join.

**Phrasing:** state the loop size driver ("one query per PR in the page, up to
100") and the fix. Cite the line with the query inside the loop.

**Severity:** CRITICAL when the loop runs on a request hot path over an
unbounded or user-sized collection; WARNING for a bounded or background loop;
SUGGESTION for a loop over a small fixed set (≤ 5).

**Do not flag:** loops over a constant tiny list, queries that must run
sequentially inside a transaction for correctness, or batch jobs already
throttled by a queue.`;

const BREAKING_ROUTE_CHANGE = `**Breaking route change.** When a PR touches an HTTP route definition
(\`app.get/post/put/patch/delete\`, \`fastify.route\`, a \`routes.ts\` file, a Next.js
route handler) compare the OLD and NEW signature in the diff. Any change an
existing client would notice is a breaking change and must be reported.

**Breaking — always flag:**
- Path renamed or restructured (\`/pulls/:id\` → \`/pull-requests/:id\`), a path
  param renamed (\`:id\` → \`:prId\`) or removed, a segment added.
- HTTP method changed (\`POST\` → \`PUT\`), or a route removed.
- A new REQUIRED body field, query param or header; an optional one made
  required; a field's type narrowed (\`string\` → \`uuid\`, number range reduced).
- Response shape changed: a field removed or renamed, a type changed, a nullable
  field that can now be \`null\`, a list wrapped into \`{ items }\`.
- Success status changed (\`200\` → \`201\`/\`204\`), or an error status changed
  (\`404\` → \`400\`) for a case clients handle.

**Non-breaking — do not flag:** a new route, a new OPTIONAL input, a new response
field added alongside the old ones, a relaxed validation.

**How to check:** read the removed (\`-\`) lines of the route, its schema and its
handler's \`reply\`, then the added (\`+\`) lines. Search the diff for callers
(client \`api.ts\`, hooks, tests, e2e flows) that still use the old form; if they
were not updated, say so — that is the proof it breaks.

**Report** one finding per broken aspect, cited on the new route/schema line,
titled "Breaking: <old> → <new>", naming who breaks and the fix: keep the old
form as a deprecated alias, make the new field optional with a default, or
version the route.

**Severity:** CRITICAL when the route is public or has callers in the diff that
were not updated; WARNING when all callers visible in the diff were updated in
the same PR (still breaks older clients/deployments).`;

const CONTRACT_SCHEMA_DRIFT = `**Contract schema drift.** When a PR changes a request/response schema (a Zod
contract, a route \`schema\`, a TypeScript DTO, an OpenAPI file) or the code that
produces the response, check that every copy of the contract and the handler
still agree.

**Flag:**
- The handler returns a field the schema does not declare, or omits a required
  one (serializers may strip or throw; clients get a different shape than typed).
- A schema field renamed/retyped in one copy but not in its mirror (for example
  the server contract changed and the client's vendored copy did not), or a
  producer and consumer that now disagree on a field's name, casing or nullability.
- An enum value added on the producer side while a consumer uses an exhaustive
  \`switch\` or \`z.enum\` parse without it — old consumers now fail to parse.
- \`.optional()\` → required, \`.nullable()\` removed, or a default dropped, with
  existing rows or callers that send/hold the old form.
- JSON field casing that breaks the convention (API fields are snake_case).

**How to check:** for each changed field, find its producer (DB row mapper,
handler) and its consumers (client types, hooks, tests) in the diff and compare
name, type, optionality and enum members.

**Report** titled "Contract drift: <field> is <X> in <A> but <Y> in <B>", cited
on the changed schema line, with the concrete payload that fails.

**Severity:** CRITICAL when a consumer will fail to parse or crash on a real
response; WARNING when the mismatch is currently harmless (unused field) but
typed wrong; SUGGESTION for doc-only drift.

**Do not flag:** internal types that never cross a process boundary.`;

const STATUS_CODE_SEMANTICS = `**Status-code semantics.** When a PR adds or changes an HTTP handler, check that
each outcome maps to the right status code and that clients relying on the old
code are not broken.

**Expected mapping:**
- \`200\` read/update returning a body; \`201\` created (with the new resource);
  \`202\` accepted for async work; \`204\` success with NO body.
- \`400\` malformed/invalid input; \`401\` not authenticated; \`403\`
  authenticated but not allowed; \`404\` resource absent (or hidden across
  tenants); \`409\` conflict (duplicate name, stale version); \`422\` valid shape
  but semantically rejected; \`429\` rate limited.
- \`500\` only for unexpected failures — never for a validation error or a
  missing row.

**Flag:**
- An error path returning \`200\` with \`{ error }\` in the body, or a not-found
  returning \`200\` with \`null\`.
- A thrown validation/not-found error that falls through to \`500\`.
- \`204\` sent with a body, or \`201\` without the created resource.
- A handler whose status changed from the previous version (\`404\` → \`400\`,
  \`200\` → \`204\`) while callers in the diff still branch on the old one.
- A new error branch that the route's declared response schema does not list.

**Report** titled "<METHOD> <path> returns <code> for <case>; expected <code>",
cited on the \`reply.code\`/\`throw\` line.

**Severity:** CRITICAL when a changed code breaks existing callers or hides a
failure as success; WARNING for a wrong code on a new route; SUGGESTION for a
debatable choice (400 vs 422).

**Do not flag:** framework-generated codes (schema-validation 400s) or
unchanged handlers.`;

/** Seed order is the display order; link order is set in seed.ts. */
export const SEED_SKILLS: readonly SeedSkill[] = [
  {
    name: 'pr-quality-rubric',
    description:
      'Use on every PR: judge correctness, security, tests and scope, and report at most a handful of high-signal findings instead of nits.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    body: PR_QUALITY_RUBRIC,
  },
  {
    name: 'untested-branches',
    description:
      'Use when a PR adds or changes a branch in production code: flag every new branch (error path, early return, catch, fallback) with no test that exercises it.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    body: UNTESTED_BRANCHES,
  },
  {
    name: 'missing-corner-cases',
    description:
      'Use when a PR adds or changes code that takes input: check that tests cover empty, zero, null, max and off-by-one inputs, and flag code that mishandles them.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    body: MISSING_CORNER_CASES,
  },
  {
    name: 'over-mocking',
    description:
      'Use when a PR adds tests with mocks or spies: flag tests that mock the unit under test or only assert mock calls, so real behaviour goes unverified.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    body: OVER_MOCKING,
  },
  {
    name: 'secret-leakage-gate',
    description:
      'Use on every PR: block literal credentials in code, config or fixtures, and secrets that reach logs, errors, responses or prompts.',
    type: 'security',
    source: 'community',
    enabled: true,
    body: SECRET_LEAKAGE_GATE,
  },
  {
    name: 'lethal-trifecta',
    description:
      'Use when a PR touches an LLM or agent flow: flag it only if untrusted input, private data and an exfiltration path meet, each cited at file:line.',
    type: 'security',
    source: 'community',
    enabled: true,
    body: LETHAL_TRIFECTA,
  },
  {
    name: 'phantom-api-gate',
    description:
      'Use when a PR calls library APIs or adds dependencies: flag methods, options or import paths that do not exist in the pinned version.',
    type: 'security',
    source: 'imported_url',
    enabled: false,
    body: PHANTOM_API_GATE,
  },
  {
    name: 'no-then-chains',
    description:
      'Use when a PR adds promise code: flag .then()/.catch() chains that drop a promise or swallow errors, and prefer async/await.',
    type: 'convention',
    source: 'extracted',
    enabled: true,
    body: NO_THEN_CHAINS,
  },
  {
    name: 'n-plus-one-queries',
    description:
      'Use when a PR adds a loop near data access: flag any DB query executed once per item and name the batched query that replaces it.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: N_PLUS_ONE_QUERIES,
  },
  {
    name: 'breaking-route-change',
    description:
      'Use when a PR touches an HTTP route: flag a renamed or removed path or param, a changed method, a new required input, or a changed response shape or status as a breaking change.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: BREAKING_ROUTE_CHANGE,
  },
  {
    name: 'contract-schema-drift',
    description:
      'Use when a PR changes a request/response schema or the code that produces it: flag fields whose name, type, optionality or enum values disagree between producer, contract copies and consumers.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: CONTRACT_SCHEMA_DRIFT,
  },
  {
    name: 'status-code-semantics',
    description:
      'Use when a PR adds or changes an HTTP handler: flag outcomes mapped to the wrong status code and status changes that break existing callers.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: STATUS_CODE_SEMANTICS,
  },
];

/**
 * Agent → skill links, in prompt order. `enabled: false` keeps the link (and its
 * position) but leaves the skill out of that agent's prompt.
 */
export const SEED_AGENT_SKILLS: Readonly<
  Record<string, ReadonlyArray<{ skill: string; enabled: boolean }>>
> = {
  'General Reviewer': [
    { skill: 'pr-quality-rubric', enabled: true },
    { skill: 'breaking-route-change', enabled: true },
    { skill: 'contract-schema-drift', enabled: true },
    { skill: 'status-code-semantics', enabled: true },
  ],
  'Security Reviewer': [
    { skill: 'secret-leakage-gate', enabled: true },
    { skill: 'lethal-trifecta', enabled: true },
    // Link on, skill globally off: shows the "globally off" state.
    { skill: 'phantom-api-gate', enabled: true },
  ],
  'Performance Reviewer': [
    { skill: 'n-plus-one-queries', enabled: true },
    { skill: 'no-then-chains', enabled: false },
  ],
  'Test Quality Reviewer': [
    { skill: 'untested-branches', enabled: true },
    { skill: 'missing-corner-cases', enabled: true },
    { skill: 'over-mocking', enabled: true },
  ],
};
