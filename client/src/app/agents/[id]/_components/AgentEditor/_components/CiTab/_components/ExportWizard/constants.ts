import type { CiPostAs, CiTrigger } from "@devdigest/shared";
import type { PostAs, TriggerState } from "./types";

export const MODAL_WIDTH = 860;

/** The wizard offers GitHub Actions only (AC-62). */
export const GHA_TARGET = "gha" as const;

/** `owner/name` — the only repo shape the export endpoint accepts (AC-83). */
export const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/** The one editable file in Preview (AC-63). */
export const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";

// Mirrors of the contract literals (client code takes types only from
// @devdigest/shared, never values).
export const TRIGGER_KEYS: readonly CiTrigger[] = ["opened", "synchronize", "reopened"];
export const POST_AS_VALUES: readonly CiPostAs[] = ["github_review", "pr_comment", "none"];

/** `ci.json`'s `exportWizard.postAs` keys are camelCase. */
export const POST_AS_I18N_KEY: Record<CiPostAs, string> = {
  github_review: "githubReview",
  pr_comment: "prComment",
  none: "none",
};

/** Configure defaults (AC-65). */
export const DEFAULT_TRIGGERS: TriggerState = { opened: true, synchronize: true, reopened: false };
export const DEFAULT_POST_AS: PostAs = "github_review";

export const STEP_KEYS = ["target", "preview", "configure", "install"] as const;
