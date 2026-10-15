"use client";

import { useTranslations } from "next-intl";
import { Badge, Card, SectionLabel, Toggle } from "@/components/ui-client";
import type { CiTrigger } from "@devdigest/shared";
import { POST_AS_I18N_KEY, POST_AS_VALUES, TRIGGER_KEYS } from "../../constants";
import { s } from "../../styles";
import type { PostAs, TriggerState } from "../../types";

/** Step 3 — triggers, post-as, the secrets the repo needs (instructions only,
 *  no request and no set/not-set state — AC-66) and the branch-protection note
 *  (AC-67). Once the workflow is edited, a notice replaces regeneration (AC-81). */
export function ConfigureStep({
  triggers,
  onToggleTrigger,
  postAs,
  onChangePostAs,
  edited,
}: {
  triggers: TriggerState;
  onToggleTrigger: (key: CiTrigger) => void;
  postAs: PostAs;
  onChangePostAs: (value: PostAs) => void;
  edited: boolean;
}) {
  const t = useTranslations("ci");
  return (
    <div style={s.body}>
      {edited && (
        <div role="status" style={s.notice}>
          {t("exportWizard.editedNotice")}
        </div>
      )}

      <div>
        <SectionLabel>{t("exportWizard.triggerLabel")}</SectionLabel>
        <Card>
          <div style={s.stack}>
            {TRIGGER_KEYS.map((key) => (
              <label key={key} style={s.toggleRow}>
                <span style={{ fontSize: 13.5 }}>{t(`exportWizard.triggers.${key}`)}</span>
                <Toggle on={triggers[key]} onChange={() => onToggleTrigger(key)} />
              </label>
            ))}
          </div>
        </Card>
      </div>

      <div>
        <SectionLabel>{t("exportWizard.postResultsLabel")}</SectionLabel>
        <div role="radiogroup" aria-label={t("exportWizard.postResultsLabel")} style={s.stack}>
          {POST_AS_VALUES.map((option) => (
            <label key={option} style={s.radioRow}>
              <input
                type="radio"
                name="post-as"
                value={option}
                checked={postAs === option}
                onChange={() => onChangePostAs(option)}
              />
              {t(`exportWizard.postAs.${POST_AS_I18N_KEY[option]}`)}
              {option === "github_review" && <Badge color="var(--ok)">{t("exportWizard.recommended")}</Badge>}
            </label>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>{t("exportWizard.secrets.heading")}</SectionLabel>
        <Card>
          <div style={s.stack}>
            <div style={s.muted}>{t("exportWizard.secrets.intro")}</div>
            <div style={{ fontSize: 13 }}>
              <span className="mono">OPENROUTER_API_KEY</span> — {t("exportWizard.secrets.openrouter")}
            </div>
            <div style={{ fontSize: 13 }}>
              <span className="mono">GITHUB_TOKEN</span> — {t("exportWizard.secrets.githubToken")}
            </div>
          </div>
        </Card>
      </div>

      <div style={s.muted}>{t("exportWizard.branchProtectionNote")}</div>
    </div>
  );
}
