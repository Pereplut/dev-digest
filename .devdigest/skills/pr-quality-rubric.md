**PR Quality Rubric.** Judge the change on four dimensions, in this order, and
report only what a senior reviewer would actually block or ask for.

1. **Correctness** — does the changed code do what it claims on every path?
   Inverted conditions, missing `await`, wrong operator, an unhandled error path,
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
the diff did not introduce or make worse.