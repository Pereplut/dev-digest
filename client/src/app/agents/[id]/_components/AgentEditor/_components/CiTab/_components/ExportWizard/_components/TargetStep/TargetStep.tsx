"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Card, FormField, Icon, TextInput } from "@/components/ui-client";
import { useRepos } from "@/lib/hooks";
import { isValidRepo } from "../../helpers";
import { s } from "../../styles";

/** Step 1 — GitHub Actions is the only target (AC-62); the repository is an
 *  `owner/name` input with the workspace's repos as suggestions (AC-83). */
export function TargetStep({ repo, onRepoChange }: { repo: string; onRepoChange: (value: string) => void }) {
  const t = useTranslations("ci");
  const repos = useRepos();
  const listId = React.useId();
  const invalid = repo.trim().length > 0 && !isValidRepo(repo);

  return (
    <div style={s.body}>
      <div role="radiogroup" aria-label={t("exportWizard.targetsLabel")}>
        <Card>
          <div role="radio" aria-checked="true" style={s.targetCard}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Workflow size={16} />
              <span style={s.targetTitle}>{t("exportWizard.targets.gha")}</span>
            </span>
            <Badge color="var(--ok)">{t("exportWizard.recommended")}</Badge>
          </div>
          <div style={s.muted}>{t("exportWizard.targets.ghaDesc")}</div>
        </Card>
      </div>

      <FormField label={t("exportWizard.repoLabel")} hint={t("exportWizard.repoHint")} required>
        <TextInput
          value={repo}
          onChange={onRepoChange}
          placeholder={t("exportWizard.repoPlaceholder")}
          mono
          list={listId}
          aria-label={t("exportWizard.repoLabel")}
          aria-invalid={invalid}
          autoComplete="off"
        />
        <datalist id={listId}>
          {(repos.data ?? []).map((r) => (
            <option key={r.id} value={r.full_name} />
          ))}
        </datalist>
        {invalid && (
          <div role="alert" style={s.error}>
            {t("exportWizard.repoInvalid")}
          </div>
        )}
      </FormField>
    </div>
  );
}
