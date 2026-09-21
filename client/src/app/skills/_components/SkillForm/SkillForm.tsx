/* SkillForm — create a skill (/skills/new) or edit one (Config tab). Validates
   against the shared SkillDraft contract before sending; the server's 409/422
   message is shown inline. Every save of an existing skill creates a version. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Skill, SkillDraft, SkillType } from "@devdigest/shared";
import { Button, FormField, Markdown, SelectInput, TextInput, Textarea } from "@/components/ui-client";
import { useCreateSkill, useDeleteSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { BODY_ROWS, INLINE_ERROR_STATUSES, TYPE_OPTIONS } from "./constants";
import { initialValues, validateDraft, withoutEmptyMessage, type DraftErrors, type DraftField } from "./helpers";
import { s } from "./styles";

/** The server message for a 409/422, which belongs on the form rather than only in a toast. */
function inlineServerError(err: unknown): ApiError | null {
  return err instanceof ApiError && (INLINE_ERROR_STATUSES as readonly number[]).includes(err.status) ? err : null;
}

export function SkillForm({ skill }: { skill?: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const [values, setValues] = React.useState<SkillDraft>(() => initialValues(skill));
  const [errors, setErrors] = React.useState<DraftErrors>({});
  const [mode, setMode] = React.useState<"write" | "preview">("write");

  const set = (field: DraftField) => (v: string) => setValues((prev) => ({ ...prev, [field]: v }));
  const fieldError = (field: DraftField) => {
    const e = errors[field];
    return e ? (
      <div role="alert" style={s.fieldError}>
        {t(`form.errors.${e.key}`, e.values)}
      </div>
    ) : null;
  };

  const pending = create.isPending || update.isPending;
  const serverError = inlineServerError(skill ? update.error : create.error);

  const submit = () => {
    const { draft, errors: next } = validateDraft(values);
    setErrors(next);
    if (!draft) return;
    const body = withoutEmptyMessage(draft);
    if (skill) {
      update.mutate(
        { id: skill.id, patch: body },
        { onSuccess: (saved) => toast.success(t("form.savedToast", { version: saved.version })) },
      );
    } else {
      create.mutate(body, {
        onSuccess: (created) => {
          toast.success(t("form.createdToast"));
          router.push(`/skills/${created.id}?tab=preview`);
        },
      });
    }
  };

  const cancel = () => {
    if (!skill) {
      router.push("/skills");
      return;
    }
    setValues(initialValues(skill));
    setErrors({});
  };

  const remove = () => {
    if (!skill) return;
    const count = skill.stats?.agent_count ?? 0;
    if (!window.confirm(t("form.deleteConfirm", { name: skill.name, count }))) return;
    del.mutate(skill.id, {
      onSuccess: () => {
        toast.success(t("form.deletedToast"));
        router.push("/skills");
      },
    });
  };

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{skill ? t("form.title") : t("form.newTitle")}</h2>

      <FormField label={t("form.name")} required>
        <TextInput
          value={values.name}
          onChange={set("name")}
          placeholder={t("form.namePlaceholder")}
          aria-label={t("form.name")}
          aria-invalid={!!errors.name}
          mono
        />
        {fieldError("name")}
      </FormField>

      <FormField label={t("form.description")} hint={t("form.descriptionHint")} required>
        <TextInput
          value={values.description}
          onChange={set("description")}
          aria-label={t("form.description")}
          aria-invalid={!!errors.description}
        />
        {fieldError("description")}
      </FormField>

      <FormField label={t("form.type")}>
        <SelectInput
          value={values.type}
          onChange={(v) => setValues((prev) => ({ ...prev, type: v as SkillType }))}
          options={TYPE_OPTIONS.map((v) => ({ value: v, label: t(`type.${v}`) }))}
        />
      </FormField>

      <FormField
        label={t("form.body")}
        hint={t("form.bodyHint")}
        required
        right={
          <div style={s.modeSwitch}>
            <Button kind="tertiary" size="sm" active={mode === "write"} aria-pressed={mode === "write"} onClick={() => setMode("write")}>
              {t("form.write")}
            </Button>
            <Button
              kind="tertiary"
              size="sm"
              active={mode === "preview"}
              aria-pressed={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              {t("form.preview")}
            </Button>
          </div>
        }
      >
        {mode === "write" ? (
          <Textarea value={values.body} onChange={set("body")} rows={BODY_ROWS} mono placeholder="## …" />
        ) : (
          <div style={s.previewBox}>
            {values.body.trim() ? <Markdown>{values.body}</Markdown> : <span style={s.previewEmpty}>{t("form.previewEmpty")}</span>}
          </div>
        )}
        {fieldError("body")}
      </FormField>

      {skill && (
        <FormField label={t("form.message")}>
          <TextInput
            value={values.message ?? ""}
            onChange={set("message")}
            placeholder={t("form.messagePlaceholder")}
            aria-label={t("form.message")}
          />
          {fieldError("message")}
        </FormField>
      )}

      {serverError && (
        <div role="alert" style={s.serverError}>
          {t("form.serverError", { message: serverError.message })}
        </div>
      )}

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={submit} loading={pending}>
          {pending ? t("form.saving") : skill ? t("form.save") : t("form.create")}
        </Button>
        <Button kind="secondary" onClick={cancel} disabled={pending}>
          {t("form.cancel")}
        </Button>
        <span style={s.spacer} />
        {skill && (
          <Button kind="danger" icon="Trash" onClick={remove} loading={del.isPending}>
            {t("form.delete")}
          </Button>
        )}
      </div>
    </div>
  );
}
