/* ImportSkillModal — two steps: pick a .md/.zip/.skill file (parsed on the
   server, which persists NOTHING), then review the parsed draft, the ignored
   files and a trust warning before Confirm creates the skill. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { SkillImportPreview } from "@devdigest/shared";
import { Badge, Button, Icon, Markdown, Modal, TextInput } from "@/components/ui-client";
import { useCreateSkill, usePreviewSkillImport } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { TYPE_BG, TYPE_COLOR } from "../../_lib/skill-meta";
import { ACCEPT } from "./constants";
import { isExecutableReason, nameBlocked } from "./helpers";
import { s } from "./styles";

export function ImportSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const parse = usePreviewSkillImport();
  const create = useCreateSkill();
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);
  const [name, setName] = React.useState("");

  const onFile = (file: File | undefined) => {
    if (!file) return;
    parse.mutate(file, {
      onSuccess: (p) => {
        setPreview(p);
        setName(p.draft.name);
      },
    });
  };

  const confirm = () => {
    if (!preview || nameBlocked(preview, name)) return;
    create.mutate(
      { ...preview.draft, name: name.trim(), source: "imported_file" },
      {
        onSuccess: (skill) => {
          toast.success(t("import.importedToast", { name: skill.name }));
          onClose();
          router.push(`/skills/${skill.id}?tab=preview`);
        },
      },
    );
  };

  const blocked = preview ? nameBlocked(preview, name) : true;

  return (
    <Modal
      width={760}
      title={t("import.title")}
      subtitle={t("import.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {preview && (
            <Button kind="ghost" icon="ChevronLeft" onClick={() => setPreview(null)}>
              {t("import.back")}
            </Button>
          )}
          <span style={s.spacer} />
          <Button kind="secondary" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          {preview && (
            <Button kind="primary" icon="Check" onClick={confirm} disabled={blocked} loading={create.isPending}>
              {create.isPending ? t("import.saving") : t("import.confirm")}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.body}>
        {preview ? (
          <PreviewStep
            preview={preview}
            name={name}
            onName={setName}
            error={create.error ? t("import.error", { message: create.error.message }) : null}
          />
        ) : (
          <PickStep
            onFile={onFile}
            parsing={parse.isPending}
            error={parse.error ? t("import.error", { message: parse.error.message }) : null}
          />
        )}
      </div>
    </Modal>
  );
}

function PickStep({
  onFile,
  parsing,
  error,
}: {
  onFile: (f: File | undefined) => void;
  parsing: boolean;
  error: string | null;
}) {
  const t = useTranslations("skills");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [hot, setHot] = React.useState(false);
  return (
    <>
      <div
        style={s.dropZone(hot)}
        onDragOver={(e) => {
          e.preventDefault();
          setHot(true);
        }}
        onDragLeave={() => setHot(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHot(false);
          onFile(e.dataTransfer.files[0]);
        }}
      >
        <Icon.Upload size={22} aria-hidden />
        <span>{t("import.drop")}</span>
        <Button kind="secondary" icon="FileText" loading={parsing} onClick={() => inputRef.current?.click()}>
          {parsing ? t("import.parsing") : t("import.choose")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          aria-label={t("import.fileLabel")}
          style={s.hiddenInput}
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = ""; // let the same file be picked again after an error
          }}
        />
      </div>
      <p style={s.muted}>{t("import.accepted")}</p>
      {error && (
        <div role="alert" style={s.error}>
          {error}
        </div>
      )}
    </>
  );
}

function PreviewStep({
  preview,
  name,
  onName,
  error,
}: {
  preview: SkillImportPreview;
  name: string;
  onName: (v: string) => void;
  error: string | null;
}) {
  const t = useTranslations("skills");
  const { draft } = preview;
  const conflict = nameBlocked(preview, name) && name.trim() !== "";
  return (
    <>
      <div role="note" style={s.warning}>
        <Icon.AlertTriangle size={16} style={s.warningIcon} aria-hidden />
        <div>
          <div style={s.warningTitle}>{t("import.trustTitle")}</div>
          {t("import.trustBody")}
        </div>
      </div>

      <div style={s.metaRow}>
        <Badge color={TYPE_COLOR[draft.type]} bg={TYPE_BG[draft.type]}>
          {t(`type.${draft.type}`)}
        </Badge>
        <span style={s.muted}>{t("import.from", { filename: preview.source_filename })}</span>
      </div>

      <div>
        <label style={s.label} htmlFor="import-skill-name">
          {t("import.nameLabel")}
        </label>
        <TextInput id="import-skill-name" value={name} onChange={onName} mono aria-invalid={conflict} />
        {conflict && <div style={s.fieldError}>{t("import.nameConflict")}</div>}
      </div>

      <div>
        <div style={s.label}>{t("import.descriptionLabel")}</div>
        <p style={s.description}>{draft.description}</p>
      </div>

      <div>
        <div style={s.label}>{t("import.bodyLabel")}</div>
        <div style={s.bodyBox}>
          <Markdown>{draft.body}</Markdown>
        </div>
      </div>

      <div>
        <div style={s.label}>{t("import.ignoredTitle")}</div>
        {preview.ignored_files.length === 0 ? (
          <p style={s.muted}>{t("import.ignoredEmpty")}</p>
        ) : (
          <ul style={s.ignoredList}>
            {preview.ignored_files.map((f) => {
              const exec = isExecutableReason(f.reason);
              return (
                <li key={f.path} style={s.ignoredRow(exec)}>
                  {exec ? <Icon.AlertOctagon size={13} aria-hidden /> : <Icon.File size={13} aria-hidden />}
                  <span className="mono" style={s.ignoredPath}>
                    {f.path}
                  </span>
                  <span>{exec ? t("import.executable") : f.reason}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && (
        <div role="alert" style={s.error}>
          {error}
        </div>
      )}
    </>
  );
}
