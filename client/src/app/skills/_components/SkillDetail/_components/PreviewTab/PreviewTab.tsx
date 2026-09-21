/* PreviewTab — the skill exactly as the reviewing agent receives it: the
   `### Skill: <name>` block rendered as markdown, plus its token cost. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { Icon, Markdown } from "@/components/ui-client";
import { renderSkillBlock } from "./helpers";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <section style={s.wrap}>
      <h2 style={s.h2}>{t("preview.title")}</h2>
      <p style={s.subtitle}>{t("preview.subtitle")}</p>
      <div style={s.card}>
        <Markdown>{renderSkillBlock(skill.name, skill.body)}</Markdown>
      </div>
      <p style={s.tokens}>
        <Icon.Hash size={13} aria-hidden />
        {skill.token_count != null ? t("preview.tokens", { count: skill.token_count }) : t("preview.tokensUnknown")}
      </p>
    </section>
  );
}
