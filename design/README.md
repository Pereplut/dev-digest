# design — mockups

UI mockups, one folder per feature: `design/<feature>/*.png`.

These are **inputs to a spec**, not documentation. The
[`spec-creator`](../.claude/agents/spec-creator.md) agent reads them (the `Read` tool renders
images) and turns them into `## User stories`, `## Acceptance criteria (EARS)` and `## Edge cases`
in a spec under [`specs/`](../specs/README.md) — and, just as importantly, into a list of what the
mockup does **not** say: the states it never shows, the failures it never draws, the copy it leaves
as a placeholder.

## Conventions

- Folder name matches the spec's short name, so `design/blast-radius/` pairs with
  `specs/0012-blast-radius.md`.
- One file per screen or state, named for what it shows: `pr-overview.png`, `pr-overview-empty.png`,
  `pr-overview-error.png`. A state that has no file is a state nobody has designed — which is the
  finding, not a gap to paper over.
- PNG or JPG. A mockup that only exists as a link is not an input: save the export here.
- **They are committed**, so a spec's visual evidence travels with the repo and a reviewer can see
  what the spec was written from (decided in [spec 0013](../specs/0013-spec-creator.md)). Keep
  exports small; nothing in the tooling depends on them being tracked, so the decision is
  reversible if the folder ever grows unwieldy.

## What a mockup is asked to answer

A screenshot shows one state, on one screen size, with one set of data. `spec-creator` walks every
screen for: loading · empty · one item · many · more than fits · error · degraded · permission
denied; every control and what it does while it is working and when it fails; every string (it
becomes an i18n key — the client forbids hardcoded copy); phone-width layout; focus order and what
a screen reader announces. Whatever the image cannot answer comes back as a question with a
proposed default, not as a silent decision.
