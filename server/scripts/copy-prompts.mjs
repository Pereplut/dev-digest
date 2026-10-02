// Copies the editable prompt templates into the build output.
//
// `platform/prompts.ts` resolves templates relative to its OWN module path —
// `src/prompts` under `tsx` (dev needs no copy), `dist/prompts` in a compiled
// build. Without this, a built server throws ENOENT the first time it loads
// any prompt template (AC-43).
import { cpSync } from 'node:fs';

cpSync('src/prompts', 'dist/prompts', { recursive: true });
