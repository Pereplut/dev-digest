/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@/components/ui-client";
import { RunCostBadge } from "@/components/run-cost-badge";
import {
  FindingsPopover,
  SeverityCounts,
  runFindings,
  totalFindings,
  useSeverityCountsLabel,
} from "@/components/findings-summary";
import { usePrReviews } from "@/lib/hooks/reviews";
import type { PrMeta } from "@/lib/types";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  const detailHref = `/repos/${repoId}/pulls/${pr.number}`;

  // FINDINGS: counts of the latest run with a review come with the list; the
  // popover's read-only previews are fetched on first open (shared
  // ["reviews", prId] cache with the PR page) and narrowed to that same run.
  const [findingsOpen, setFindingsOpen] = React.useState(false);
  const countsLabel = useSeverityCountsLabel(pr.findings_counts);
  const { data: reviews } = usePrReviews(findingsOpen ? pr.id : null);
  const runId = pr.findings_run_id;
  const popoverFindings = React.useMemo(() => runFindings(reviews ?? [], runId), [reviews, runId]);
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(detailHref)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          {/* The row keeps its onClick for click-anywhere, but the title is a
              real link: that makes the row reachable by keyboard, openable in a
              new tab and middle-clickable — none of which a div onClick gives.
              stopPropagation keeps the row's router.push from firing too: that
              would navigate twice on a click and pull the current tab away on
              a Ctrl/Cmd-click. The style resets only color/decoration, so the
              browser's focus ring stays visible. */}
          <Link href={detailHref} onClick={(e) => e.stopPropagation()} style={s.rowTitleLink}>
            <div style={s.rowTitle(h)}>{pr.title}</div>
          </Link>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div>
        {totalFindings(pr.findings_counts) > 0 ? (
          <FindingsPopover
            label={countsLabel}
            title={t("findingsSummary.inRunTitle", {
              count: reviews ? popoverFindings.length : totalFindings(pr.findings_counts),
            })}
            findings={popoverFindings}
            loading={!reviews}
            onOpenChange={setFindingsOpen}
          >
            <SeverityCounts counts={pr.findings_counts} />
          </FindingsPopover>
        ) : (
          <SeverityCounts counts={pr.findings_counts} />
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div>
        <RunCostBadge
          costUsd={pr.cost_usd}
          partial={pr.cost_complete === false}
          partialTitle={t("list.costPartial")}
        />
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
