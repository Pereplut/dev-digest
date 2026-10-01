/* TourToc — the five-link table of contents (AC-47). Hidden below the
   Tailwind `md` breakpoint (AC-72). Activating a link whose target section is
   collapsed expands it (AC-71); the anchor's native `#<kind>` scroll does the
   rest, so this component never calls `scrollIntoView` itself. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { OnboardingSectionKind } from "@/lib/types";
import { SECTION_KINDS } from "../OnboardingTour/constants";
import { s } from "./styles";

export function TourToc({ onNavigate }: { onNavigate: (kind: OnboardingSectionKind) => void }) {
  const t = useTranslations("onboarding");

  return (
    <nav aria-label={t("tour.breadcrumb")} className="hidden md:block" style={s.nav}>
      <ul style={s.list}>
        {SECTION_KINDS.map((kind) => (
          <li key={kind}>
            <a href={`#${kind}`} style={s.link} onClick={() => onNavigate(kind)}>
              {t(`tour.kinds.${kind}`)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
