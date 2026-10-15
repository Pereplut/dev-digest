/* AgentPicker — the PR-page run control (spec 0021, AC-24..26).
   Checkbox list of the enabled agents; ONE POST with the checked ids. One id
   keeps today's single-run behaviour on this page, two or more open the
   results page. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Icon } from "@/components/ui-client";
import { useAgents } from "@/lib/hooks/agents";
import { useRunReview } from "@/lib/hooks/reviews";
import { formatDurationHint } from "@/lib/utils/multiAgentEstimate";
import { configureHref, toggleId } from "./helpers";
import { s } from "./styles";

export function AgentPicker({
  prId,
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired when a single-agent run is kicked off (stays on this page). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("multiAgentReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const run = useRunReview();
  const [open, setOpen] = React.useState(false);
  const [checked, setChecked] = React.useState<string[]>([]);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const enabled = (agents ?? []).filter((a) => a.enabled);
  // Derived, so an agent disabled or removed on refetch drops out of the count and the POST.
  const selected = checked.filter((id) => enabled.some((a) => a.id === id));

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const kick = async () => {
    const agentIds = selected;
    if (agentIds.length === 0) return;
    if (agentIds.length === 1) onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, agentIds });
      setOpen(false);
      if (res.multi_run_id) router.push(`/multi-agent-review/${res.multi_run_id}`);
      else onRunsStarted?.(res.runs.map((r) => r.run_id));
    } catch {
      // Handled: the panel stays open and `run.isError` renders the alert below.
    } finally {
      onRunSettled?.();
    }
  };

  return (
    <div ref={rootRef} style={s.root}>
      <span
        title={warnMerged ? t("picker.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind="primary"
          size="sm"
          icon="Sparkles"
          iconRight="ChevronDown"
          loading={run.isPending}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {run.isPending ? t("picker.running") : t("picker.trigger")}
        </Button>
      </span>
      {open && (
        <div style={s.panel} role="group" aria-label={t("picker.title")}>
          {warnMerged && <div style={s.warn}>{t("picker.mergedWarning")}</div>}
          <div style={s.head}>
            <span style={s.title}>{t("picker.title")}</span>
            <button type="button" style={s.textBtn} onClick={() => setChecked(enabled.map((a) => a.id))}>
              {t("picker.selectAll")}
            </button>
            <button type="button" style={s.textBtn} onClick={() => setChecked([])}>
              {t("picker.clear")}
            </button>
          </div>
          {enabled.length === 0 ? (
            <div style={s.muted}>{t("picker.noAgents")}</div>
          ) : (
            <div style={s.list}>
              {enabled.map((a) => (
                <div key={a.id} style={s.row}>
                  <div style={s.rowLabel}>
                    <Checkbox
                      checked={checked.includes(a.id)}
                      onChange={() => setChecked((ids) => toggleId(ids, a.id))}
                      label={a.name}
                    />
                  </div>
                  <span style={s.hint}>{formatDurationHint(a) ?? t("picker.noHistory")}</span>
                </div>
              ))}
            </div>
          )}
          <Button
            kind="primary"
            size="md"
            icon="Users"
            full
            disabled={selected.length === 0 || run.isPending}
            onClick={kick}
          >
            {t("picker.run", { count: selected.length })}
          </Button>
          {run.isError && (
            <div style={s.muted} role="alert">
              {t("picker.runFailed")}
            </div>
          )}
          <Link href={configureHref(prId)} style={s.configure}>
            <Icon.Settings size={13} />
            {t("picker.configure")}
          </Link>
        </div>
      )}
    </div>
  );
}
