import type { CiExportInputBody, CiFile, CiTrigger } from "@devdigest/shared";
import { GHA_TARGET, REPO_PATTERN, WORKFLOW_PATH } from "./constants";
import type { PostAs, TriggerState } from "./types";

/** True when `value` is a trimmed-valid `owner/name` (AC-83). */
export function isValidRepo(value: string): boolean {
  return REPO_PATTERN.test(value.trim());
}

/** Toggle state -> the ordered trigger list the API expects. */
export function triggersToList(triggers: TriggerState): CiTrigger[] {
  return (Object.keys(triggers) as (keyof TriggerState)[]).filter((key) => triggers[key]);
}

export function findWorkflow(files: CiFile[] | null): CiFile | null {
  return files?.find((f) => f.path === WORKFLOW_PATH) ?? null;
}

/** Replace the workflow's contents, leaving every other file untouched. */
export function withEditedWorkflow(files: CiFile[], contents: string): CiFile[] {
  return files.map((f) => (f.path === WORKFLOW_PATH ? { ...f, contents } : f));
}

export interface ExportChoices {
  repo: string;
  triggers: TriggerState;
  postAs: PostAs;
}

/** Request body for `POST /agents/:id/export-ci`. `workflowOverride` is set only
 *  for an edited workflow on `open_pr` (AC-64). */
export function buildExportBody(
  action: "files" | "open_pr",
  choices: ExportChoices,
  workflowOverride?: string,
): CiExportInputBody {
  return {
    repo: choices.repo.trim(),
    target: GHA_TARGET,
    action,
    post_as: choices.postAs,
    triggers: triggersToList(choices.triggers),
    // A blank editor means "no override" — the server rejects blank text (422).
    ...(workflowOverride !== undefined && workflowOverride.trim() !== ""
      ? { workflow_override: workflowOverride }
      : {}),
  };
}
