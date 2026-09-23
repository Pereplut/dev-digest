import type { IntentConfidence } from "@devdigest/shared";

/**
 * Badge colours per confidence band.
 *
 * Decoration only. The band is always spelled out in the badge TEXT ("Confidence:
 * high"), so the meaning survives greyscale, colour blindness and a screen
 * reader — nothing here is the sole carrier.
 */
export const CONFIDENCE_STYLE: Record<IntentConfidence, { color: string; bg: string }> = {
  high: { color: "var(--success)", bg: "var(--success-bg, var(--bg-hover))" },
  medium: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
  low: { color: "var(--warning)", bg: "var(--warning-bg, var(--bg-hover))" },
};
