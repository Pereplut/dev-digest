/* helpers.ts — pure mapping helpers for the PR Brief block (spec 0018).
   No I/O, no hooks: kept separate so PrBriefBlock.tsx stays render logic. */

import type { MissingInputName } from "@devdigest/shared";

/**
 * Every `missing_inputs[].input` the server can emit, mapped to its message key.
 *
 * `Record<MissingInputName, string>` is the point: the contract's union is
 * closed, so adding a value there without a label here fails `pnpm typecheck`.
 * It used to be `Record<string, string>` covering only the four *absent-input*
 * names, which silently missed the four fact blocks the token budget can drop —
 * so any PR large enough to trip the 8k budget rendered the raw identifier
 * ("Generated without smart_diff") on screen.
 */
const INPUT_LABEL_KEY = {
  intent: "block.intent",
  blast: "block.blast",
  specs: "block.specs",
  issue: "block.issue",
  smart_diff: "block.smartDiff",
  blast_callers: "block.blastCallers",
  pr_body: "block.prBody",
  diff_stats: "block.diffStats",
} satisfies Record<MissingInputName, string>;

/**
 * The same table read through a widened view, so the lookup below needs no type
 * assertion: `satisfies` above keeps the completeness check (a missing key is
 * TS2741, a typo'd key TS2561), while this alias lets an arbitrary `string` be
 * looked up and come back possibly-undefined, which is what the fallback wants.
 */
const LOOKUP: Readonly<Record<string, string | undefined>> = INPUT_LABEL_KEY;

/**
 * Maps a `missing_inputs[].input` value to its translated label. The fallback
 * to the raw value survives a server that is ahead of this client (a value the
 * contract gained but this bundle predates); within one build the `Record`
 * above makes it unreachable.
 */
export function missingInputLabel(t: (key: string) => string, input: string): string {
  const key = LOOKUP[input];
  return key ? t(key) : input;
}
