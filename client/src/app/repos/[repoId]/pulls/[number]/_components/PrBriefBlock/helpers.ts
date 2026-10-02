/* helpers.ts — pure mapping helpers for the PR Brief block (spec 0018).
   No I/O, no hooks: kept separate so PrBriefBlock.tsx stays render logic. */

/**
 * The `missing_inputs[].input` values this feature's server ever emits
 * (`server/src/modules/brief/service.ts`): absent intent, degraded blast, no
 * linked issue, no used spec source.
 */
const INPUT_LABEL_KEY: Record<string, string> = {
  intent: "block.intent",
  blast: "block.blast",
  specs: "block.specs",
  issue: "block.issue",
};

/**
 * Maps a `missing_inputs[].input` value to its translated label. Falls back
 * to the raw value for an input this client does not recognise, rather than
 * throwing or looking up a message key that may not exist — the server, not
 * this map, is the source of truth for which inputs exist.
 */
export function missingInputLabel(t: (key: string) => string, input: string): string {
  const key = INPUT_LABEL_KEY[input];
  return key ? t(key) : input;
}
