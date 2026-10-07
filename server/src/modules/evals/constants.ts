/**
 * Fixed task line sent with every eval-case replay (spec 0019). It carries no
 * interpolated value at all — a case's `name`/`notes` are never prompted
 * (spec 0019 "Untrusted inputs": rendered as text in the Evals tab only) — so
 * there is nothing here needing the untrusted-content wrapper, and this file is not
 * "prompt assembly" (AC-47): the diff itself still reaches the model only
 * through `reviewPullRequest`'s own assembler.
 */
export const EVAL_TASK_LINE =
  'Review this diff. Report only the distinct, high-value findings you can defend, each citing ' +
  'an exact file and line range that appears in the diff. There is no target or maximum count, ' +
  'and zero findings is a valid result — do not pad or repeat to reach a number.';

/** Reason recorded on every batch the boot reap fails (AC-72), matching the review-runs reaper. */
export const EVAL_REAP_ERROR = 'Orphaned by an API restart (reaped on boot)';
