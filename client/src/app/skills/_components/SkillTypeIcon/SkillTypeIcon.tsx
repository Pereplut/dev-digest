/* SkillTypeIcon — the sparkles glyph in a rounded box, tinted by skill type. */
import React from "react";
import type { SkillType } from "@devdigest/shared";
import { Icon } from "@/components/ui-client";
import { TYPE_BG, TYPE_COLOR } from "../../_lib/skill-meta";

export function SkillTypeIcon({ type, size = 26 }: { type: SkillType; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: TYPE_BG[type],
        color: TYPE_COLOR[type],
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <Icon.Sparkles size={Math.round(size * 0.55)} />
    </span>
  );
}
