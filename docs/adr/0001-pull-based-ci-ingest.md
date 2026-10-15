# 0001. Ingest CI results by polling GitHub, not by a webhook

Status: accepted. Shipped with [spec 0022](../../specs/0022-export-to-ci.md); see [export-to-ci.md](../export-to-ci.md).

## Context
The studio is local-first and usually not reachable from the internet. CI results are produced inside the
target repo's GitHub Actions run.

## Decision
The runner uploads an `devdigest-result` artifact; the server pulls it with the Actions API on
`POST /ci/refresh` (`server/src/modules/ci/service.ts:288`). There is no inbound push endpoint
(`routes.ts:18-19`).

## Consequences
- No public URL, shared secret or signature scheme to run or leak.
- Results appear only after the user refreshes; there is no background poll.
- The artifact is the only data crossing the boundary and is attacker-influenceable, so it is gated: pull_request
  runs from the installed repo only, `commit_sha` equal to the run head, `repository_id` equal to the
  installation's, a 1,000,000 byte cap (`helpers.ts:207,224`, `constants.ts:135`).
- The studio token needs Actions read access, and only the last 30 completed runs per installation are examined
  per refresh (`constants.ts:131`).
