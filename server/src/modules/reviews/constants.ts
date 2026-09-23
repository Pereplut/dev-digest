/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

// ---- Intent layer (spec 0008) ---------------------------------------------

/**
 * Character budgets for what the classifier is shown. The model sees a fraction
 * of a PR, deliberately: it is deciding a category and quoting a span, not
 * reviewing code, and every character here is paid on every review.
 */
export const INTENT_MAX_TITLE_CHARS = 300;
export const INTENT_MAX_BODY_CHARS = 6_000;
export const INTENT_MAX_SPEC_CHARS = 8_000;
export const INTENT_MAX_COMMITS = 20;
export const INTENT_MAX_PATHS = 40;

/**
 * At most this many linked specs are resolved. A PR body can link any number;
 * reading all of them would make the classifier's cost depend on attacker input.
 */
export const INTENT_MAX_SPECS = 3;

/** Refuse a spec file larger than this before reading it into memory. */
export const INTENT_MAX_SPEC_FILE_BYTES = 256 * 1024;

/**
 * A quote shorter than this proves nothing — `the`, `fix`, `()` would all
 * "appear" in any source. Below this length a quote is marked invalid rather
 * than counted as grounding.
 */
export const INTENT_MIN_QUOTE_CHARS = 12;

/** Hard stop on the classifier call, so a hanging provider cannot stall a review. */
export const INTENT_TIMEOUT_MS = 20_000;
