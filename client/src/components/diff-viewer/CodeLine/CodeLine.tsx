/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, review findings, and an
   inline composer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "@/components/findings-summary";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { worstSeverity, type DiffFindingApi, type DiffFindingLike } from "../findings";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor, findingLineLabelFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  lineFindings,
  findings,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Findings anchored to THIS line (already partitioned by FileCard). */
  lineFindings?: DiffFindingLike[];
  findings?: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;

  // The stripe and the label mark the line even when the cards are hidden — a
  // marker that vanished with the toggle would look like the findings were lost.
  const onLine = lineFindings ?? [];
  const worst = worstSeverity(onLine);
  const sevColor = worst ? (SEV_COLOR[worst] ?? SEV_COLOR_FALLBACK) : null;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* `data-severity` is the row's semantic handle for the stripe: the stripe
          itself is a CSS border with no accessible role, and keying a test on the
          style string would make "no stripe" indistinguishable from "the selector
          stopped matching" the day this becomes a class or a shorthand. */}
      <div
        data-testid="code-row"
        data-severity={worst ?? undefined}
        style={lineRowFor(ln.kind, sevColor)}
      >
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {worst && sevColor && (
          <span style={findingLineLabelFor(sevColor)}>
            {/* blocker / warning / suggestion — deliberately not SEV[].label,
                which reads "Critical". */}
            {t(`diffViewer.findingLabel.${worst}`)}
          </span>
        )}
      </div>

      {findings &&
        findings.showFindings &&
        onLine.length > 0 &&
        onLine.map((f) => (
          <div key={f.id} style={cs.thread}>
            {findings.render(f)}
          </div>
        ))}

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
