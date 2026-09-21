/* Presentation metadata shared by the Skills Lab components: per-type tint,
   per-source label/icon, and rate formatting. Pure — no React, no i18n calls. */
import type { SkillSource, SkillType } from "@devdigest/shared";
import type { IconName } from "@/components/ui-client";

/** Foreground tint per skill type (rubric blue, convention green, security red, custom grey). */
export const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--text-secondary)",
};

/** Background tint per skill type (pairs with TYPE_COLOR). */
export const TYPE_BG: Record<SkillType, string> = {
  rubric: "var(--accent-bg)",
  convention: "var(--ok-bg)",
  security: "var(--crit-bg)",
  custom: "var(--bg-hover)",
};

/** i18n key suffix under `skills.source.*`. Both import sources collapse into "Imported". */
export type SourceLabelKey = "manual" | "extracted" | "community" | "imported";

export const SOURCE_META: Record<SkillSource, { labelKey: SourceLabelKey; icon: IconName }> = {
  manual: { labelKey: "manual", icon: "Edit" },
  extracted: { labelKey: "extracted", icon: "Wrench" },
  community: { labelKey: "community", icon: "Globe" },
  imported_url: { labelKey: "imported", icon: "Link" },
  imported_file: { labelKey: "imported", icon: "Upload" },
};

/** A 0..1 rate as a whole percent, or null when there is nothing to divide by. */
export function ratePercent(rate: number | null | undefined): number | null {
  return rate == null ? null : Math.round(rate * 100);
}

/** "74%" or "—" for a missing rate. */
export function formatRate(rate: number | null | undefined): string {
  const p = ratePercent(rate);
  return p == null ? "—" : `${p}%`;
}

/** Accept-rate colour: green when most findings are kept, amber when mixed, red when mostly rejected. */
export function acceptColor(rate: number | null | undefined): string {
  if (rate == null) return "var(--text-muted)";
  if (rate >= 0.5) return "var(--ok)";
  if (rate >= 0.3) return "var(--warn)";
  return "var(--crit)";
}
