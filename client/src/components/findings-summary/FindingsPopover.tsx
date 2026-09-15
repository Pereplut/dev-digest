/* FindingsPopover — wraps severity chips; hovering or focusing them opens a
   READ-ONLY card previewing the findings (severity, title, category,
   file:lines, confidence, 2-line rationale) with no buttons or links. The card
   is portalled to <body> with position:fixed so the PR list's and timeline's
   containers can't clip it, and clicks are stopped so the surrounding row
   (PRRow navigates on click) never fires. Actions on findings (Accept/Reject)
   live only on the PR page's Review runs cards. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { lineRange } from "./helpers";
import { s } from "./styles";

const CARD_WIDTH = 400;
const CARD_MAX_HEIGHT = 340;
const GAP = 6;
const MARGIN = 8;
const CLOSE_DELAY_MS = 120;

type Position = { top?: number; bottom?: number; left: number };

export function FindingsPopover({
  children,
  label,
  title,
  findings,
  loading = false,
  delayMs = 150,
  onOpenChange,
}: {
  /** The trigger content (severity chips). */
  children: React.ReactNode;
  /** Accessible name of the trigger, e.g. "1 critical, 2 warnings". */
  label: string;
  /** Card header, e.g. "2 findings in this run". */
  title: string;
  findings: FindingRecord[];
  /** Findings are still being fetched (PR list loads them on first open). */
  loading?: boolean;
  /** Hover/focus open delay; 0 opens and closes synchronously (tests). */
  delayMs?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("prReview.findingsSummary");
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pos, setPos] = React.useState<Position | null>(null);
  const cardId = React.useId();
  const open = pos != null;

  const clearTimers = React.useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }, []);

  const place = React.useCallback((): Position | null => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return null;
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - CARD_WIDTH - MARGIN));
    const roomBelow = window.innerHeight - r.bottom - GAP - MARGIN;
    const roomAbove = r.top - GAP - MARGIN;
    return roomBelow < CARD_MAX_HEIGHT && roomAbove > roomBelow
      ? { bottom: window.innerHeight - r.top + GAP, left }
      : { top: r.bottom + GAP, left };
  }, []);

  const close = React.useCallback(() => {
    clearTimers();
    setPos(null);
  }, [clearTimers]);

  const openNow = React.useCallback(() => {
    clearTimers();
    setPos(place());
  }, [clearTimers, place]);

  const openSoon = () => {
    clearTimers();
    if (delayMs <= 0) openNow();
    else openTimer.current = setTimeout(openNow, delayMs);
  };

  // Leaving the trigger toward the card must not close it: a short grace period
  // that entering (or focusing) the card cancels.
  const closeSoon = () => {
    clearTimeout(openTimer.current);
    if (delayMs <= 0) close();
    else closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
  };

  React.useEffect(() => {
    onOpenChange?.(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // While open: Escape closes; scrolling (the app scrolls an inner container,
  // hence capture) or resizing would detach the fixed card, so close instead.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  React.useEffect(() => clearTimers, [clearTimers]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      {/* The trigger is the disclosure control (outside the card): focusable so
          keyboard users can open the preview, named by its counts. */}
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        style={s.trigger}
        onMouseEnter={openSoon}
        onMouseLeave={closeSoon}
        onFocus={openSoon}
        onBlur={closeSoon}
        onClick={stop}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            if (open) close();
            else openNow();
          }
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          // React events bubble through portals along the component tree, so
          // clicks here must be stopped too or PRRow would navigate.
          <div
            id={cardId}
            role="dialog"
            aria-label={title}
            style={s.card(pos)}
            onClick={stop}
            onMouseEnter={clearTimers}
            onMouseLeave={closeSoon}
          >
            <div style={s.title}>
              <Icon.AlertOctagon size={12} />
              {title}
            </div>
            {findings.length === 0 ? (
              <div style={s.status}>{loading ? t("loading") : t("empty")}</div>
            ) : (
              findings.map((f) => (
                <div key={f.id} style={s.item}>
                  <span style={s.head}>
                    <SeverityBadge severity={f.severity} compact />
                    <span style={s.itemTitle}>{f.title}</span>
                    <CategoryTag category={f.category} />
                  </span>
                  <span style={s.meta}>
                    <span className="mono" style={s.location}>
                      {f.file}:{lineRange(f)}
                    </span>
                    <ConfidenceNum value={f.confidence} />
                  </span>
                  <span style={s.rationale}>{f.rationale}</span>
                </div>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
