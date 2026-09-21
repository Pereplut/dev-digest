/* ConventionCard — one extracted convention: the rule, the evidence the server
   verified against the repository, a confidence meter, and accept/reject/edit.

   The card is NOT itself clickable: every action is a real button, so there is
   no nested-interactive problem and keyboard users get the controls directly. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import { Badge, Button, Icon, ProgressBar, TextInput } from "@/components/ui-client";
import { EvidenceBlock } from "../EvidenceBlock/EvidenceBlock";
import { confidenceColor, confidencePercent, formatLocation, rejectReasonKey } from "./helpers";
import { s } from "./styles";

export interface ConventionCardProps {
  candidate: ConventionCandidate;
  onAccept: () => void;
  onReject: () => void;
  onEditRule: (rule: string) => void;
}

export function ConventionCard({ candidate, onAccept, onReject, onEditRule }: ConventionCardProps) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);

  const accepted = candidate.status === "accepted";
  const rejected = candidate.status === "rejected";
  const pct = confidencePercent(candidate.confidence);
  const reasonKey = rejectReasonKey(candidate.rejected_reason);

  const startEdit = () => {
    setDraft(candidate.rule);
    setEditing(true);
  };

  const save = () => {
    const next = draft.trim();
    if (next && next !== candidate.rule) onEditRule(next);
    setEditing(false);
  };

  return (
    <div style={s.card(accepted, rejected)}>
      <div style={s.main}>
        {editing ? (
          <div style={s.editRow}>
            <TextInput
              value={draft}
              onChange={setDraft}
              aria-label={t("card.editLabel")}
              placeholder={t("card.editLabel")}
            />
            <div style={s.editActions}>
              <Button kind="primary" size="sm" onClick={save}>
                {t("card.save")}
              </Button>
              <Button kind="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("card.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div style={s.titleRow}>
            <h3 style={s.rule}>{candidate.rule}</h3>
            <Badge color="var(--text-secondary)" bg="var(--bg-hover)">
              {t(`category.${candidate.category}`)}
            </Badge>
          </div>
        )}

        {candidate.evidence_path ? (
          <EvidenceBlock location={formatLocation(candidate)} snippet={candidate.evidence_snippet} />
        ) : null}

        {!candidate.evidence_valid ? (
          <p style={s.warning}>
            <Icon.AlertTriangle size={13} aria-hidden />
            {reasonKey ? t(reasonKey) : t("card.unverified")}
          </p>
        ) : null}

        <div style={s.confidenceRow}>
          <span>{t("card.confidence")}</span>
          <span style={s.bar}>
            <ProgressBar value={pct} color={confidenceColor(candidate.confidence)} />
          </span>
          <span className="tnum" style={s.percent}>
            {pct}%
          </span>
        </div>
      </div>

      <div style={s.actions}>
        <Button
          kind={accepted ? "primary" : "secondary"}
          size="sm"
          full
          icon={accepted ? "Check" : undefined}
          onClick={onAccept}
        >
          {accepted ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind={rejected ? "danger" : "ghost"}
          size="sm"
          full
          icon="X"
          onClick={onReject}
        >
          {rejected ? t("card.rejected") : t("card.reject")}
        </Button>
        {!editing ? (
          <Button kind="ghost" size="sm" full icon="Edit" onClick={startEdit}>
            {t("card.edit")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
