/* OffPatchFindings — footer list for findings whose line is not in this patch
   (a deleted line, or a line outside the hunks). Modelled on OutdatedComments:
   a finding we cannot anchor is LISTED, never dropped. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cs } from "../comments";
import { type DiffFindingApi, type DiffFindingLike } from "../findings";

export function OffPatchFindings({
  findings,
  api,
}: {
  findings: DiffFindingLike[];
  api: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  if (findings.length === 0) return null;
  return (
    <div style={cs.outdatedWrap}>
      <span style={cs.outdatedTitle}>
        {t("diffViewer.offPatchTitle", { count: findings.length })}
      </span>
      {findings.map((f) => (
        <div key={f.id}>{api.render(f)}</div>
      ))}
    </div>
  );
}
