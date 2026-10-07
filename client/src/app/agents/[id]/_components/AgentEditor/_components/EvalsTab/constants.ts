import type { EvalExpectationKind } from "@devdigest/shared";

/** `evals.json` key for each expectation kind label — exhaustive over the enum. */
export const EXPECTATION_KIND_LABEL_KEY = {
  must_find: "expectationKind.mustFind",
  must_not_flag: "expectationKind.mustNotFlag",
} satisfies Record<EvalExpectationKind, string>;
