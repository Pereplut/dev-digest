# Skill import fixtures

Sample files for walking the manual **Import skill** path in the Skills page
(spec [0006](../../../specs/0006-agent-skills.md)). They are **not seeded**: the
seeded skills live in `src/db/seed-skills.ts`.

| File | What it exercises |
|---|---|
| `flaky-test-patterns.zip` | An archive skill: `SKILL.md` (frontmatter `name`, folded `description: >-`, `type: rubric`) plus `scripts/detect.sh` and `references/examples.md`, all under one top-level folder. The import preview lists the two extra files as ignored and flags `detect.sh` as "executable, not processed". |
| `flaky-test-patterns/` | The source folder the zip is built from. |
| `api-versioning.md` | A single-file skill (`type: convention`). |

## Trust

Importing a skill puts someone else's instructions into your agent's system
prompt. Read it before saving, the way you would read a dependency's install
script. Only `SKILL.md` (or the single `.md`) becomes the skill, as text.
Every other file in the archive is listed and ignored. Executable parts such as
`scripts/detect.sh` are flagged and **never run or processed**.

## Rebuilding the zip

After editing `flaky-test-patterns/`, rebuild the archive from this directory.
The command sorts entries and pins timestamps and permissions, so the output is
byte-identical for the same input:

```sh
cd server/fixtures/skills
python3 - <<'PY'
import os, zipfile
src = "flaky-test-patterns"
files = sorted(os.path.join(d, f) for d, _, fs in os.walk(src) for f in fs)
with zipfile.ZipFile(f"{src}.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for p in files:
        info = zipfile.ZipInfo(p.replace(os.sep, "/"), date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = (0o755 if p.endswith(".sh") else 0o644) << 16
        with open(p, "rb") as fh:
            z.writestr(info, fh.read())
PY
```
