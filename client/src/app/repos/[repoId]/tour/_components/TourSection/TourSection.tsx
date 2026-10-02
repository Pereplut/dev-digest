/* TourSection — one collapsible tour section (AC-47, AC-49). The heading and
   the matching TOC label both come from the kind-keyed i18n key, never from
   the API's own `title` (AC-48, AC-61 fallback chip). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Markdown } from "@/components/ui-client";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import type { OnboardingSection } from "@/lib/types";
import { CommandList } from "../CommandList";
import { s } from "./styles";

export function TourSection({
  section,
  open,
  onToggle,
}: {
  section: OnboardingSection;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("onboarding");

  return (
    <section id={section.kind} style={s.section}>
      {/* A real <button> with no interactive descendants — a `role="button"`
          wrapper around another control breaks that control's own
          accessible-name queries (client/INSIGHTS.md), so the fallback chip
          is a non-interactive Badge, never the clickable Chip. */}
      <button type="button" aria-expanded={open} onClick={onToggle} style={s.header}>
        <span style={s.title}>{t(`tour.kinds.${section.kind}`)}</span>
        {!section.generated && <Badge icon="AlertTriangle">{t("tour.chips.fallback")}</Badge>}
        <Icon.ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .12s" }} />
      </button>
      {open && (
        <div style={s.body}>
          {section.kind === "reading_path" && <p style={s.note}>{t("tour.readingPathOrder")}</p>}

          <Markdown>{section.body}</Markdown>

          {section.diagram != null && (
            <MermaidDiagram chart={section.diagram} fallback={<p style={s.diagramUnavailable}>{t("tour.diagramUnavailable")}</p>} />
          )}

          {section.links.length > 0 && (
            <ul style={s.list}>
              {section.links.map((link) => (
                <li key={link.path}>
                  <code className="mono">{link.path}</code>
                </li>
              ))}
            </ul>
          )}

          {section.items.length > 0 && (
            <ul style={s.list}>
              {section.items.map((item, i) => (
                <li key={`${i}-${item.anchor ?? item.text}`}>
                  {item.text}
                  {item.anchor && (
                    <>
                      {" "}
                      <code className="mono">{item.anchor}</code>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <CommandList commands={section.commands} />
        </div>
      )}
    </section>
  );
}
