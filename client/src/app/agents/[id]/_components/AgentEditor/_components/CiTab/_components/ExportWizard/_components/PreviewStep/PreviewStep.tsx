"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, SectionLabel, Skeleton, Textarea } from "@/components/ui-client";
import type { CiFile } from "@devdigest/shared";
import { WORKFLOW_PATH } from "../../constants";
import { s } from "../../styles";

/** Step 2 — every file path from the `files` export; the selected file's
 *  contents below it. Only the workflow is editable (AC-63). */
export function PreviewStep({
  loading,
  error,
  files,
  selectedPath,
  onSelect,
  onWorkflowChange,
}: {
  loading: boolean;
  error: string | null;
  files: CiFile[] | null;
  selectedPath: string;
  onSelect: (path: string) => void;
  onWorkflowChange: (contents: string) => void;
}) {
  const t = useTranslations("ci");

  if (loading && !files) {
    return (
      <div style={s.body} aria-busy="true" aria-label={t("exportWizard.preview.loading")}>
        <Skeleton height={20} />
        <Skeleton height={20} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (error) {
    return (
      <div style={s.body}>
        <ErrorState title={t("exportWizard.previewErrorTitle")} body={error} />
      </div>
    );
  }
  if (!files) return null;

  const selected = files.find((f) => f.path === selectedPath) ?? files[0];
  const isWorkflow = selected?.path === WORKFLOW_PATH;

  return (
    <div style={s.body}>
      <div>
        <SectionLabel>{t("exportWizard.preview.filesLabel", { count: files.length })}</SectionLabel>
        <ul style={s.files}>
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className="mono"
                aria-current={f.path === selected?.path}
                onClick={() => onSelect(f.path)}
                style={{
                  ...s.fileBtn,
                  background: f.path === selected?.path ? "var(--bg-hover)" : "transparent",
                }}
              >
                {f.path}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected && (
        <div>
          <SectionLabel
            right={
              <Badge>{isWorkflow ? t("exportWizard.editable") : t("exportWizard.readOnly")}</Badge>
            }
          >
            {t("exportWizard.preview.contentsLabel", { path: selected.path })}
          </SectionLabel>
          {isWorkflow ? (
            <>
              <Textarea value={selected.contents} onChange={onWorkflowChange} rows={14} mono />
              <div style={s.muted}>{t("exportWizard.preview.workflowHint")}</div>
            </>
          ) : (
            <pre className="mono" style={s.pre}>
              {selected.contents}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
