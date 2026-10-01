/**
 * The structured shape `completeStructured` is asked to fill. Lives in its own
 * module (not `prompt.ts`) so `render.ts` can import it in C3b, ahead of
 * `prompt.ts` landing in C4 (plan finding L7 / P7 — a prior revision put both
 * in the same file and could not typecheck).
 *
 * Deliberately NO `title` (AC-29 — titles come from `SECTION_TITLES`), no
 * `items`/`commands` (those are server-derived facts, never model output —
 * AC-38, AC-76), and `kind` is the same five-value enum as the contract.
 */
import { z } from 'zod';
import { OnboardingLink, OnboardingSectionKind } from '@devdigest/shared';

export const DraftSection = z.object({
  kind: OnboardingSectionKind,
  body: z.string(),
  diagram: z.string().nullable(),
  links: z.array(OnboardingLink).max(4),
});
export type DraftSection = z.infer<typeof DraftSection>;

export const Draft = z.object({
  sections: z.array(DraftSection).length(5),
});
export type Draft = z.infer<typeof Draft>;
