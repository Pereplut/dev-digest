/* SkillsPromptBlocks — the `## Skills` part of the SYSTEM message. With
   `skills_used` (spec 0006+) it renders one sub-block per skill ("name · vN",
   its tokens); older traces, or a block that doesn't split cleanly, fall back
   to the single block. Disabled skills never appear: the server omits them. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { SkillUsed } from "@devdigest/shared";
import { PROMPT_COLORS } from "../../constants";
import { splitSkillsBlock } from "../../helpers";
import { s } from "../../styles";
import { PromptBlock } from "../PromptBlock";

export function SkillsPromptBlocks({
  text,
  used,
  tokens,
}: {
  text: string;
  used: readonly SkillUsed[] | null | undefined;
  /** Whole-slot token estimate; null on old traces. */
  tokens: number | null;
}) {
  const t = useTranslations("runs");
  const parts = splitSkillsBlock(text, used);
  const label = t("trace.prompt.skills");
  if (!parts) return <PromptBlock label={label} text={text} color={PROMPT_COLORS.skills} tokens={tokens} />;
  return (
    <div role="group" aria-label={label} style={s.skillsGroup}>
      <div style={s.skillsGroupHead}>
        <span style={s.promptDot(PROMPT_COLORS.skills)} />
        <span style={s.promptLabel}>{label}</span>
        {tokens != null && (
          <span className="mono" style={s.promptTokens}>
            {t("trace.prompt.tokens", { count: tokens })}
          </span>
        )}
      </div>
      {parts.map((p) => (
        <PromptBlock
          key={p.name}
          label={t("trace.prompt.skill", { name: p.name, version: p.version })}
          text={p.text}
          color={PROMPT_COLORS.skills}
          tokens={p.tokens}
        />
      ))}
    </div>
  );
}
