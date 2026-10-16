**Status-code semantics.** When a PR adds or changes an HTTP handler, check that
each outcome maps to the right status code and that clients relying on the old
code are not broken.

**Expected mapping:**
- `200` read/update returning a body; `201` created (with the new resource);
  `202` accepted for async work; `204` success with NO body.
- `400` malformed/invalid input; `401` not authenticated; `403`
  authenticated but not allowed; `404` resource absent (or hidden across
  tenants); `409` conflict (duplicate name, stale version); `422` valid shape
  but semantically rejected; `429` rate limited.
- `500` only for unexpected failures — never for a validation error or a
  missing row.

**Flag:**
- An error path returning `200` with `{ error }` in the body, or a not-found
  returning `200` with `null`.
- A thrown validation/not-found error that falls through to `500`.
- `204` sent with a body, or `201` without the created resource.
- A handler whose status changed from the previous version (`404` → `400`,
  `200` → `204`) while callers in the diff still branch on the old one.
- A new error branch that the route's declared response schema does not list.

**Report** titled "<METHOD> <path> returns <code> for <case>; expected <code>",
cited on the `reply.code`/`throw` line.

**Severity:** CRITICAL when a changed code breaks existing callers or hides a
failure as success; WARNING for a wrong code on a new route; SUGGESTION for a
debatable choice (400 vs 422).

**Do not flag:** framework-generated codes (schema-validation 400s) or
unchanged handlers.