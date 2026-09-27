/* FileCard — one collapsible file in the diff: header (path, findings dot, +/-
   stat, comment count) and, when open, its parsed lines plus any outdated
   comments and off-patch findings. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui-client";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "@/components/findings-summary";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import {
  findingKeyForLine,
  findingsForFile,
  partitionFindings,
  worstSeverity,
  type DiffFindingApi,
  type DiffFindingLike,
} from "../findings";
import { s, chevronFor, findingDotFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";
import { OffPatchFindings } from "../OffPatchFindings";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

/** Findings anchored to a given parsed line (new-line side only). */
function findingsForLine(
  ln: Line,
  matched: Map<string, DiffFindingLike[]>,
): DiffFindingLike[] {
  if (matched.size === 0) return [];
  const key = findingKeyForLine(ln);
  return (key && matched.get(key)) || [];
}

export function FileCard({
  file,
  commenting,
  defaultOpen,
  findings,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /**
   * Overrides the auto-expand heuristic for this card. Smart Diff passes `false`
   * for docs and boilerplate. Applies at mount only — `open` stays uncontrolled,
   * so a manual expand survives a rerender but not a remount.
   */
  defaultOpen?: boolean;
  findings?: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    defaultOpen ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  // The same split for findings: on a rendered line, or listed at the foot.
  const allFindings = findings?.findings;
  const { fileFindings, matchedFindings, offPatchFindings } = React.useMemo(() => {
    const mine = findingsForFile(allFindings, file.path);
    if (mine.length === 0) {
      return {
        fileFindings: mine,
        matchedFindings: new Map<string, DiffFindingLike[]>(),
        offPatchFindings: [] as DiffFindingLike[],
      };
    }
    const renderedKeys = new Set<string>();
    for (const ln of lines) {
      const k = findingKeyForLine(ln);
      if (k) renderedKeys.add(k);
    }
    const { matched: m, offPatch } = partitionFindings(mine, renderedKeys);
    return { fileFindings: mine, matchedFindings: m, offPatchFindings: offPatch };
  }, [allFindings, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  // The dot ignores the visibility toggle on purpose: a marker that disappeared
  // with the cards would read as "the findings are gone".
  const worst = worstSeverity(fileFindings);
  const dotColor = worst ? (SEV_COLOR[worst] ?? SEV_COLOR_FALLBACK) : null;

  return (
    <div style={s.fileCard}>
      {/* A real <button>: this header holds only icons and text, so it can be
          one — giving focus, Enter/Space and the right role for free. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ ...s.fileHeader, width: "100%", background: "none", border: "none", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        {dotColor && (
          <span
            role="img"
            aria-label={t("diffViewer.hasFindings", { count: fileFindings.length })}
            style={findingDotFor(dotColor)}
          />
        )}
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </button>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                lineFindings={findingsForLine(ln, matchedFindings)}
                findings={findings}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
          {findings && findings.showFindings && (
            <OffPatchFindings findings={offPatchFindings} api={findings} />
          )}
        </div>
      )}
    </div>
  );
}
