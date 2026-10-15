**Contract schema drift.** When a PR changes a request/response schema (a Zod
contract, a route `schema`, a TypeScript DTO, an OpenAPI file) or the code that
produces the response, check that every copy of the contract and the handler
still agree.

**Flag:**
- The handler returns a field the schema does not declare, or omits a required
  one (serializers may strip or throw; clients get a different shape than typed).
- A schema field renamed/retyped in one copy but not in its mirror (for example
  the server contract changed and the client's vendored copy did not), or a
  producer and consumer that now disagree on a field's name, casing or nullability.
- An enum value added on the producer side while a consumer uses an exhaustive
  `switch` or `z.enum` parse without it — old consumers now fail to parse.
- `.optional()` → required, `.nullable()` removed, or a default dropped, with
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

**Do not flag:** internal types that never cross a process boundary.