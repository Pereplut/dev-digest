/* CreateSkillModal — "Create skill from conventions".

   The server supplies DEFAULTS only. Everything here — name, description, type,
   enabled and the whole markdown body — is editable before saving (homework
   criterion 41), and what the user submits is exactly what gets stored. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ConventionSkillDefaults, SkillType } from "@devdigest/shared";
import {
  Button,
  FormField,
  Icon,
  Markdown,
  Modal,
  SelectInput,
  TextInput,
  Textarea,
  Toggle,
} from "@/components/ui-client";
import { BODY_ROWS, DRAFT_LIMITS, TYPE_OPTIONS, approxTokens } from "./constants";
import { hasErrors, validateDraft, type DraftErrors } from "./helpers";
import { s } from "./styles";

export interface CreateSkillModalProps {
  repoName: string;
  acceptedCount: number;
  defaults: ConventionSkillDefaults;
  saving: boolean;
  serverError: string | null;
  onCancel: () => void;
  onSubmit: (draft: {
    name: string;
    description: string;
    type: SkillType;
    body: string;
    enabled: boolean;
  }) => void;
}

export function CreateSkillModal({
  repoName,
  acceptedCount,
  defaults,
  saving,
  serverError,
  onCancel,
  onSubmit,
}: CreateSkillModalProps) {
  const t = useTranslations("conventions");
  const [name, setName] = React.useState(defaults.name);
  const [description, setDescription] = React.useState(defaults.description);
  const [type, setType] = React.useState<SkillType>(defaults.type);
  const [body, setBody] = React.useState(defaults.body);
  const [enabled, setEnabled] = React.useState(true);
  const [mode, setMode] = React.useState<"write" | "preview">("write");
  const [errors, setErrors] = React.useState<DraftErrors>({});

  const dirty = body !== defaults.body;

  const submit = () => {
    const next = validateDraft({ name, description, body });
    setErrors(next);
    if (hasErrors(next)) return;
    onSubmit({ name: name.trim(), description: description.trim(), type, body, enabled });
  };

  const err = (field: keyof DraftErrors) => {
    const e = errors[field];
    return e ? <p style={s.error}>{t(`create.errors.${e.key}`, e.values)}</p> : null;
  };

  return (
    <Modal
      width={820}
      title={t("create.title")}
      subtitle={name}
      onClose={onCancel}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>
            <Icon.GitBranch size={12} aria-hidden />
            {t("create.footer")}
          </span>
          <span style={s.footerActions}>
            <Button kind="ghost" onClick={onCancel} disabled={saving}>
              {t("create.cancel")}
            </Button>
            <Button kind="primary" icon="Sparkles" onClick={submit} loading={saving}>
              {t("create.submit")}
            </Button>
          </span>
        </div>
      }
    >
      <div style={s.banner}>
        <Icon.Wrench size={15} aria-hidden />
        <span>{t("create.banner", { count: acceptedCount, repo: repoName })}</span>
      </div>

      <div style={s.form}>
        <FormField label={t("create.name")} required>
          <TextInput value={name} onChange={setName} mono maxLength={DRAFT_LIMITS.name} />
          {err("name")}
        </FormField>

        <FormField label={t("create.description")}>
          <TextInput
            value={description}
            onChange={setDescription}
            maxLength={DRAFT_LIMITS.description}
          />
          {err("description")}
        </FormField>

        <div style={s.row}>
          <FormField label={t("create.type")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={[...TYPE_OPTIONS]}
              mono
            />
          </FormField>
          <FormField label={t("create.enabled")}>
            <label style={s.toggleRow}>
              <Toggle on={enabled} onChange={setEnabled} />
              <span style={s.srOnly}>{t("create.enabled")}</span>
            </label>
            <p style={s.enabledHint}>{t("create.enabledHint")}</p>
          </FormField>
        </div>

        <FormField
          label={t("create.body")}
          required
          right={
            <Button
              kind="ghost"
              size="sm"
              onClick={() => setMode(mode === "write" ? "preview" : "write")}
            >
              {mode === "write" ? t("create.previewTab") : t("create.write")}
            </Button>
          }
        >
          <div style={s.bodyHeader}>
            <span className="mono" style={s.fileName}>
              <Icon.FileText size={13} aria-hidden />
              {t("create.bodyFile", { name })}
              {dirty ? <em>{t("create.unsaved")}</em> : null}
            </span>
            <span style={s.tokens}>{t("create.tokens", { count: approxTokens(body) })}</span>
          </div>
          {mode === "write" ? (
            <Textarea value={body} onChange={setBody} rows={BODY_ROWS} mono />
          ) : (
            <div style={s.previewBox}>
              {body.trim() ? (
                <Markdown>{body}</Markdown>
              ) : (
                <span style={s.previewEmpty}>{t("create.previewEmpty")}</span>
              )}
            </div>
          )}
          {err("body")}
        </FormField>

        {serverError ? <p style={s.error}>{serverError}</p> : null}
      </div>
    </Modal>
  );
}
