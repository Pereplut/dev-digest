# Conventions Extractor

How DevDigest turns a repository into a set of reviewable house conventions, and
then into one skill. Shipped by [spec 0007](../specs/0007-conventions-extractor.md).

## What it does

1. Picks a sample of the repository **in code, with no model involved**.
2. Makes one cheap structured LLM call over that sample.
3. **Proves every candidate against the real files** before showing it.
4. Lets the user accept, reject or edit each candidate.
5. Merges the accepted ones into a single editable skill.

## Data model

| Table | Holds |
|---|---|
| `conventions` | one candidate: category, rule, evidence (`path` + line range + snippet), confidence, status, proof result, fingerprint |
| `convention_scans` | one extraction run: status, which sampler ran, sample/candidate/rejected counts, model, cost |

`conventions` and `convention_scans` were added to the schema in migrations
`0016`/`0017`; the `conventions` table itself predates the feature as roadmap
scaffolding and was extended rather than replaced.

### The fingerprint, and why a re-scan is safe

`fingerprint = sha256(evidence_path + normalised rule)[0:16]`, where normalising
lowercases, collapses whitespace and drops trailing punctuation. Line numbers and
confidence are **deliberately excluded**.

`unique (repo_id, fingerprint)` is the upsert target. On a re-scan the evidence,
confidence and scan link are refreshed, but `status` is left alone — so an accept
or reject the user made earlier survives. The one exception: a candidate whose
evidence no longer proves out is forced back to `rejected`, because the reason it
was trustworthy is gone.

## Sample selection (no model)

Homework criterion 39 requires this step to be pure code. It is, in
`modules/conventions/sampling.ts`:

1. **Configs** — `CONFIG_CANDIDATES` (eslint, tsconfig, prettier, package.json)
   probed directly at the clone root.
2. **Top 12 source files** — `repoIntel.getConventionSamples(repoId, 12)`.

> ⚠️ Configs **cannot** come from `getConventionSamples()`. Its junk filter
> (`modules/repo-intel/service.ts`) excludes any path containing `eslint`,
> `prettier` or `.config.`, and `tsconfig.json` is not a walked extension. The
> direct probe is the only reason criterion 39's config half works.

**Unindexed repos.** `getConventionSamples()` returns `[]` when the repo has never
been indexed or `REPO_INTEL_ENABLED=false`. Rather than extract from configs
alone, the job falls back to `walkFallbackPaths()`: source extensions only, junk
paths dropped, sorted by (directory depth, path length, path) and capped at 12.
That ordering is total, so the same tree always yields the same sample. The scan
row records `sampler: 'repo-intel' | 'walk'` and the page says when the fallback ran.

The sample is rendered with **1-based line numbers**, which is what makes the
model's line citations checkable.

## The model call

One structured call, `schemaName: 'ConventionExtraction'`. The model is resolved
through `resolveFeatureModel(container, workspaceId, 'conventions')`, whose
registry default is `openrouter/deepseek-v4-flash` — deliberately cheap, since the
input is bounded and the output is a short list. Settings → Feature Models
overrides it per workspace.

`category` is a closed Zod enum, so the JSON-schema conversion makes it a hard
constraint rather than a prose request.

The sample is repository text and therefore untrusted: it goes inside
`<untrusted>…</untrusted>` and **the task line stays outside it**. `server/INSIGHTS.md`
records the bug this layout avoids.

## Proof — why a candidate gets rejected

`modules/conventions/proof.ts`, a pure function over the file's text:

| Check | Failure reason |
|---|---|
| Does the file exist? | `file_not_found` |
| Is the cited range inside the file, and `start <= end`? | `line_out_of_range` |
| Does the snippet appear within ±2 lines of the cited range? | `snippet_not_found` |

Comparison is whitespace-insensitive — models re-indent freely, and that is not a
reason to discard a real convention — but the **file and the region stay strict**.

Two consequences worth knowing:

- On success the snippet is **re-read from the file**, so the UI never displays
  code the model wrote.
- A failing candidate is **persisted as `rejected` with its reason**, not dropped.
  That keeps the rejection auditable, keeps the scan counts honest, and stops the
  next scan re-proposing it as pending.

## The skill

`buildConventionSkill()` renders accepted candidates into one markdown body with a
`##` section per rule and a fenced snippet under "Detected in `file:line`". The
server supplies this as a **default only**: the modal makes the body, name,
description, type and enabled flag all editable, and what the user submits is
exactly what is stored (criterion 41).

The skill is written with `source: 'extracted'` and `evidence_files` set to the
distinct evidence paths, so it appears in Skills Lab like any other skill and can
be attached to agents.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /repos/:id/conventions` | candidates + latest scan — the page's poll target |
| `POST /repos/:id/conventions/extract` | 202; the scan runs as a `conventions-extract` job |
| `GET /repos/:id/conventions/skill` | server-computed skill defaults |
| `POST /repos/:id/conventions/skill` | create the skill from the edited draft |
| `PATCH /conventions/:id` | accept / reject / edit one candidate |

Extraction is asynchronous. The `jobs` table is write-only (nothing SELECTs it),
so progress is tracked on `convention_scans` instead, and the page polls
`GET …/conventions` at 1.5s while the scan is `running`.

**A repo with no local checkout returns 409.** Evidence validation reads real
files, so there is nothing honest to do without a clone. This is deliberately loud
rather than a silent empty result — `server/INSIGHTS.md` records repo-intel's
silent degradation on unindexed repos as a defect.

## Seeded data

The demo repo `acme/payments-api` is fictional and has `clone_path: null`, so it
can never be scanned for real. `db/seed-conventions.ts` seeds three candidates and
a completed scan so the page is demoable and e2e-testable without a clone or a
model call. **They are marked `evidence_valid: true` but were never actually
validated** — to see the proof step reject anything, extract against a repository
imported through the UI, which does get a checkout.
