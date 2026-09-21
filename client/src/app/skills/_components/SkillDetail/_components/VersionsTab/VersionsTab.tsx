/* VersionsTab (design tab_5) — every save's snapshot, newest first. Older rows
   can be diffed against the current body or restored (restore = a new version). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { Badge, Button, EmptyState, ErrorState, Modal, Skeleton } from "@/components/ui-client";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { DIFF_MARK } from "./constants";
import { formatDate, sortVersions, toDiffRows } from "./helpers";
import { s } from "./styles";

function DiffModal({ older, current, onClose }: { older: SkillVersion; current: Skill; onClose: () => void }) {
  const t = useTranslations("skills");
  const rows = toDiffRows(older.body, current.body);
  const changed = rows.some((r) => r.kind !== "same");
  return (
    <Modal
      width={860}
      title={t("versions.diffTitle", { from: older.version, to: current.version })}
      subtitle={t("versions.diffSubtitle", { from: older.version })}
      onClose={onClose}
    >
      {changed ? (
        <div className="mono" style={s.diffBox}>
          {rows.map((r, i) => (
            // Index keys are safe: the rows are derived, static and never reordered.
            <div key={i} style={s.diffRow(r.kind)}>
              <span style={s.diffMark} aria-hidden>
                {DIFF_MARK[r.kind]}
              </span>
              <span>{r.text || " "}</span>
            </div>
          ))}
        </div>
      ) : (
        <p style={s.diffEmpty}>{t("versions.noChanges")}</p>
      )}
    </Modal>
  );
}

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffing, setDiffing] = React.useState<SkillVersion | null>(null);

  if (isLoading) return <Skeleton height={200} />;
  if (isError || !data) return <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />;

  const versions = sortVersions(data);
  const latest = versions[0]?.version ?? skill.version;

  const onRestore = (v: SkillVersion) => {
    if (!window.confirm(t("versions.restoreConfirm", { version: v.version }))) return;
    restore.mutate(
      { id: skill.id, version: v.version },
      { onSuccess: (saved) => toast.success(t("versions.restoredToast", { from: v.version, to: saved.version })) },
    );
  };

  return (
    <section style={s.wrap}>
      {diffing && <DiffModal older={diffing} current={skill} onClose={() => setDiffing(null)} />}
      <div style={s.head}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <Badge>{t("versions.count", { count: versions.length })}</Badge>
      </div>
      <p style={s.hint}>{t("versions.hint")}</p>

      {versions.length === 0 ? (
        <EmptyState icon="History" title={t("versions.empty")} />
      ) : (
        <ul style={s.list}>
          {versions.map((v) => {
            const isCurrent = v.version === latest;
            return (
              <li key={v.version} style={s.row} aria-label={t("detail.version", { version: v.version })}>
                <span className="mono" style={s.versionPill(isCurrent)}>
                  {t("detail.version", { version: v.version })}
                </span>
                <div style={s.rowText}>
                  <div style={s.message}>{v.message || t("versions.edited")}</div>
                  <div className="mono" style={s.date}>
                    {formatDate(v.created_at)}
                  </div>
                </div>
                {isCurrent ? (
                  <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
                    {t("versions.current")}
                  </Badge>
                ) : (
                  <div style={s.actions}>
                    <Button kind="ghost" size="sm" icon="Eye" onClick={() => setDiffing(v)}>
                      {t("versions.diff")}
                    </Button>
                    <Button
                      kind="secondary"
                      size="sm"
                      icon="History"
                      onClick={() => onRestore(v)}
                      disabled={restore.isPending}
                    >
                      {t("versions.restore")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
