/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { type DiffFindingApi } from "../findings";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  findings,
  defaultOpen,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
  /** Overrides each card's auto-expand heuristic — Smart Diff collapses whole roles. */
  defaultOpen?: boolean;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f) => (
        // Keyed by PATH, not index: Smart Diff reorders this list, and an index
        // key would hand one file's open/collapsed state to another.
        <FileCard
          key={f.path}
          file={f}
          commenting={commenting}
          findings={findings}
          defaultOpen={defaultOpen}
        />
      ))}
    </div>
  );
}
