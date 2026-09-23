"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Chip, SectionLabel } from "@/components/ui-client";
import { usePrIntent } from "@/lib/hooks/reviews";
import { s } from "./styles";
import { CONFIDENCE_STYLE } from "./constants";

interface PrIntentCardProps {
  prId: string | null;
}

/**
 * Why this PR was opened, as classified before the review (spec 0008).
 *
 * Renders nothing when there is no intent — a PR that was never reviewed, or
 * one whose classification failed, is the normal case, not an error state.
 *
 * The confidence band is the honest part of this card: it is computed from
 * which sources were available, not from how sure the model sounded, so `low`
 * is shown with its reason rather than hidden.
 */
export function PrIntentCard({ prId }: PrIntentCardProps) {
  const t = useTranslations("prReview");
  const { data: intent } = usePrIntent(prId);

  if (!intent) return null;

  const usedSources = intent.sources.filter((src) => src.status === "used");
  const unreadable = intent.sources.filter((src) => src.status === "unreadable");

  return (
    <section style={s.box} aria-labelledby="pr-intent-heading">
      <SectionLabel icon="Target">
        <span id="pr-intent-heading">{t("intent.title")}</span>
      </SectionLabel>

      <div style={s.head}>
        <Badge>{t(`intent.category.${intent.category}`)}</Badge>
        {/* The band is spelled out in the text, not signalled by colour alone:
            "Confidence: low" reads the same in greyscale and to a screen reader. */}
        <Badge {...CONFIDENCE_STYLE[intent.confidence]}>
          {t("intent.confidenceLabel", {
            level: t(`intent.confidence.${intent.confidence}`),
          })}
        </Badge>
      </div>

      <p style={s.purpose}>{intent.intent}</p>

      {intent.confidence === "low" && <p style={s.hint}>{t("intent.lowConfidenceHint")}</p>}

      {intent.in_scope.length > 0 && (
        <>
          <p style={s.listLabel}>{t("intent.inScope")}</p>
          <ul style={s.list}>
            {intent.in_scope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}

      {intent.out_of_scope.length > 0 && (
        <>
          <p style={s.listLabel}>{t("intent.outOfScope")}</p>
          <ul style={s.list}>
            {intent.out_of_scope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}

      <p style={s.listLabel}>{t("intent.sources.title")}</p>
      <div style={s.chips}>
        {usedSources.map((src) => (
          <Chip key={`${src.kind}:${src.ref}`}>
            {t(`intent.sources.kind.${src.kind}`)}
            {src.kind === "spec" || src.kind === "issue" ? ` · ${src.ref}` : ""}
          </Chip>
        ))}
        {/* An unreadable linked spec is shown, never dropped: it is why the
            band is capped, and the reader deserves to know a document existed. */}
        {unreadable.map((src) => (
          <Chip key={`unreadable:${src.ref}`} color="var(--warning)" icon="AlertTriangle">
            {t("intent.sources.unreadable", { ref: src.ref })}
          </Chip>
        ))}
      </div>

      {intent.evidence.length > 0 && (
        <>
          <p style={{ ...s.listLabel, marginTop: 12 }}>{t("intent.evidence.title")}</p>
          {intent.evidence.map((ev, i) => (
            <blockquote key={`${ev.ref}-${i}`} style={s.quote}>
              “{ev.quote}”
              {!ev.valid && <> — {t("intent.evidence.unverified")}</>}
            </blockquote>
          ))}
        </>
      )}

      {intent.model && (
        <p style={s.footer}>{t("intent.derivedWith", { model: intent.model })}</p>
      )}
    </section>
  );
}
