/* diff-viewer — unified-diff viewer with optional inline GitHub comments and
   review findings.
   Public surface: the DiffViewer component + the two API contracts callers fill
   in. `DiffFindingApi.render` is the seam that keeps this shared component from
   importing a route's FindingCard. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export type { DiffFindingApi, DiffFindingLike } from "./findings";
export { findingsForFile } from "./findings";
