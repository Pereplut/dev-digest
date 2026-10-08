/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion. Accept / Reject sit in the header so every card shows them, even
   collapsed; they reflect the persisted accepted_at / dismissed_at timestamps
   (Reject = the "dismiss" action). A third header control (spec 0019) turns an
   already-decided finding into an eval case; it is local state only — it does
   not go through `onAction`/`FindingActionKind`, which stays accept/dismiss/
   learn/reply. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@/components/ui-client";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "@/components/findings-summary";
import { useCreateEvalCase } from "@/lib/hooks/evals";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const te = useTranslations("evals");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [evalCreated, setEvalCreated] = React.useState(false);
  const [evalError, setEvalError] = React.useState<string | null>(null);
  const createEvalCase = useCreateEvalCase();
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  const evalOpen = !accepted && !dismissed;
  const evalDisabled = evalOpen || evalCreated || createEvalCase.isPending;
  // Only the open-finding case gets a hint: that is the one a user cannot
  // explain from the screen (AC-25 derives `expectation_kind` from the accept /
  // dismiss verdict, so an open finding has no expectation to store). The other
  // two disabled states already say why — the label flips to the confirmation,
  // or the mutation is in flight.
  const evalHint = evalOpen ? te("findingCard.hint") : undefined;
  const evalHintId = `eval-hint-${f.id}`;

  const turnIntoEvalCase = () => {
    setEvalError(null);
    createEvalCase.mutate(
      { finding_id: f.id },
      {
        onSuccess: () => setEvalCreated(true),
        onError: (err) => setEvalError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      {/* role="button" rather than a real <button>: this header contains the
          accept/reject <Button>s below, and nesting a button inside a button is
          invalid HTML. tabIndex + onKeyDown give it the keyboard path it had
          been missing entirely. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        onKeyDown={(ev) => {
          // Keys pressed on a nested control (a button or link inside this header)
          // bubble here too; leave them to that control.
          if (ev.target !== ev.currentTarget) return;
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault(); // Space would otherwise scroll the page
            setExpanded((x) => !x);
          }
        }}
        style={s.header}
      >
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        {/* Actions must not toggle the card when clicked. */}
        <div style={s.headerActions} onClick={(e) => e.stopPropagation()}>
          <Button
            kind="secondary"
            size="sm"
            icon="Check"
            disabled={pending}
            active={accepted}
            onClick={() => onAction?.("accept")}
          >
            {t("finding.accept")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            icon="X"
            disabled={pending}
            active={dismissed}
            onClick={() => onAction?.("dismiss")}
          >
            {t("finding.reject")}
          </Button>
          {/* `title` on the wrapper span is a redundant MOUSE-only affordance
              (a disabled <button> receives no pointer events, so a `title`
              on it never shows). The reason a disabled control is disabled
              must also reach keyboard/screen-reader users, who cannot hover
              a tooltip and cannot tab to a disabled button either — so the
              hint is rendered as real, visible text and wired onto the
              control via `aria-describedby`, which jsdom/axe compute as the
              button's accessible DESCRIPTION regardless of focus. */}
          <span title={evalHint} style={s.evalHintWrap}>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={evalDisabled}
              aria-describedby={evalHint ? evalHintId : undefined}
              onClick={turnIntoEvalCase}
            >
              {evalCreated ? te("findingCard.confirmation") : te("findingCard.control")}
            </Button>
          </span>
          {evalError && <span style={s.evalError}>{te("findingCard.error", { message: evalError })}</span>}
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {/* A SIBLING of the `role="button"` header, not a descendant of it —
          that header's accessible name is computed from its own descendants'
          text, so the hint lived here (rather than inside the header) would
          get concatenated onto the expand/collapse toggle's name.
          `aria-describedby` resolves by id from anywhere in the document, so
          the control above still points at this text regardless of where it
          sits in the tree. */}
      {evalHint && (
        <div style={s.evalHintRow}>
          <span id={evalHintId} style={s.evalHintText}>
            {evalHint}
          </span>
        </div>
      )}

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
