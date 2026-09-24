"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@/components/ui-client";
import {
  DiffViewer,
  type DiffCommentApi,
  type DiffFindingApi,
} from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, useFindingAction } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/core";
import { notify } from "@/lib/toast";
import type { PrFile, SmartDiffRole } from "@/lib/types";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { DiffGroupHeader } from "./_components/DiffGroupHeader";
import { COLLAPSED_ROLES, type DiffOrder } from "./constants";
import { annotationToggle, filesWithFindings, orderedGroups } from "./helpers";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /**
   * Findings of every run, already loaded by the page for the Agent runs tab.
   * Passing them down is what lets the diff show findings with NO extra request
   * and no model call (spec 0010, AC 9).
   */
  findings?: FindingRecord[];
  repoFullName?: string | null;
  headSha?: string | null;
  /**
   * Lives in the URL (`?order=original`), like `?tab` and `?trace`, so the choice
   * survives a reload and can be linked — this tab is unmounted on every tab
   * switch, so React state could not hold it anyway.
   */
  order?: DiffOrder;
  onSetOrder?: (order: DiffOrder) => void;
}

/** Stable identity, so an omitted `findings` prop does not defeat the memos below. */
const NO_FINDINGS: FindingRecord[] = [];

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  findings = NO_FINDINGS,
  repoFullName,
  headSha,
  order = "smart",
  onSetOrder,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const { data: smart } = useSmartDiff(prId);
  const action = useFindingAction();

  const commentCount = comments?.length ?? 0;
  const findingCount = findings.length;

  /**
   * ONE flag for the shared control, not one per annotation kind: the button
   * both reads and writes it, so two booleans would be duplicate state that
   * disagree on first paint (the label would claim comments are shown while they
   * are hidden, and the first click would be a no-op).
   *
   * Default: a PR with findings opens with them visible, so the review a
   * reviewer just ran is on screen (spec 0010, AC 5); a PR without findings
   * keeps the old "diff is clean by default" behaviour. `null` means "not
   * chosen yet", so the default still applies once findings arrive from the
   * query — deriving state from props in a `useState` initialiser would freeze
   * it at whatever the first render saw.
   */
  const [shownOverride, setShownOverride] = React.useState<boolean | null>(null);
  const annotationsShown = shownOverride ?? findingCount > 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments: annotationsShown,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShownOverride(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : t("diff.postError"));
        throw err;
      }
    },
  };

  // The viewer is generic: it places findings, this callback decides what one
  // LOOKS like. Keyed by id so the viewer can pass its minimal shape back and
  // still get the full record here.
  const byId = React.useMemo(
    () => new Map(findings.map((f) => [f.id, f])),
    [findings],
  );
  // FindingRecord satisfies DiffFindingLike structurally — no cast, so a future
  // change to either shape is caught here rather than silenced.
  const findingApi: DiffFindingApi = {
    findings,
    showFindings: annotationsShown,
    render: (f) => {
      const full = byId.get(f.id);
      if (!full) return null;
      return (
        <FindingCard
          f={full}
          defaultExpanded
          pending={action.isPending}
          repoFullName={repoFullName}
          headSha={headSha}
          onAction={(act) =>
            action.mutate({ findingId: full.id, action: act, ...(prId ? { prId } : {}) })
          }
        />
      );
    },
  };

  const toggle = annotationToggle(commentCount, findingCount, annotationsShown);
  const { groups, leftovers } = React.useMemo(() => orderedGroups(files, smart), [files, smart]);
  // Falls back to GitHub's order whenever the route gave us nothing to group by,
  // so a smart-diff failure can never break the Files changed tab.
  const grouped = order === "smart" && groups.length > 0;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <span style={s.toolbar}>
            {commentCount + findingCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={annotationsShown ? "EyeOff" : "Eye"}
                onClick={() => setShownOverride(!annotationsShown)}
              >
                {/* The count is inside the message, not concatenated after it —
                    its position varies by language. */}
                {t(toggle.key, { count: toggle.count })}
              </Button>
            )}
            {groups.length > 0 && (
              <Button
                kind="ghost"
                size="sm"
                onClick={() => onSetOrder?.(order === "smart" ? "original" : "smart")}
              >
                {order === "smart" ? t("smartDiff.orderOriginal") : t("smartDiff.orderSmart")}
              </Button>
            )}
          </span>
        }
      >
        {t("diff.filesChanged", { count: filesCount })}
      </SectionLabel>

      {grouped ? (
        <>
          {groups.map((g) => (
            <DiffGroup
              key={g.role}
              role={g.role}
              files={g.files}
              findings={findings}
              commenting={commenting}
              findingApi={findingApi}
            />
          ))}
          {leftovers.length > 0 && (
            <DiffViewer files={leftovers} commenting={commenting} findings={findingApi} />
          )}
        </>
      ) : (
        <DiffViewer files={files} commenting={commenting} findings={findingApi} />
      )}
    </section>
  );
}

/** One role section: its header, and the files under it when expanded. */
function DiffGroup({
  role,
  files,
  findings,
  commenting,
  findingApi,
}: {
  role: SmartDiffRole;
  files: PrFile[];
  findings: FindingRecord[];
  commenting: DiffCommentApi;
  findingApi: DiffFindingApi;
}) {
  const collapsed = COLLAPSED_ROLES.includes(role);
  const [open, setOpen] = React.useState(!collapsed);
  return (
    <div>
      <DiffGroupHeader
        role={role}
        fileCount={files.length}
        findingFileCount={filesWithFindings(files, findings)}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />
      {open && (
        <DiffViewer
          files={files}
          commenting={commenting}
          findings={findingApi}
          {...(collapsed ? { defaultOpen: false } : {})}
        />
      )}
    </div>
  );
}
