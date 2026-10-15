**Breaking route change.** When a PR touches an HTTP route definition
(`app.get/post/put/patch/delete`, `fastify.route`, a `routes.ts` file, a Next.js
route handler) compare the OLD and NEW signature in the diff. Any change an
existing client would notice is a breaking change and must be reported.

**Breaking — always flag:**
- Path renamed or restructured (`/pulls/:id` → `/pull-requests/:id`), a path
  param renamed (`:id` → `:prId`) or removed, a segment added.
- HTTP method changed (`POST` → `PUT`), or a route removed.
- A new REQUIRED body field, query param or header; an optional one made
  required; a field's type narrowed (`string` → `uuid`, number range reduced).
- Response shape changed: a field removed or renamed, a type changed, a nullable
  field that can now be `null`, a list wrapped into `{ items }`.
- Success status changed (`200` → `201`/`204`), or an error status changed
  (`404` → `400`) for a case clients handle.

**Non-breaking — do not flag:** a new route, a new OPTIONAL input, a new response
field added alongside the old ones, a relaxed validation.

**How to check:** read the removed (`-`) lines of the route, its schema and its
handler's `reply`, then the added (`+`) lines. Search the diff for callers
(client `api.ts`, hooks, tests, e2e flows) that still use the old form; if they
were not updated, say so — that is the proof it breaks.

**Report** one finding per broken aspect, cited on the new route/schema line,
titled "Breaking: <old> → <new>", naming who breaks and the fix: keep the old
form as a deprecated alias, make the new field optional with a default, or
version the route.

**Severity:** CRITICAL when the route is public or has callers in the diff that
were not updated; WARNING when all callers visible in the diff were updated in
the same PR (still breaks older clients/deployments).