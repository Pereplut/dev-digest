/* DiffGroupHeader — the role banner above one Smart Diff group: a colour square,
   the role label and its one-line description, and on the right the count of
   FILES carrying findings followed by the file count. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui-client";
import type { SmartDiffRole } from "@/lib/types";
import { ROLE_COLOR, ROLE_DESC_KEY, ROLE_LABEL_KEY } from "../../constants";
import { s, square, chevron } from "./styles";

export function DiffGroupHeader({
  role,
  fileCount,
  findingFileCount,
  open,
  onToggle,
}: {
  role: SmartDiffRole;
  fileCount: number;
  /** Files with findings, not findings — two files with five findings show 2. */
  findingFileCount: number;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("prReview");
  const labelKey = ROLE_LABEL_KEY[role];
  const descKey = ROLE_DESC_KEY[role];

  return (
    <button type="button" aria-expanded={open} onClick={onToggle} style={s.header}>
      <Icon.ChevronRight size={13} style={chevron(open)} />
      <span style={square(ROLE_COLOR[role])} />
      <span style={s.label}>{t(`smartDiff.${labelKey}`)}</span>
      <span style={s.desc}>{t(`smartDiff.${descKey}`)}</span>
      {findingFileCount > 0 && (
        <span
          style={s.findingCount}
          aria-label={t("smartDiff.filesWithFindings", { count: findingFileCount })}
        >
          <span style={s.dot} />
          <span className="tnum">{findingFileCount}</span>
        </span>
      )}
      <span style={s.fileCount}>{t("smartDiff.filesCount", { count: fileCount })}</span>
    </button>
  );
}
