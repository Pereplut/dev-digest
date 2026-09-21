# Skills

Skills are reusable markdown instruction blocks shared between review agents (spec
[0006](../specs/0006-agent-skills.md)). They are **text only**: a skill never runs code,
calls tools or reaches the network. It only adds instructions to an agent's system prompt.

## Model
- `skills` (workspace-scoped, unique name) holds the current text and a global `enabled` switch.
  `skill_versions` keeps an immutable snapshot of name, description, type and body, plus an optional change note, for every save and restore.
- `agent_skills (agent_id, skill_id, order, enabled)` links an agent to its skills, with a per-agent switch.
- A skill reaches a prompt only when **both** switches are on. Order = `agent_skills.order`.
- `run_skills (run_id, order, skill_id, skill_name, version, tokens)` records what each run actually sent.
  The skill Stats tab and the card metrics come from this table.

## Prompt placement
The executor (`server/src/modules/reviews/run-executor.ts`) renders each effective skill as
`### Skill: <name>\n<body>` (`renderSkillBlock`). reviewer-core puts the blocks into the
**system message**, after the agent prompt and before the injection guard, which is always last:

```
<agent system_prompt>

## Skills
### Skill: a
…

<INJECTION_GUARD>
```

The run trace stores the block in `prompt_assembly.skills`, and `prompt_assembly.system` excludes it.
The trace also stores `skills_used` (name, version, tokens) and `prompt_tokens` per slot.
The PR page's trace drawer shows one sub-block per skill, with its token count. A disabled skill is never sent, so it never appears there.

## Import and trust
`POST /skills/import/preview` accepts a `.md`, `.zip` or `.skill` file of up to 1 MB and **persists nothing**.
- For an archive, the core is `SKILL.md` (at the root or in one top-level folder), with frontmatter `name`, `description` and optional `type`.
- Every other entry is listed as ignored: scripts and binaries are marked "executable — not processed", and other `.md` files "reference file — not imported".
- Archives are read in memory (fflate), with at most 200 entries and 2 MB uncompressed in total. Nothing is written to disk or executed.
- The skill is saved (`source: imported_file`) only when the user confirms the preview.

An imported skill is someone else's instructions inside your agent's system prompt, where
the injection guard does not apply. Treat it like code review input: read it before saving.
Sample files are in `server/fixtures/skills/`.

## Description = interface
A skill's description should be one directive sentence: when the skill applies and what the agent must check.
It is what a person (and later, an agent choosing skills) reads to decide whether the skill fits.
