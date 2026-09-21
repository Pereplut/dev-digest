/* TraceBody — the Trace tab content: Configuration, Stats, Findings, Prompt
   assembly, Tool calls, and Raw output sections for one persisted RunTrace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui-client";
import type { RunTrace, FindingRecord, RunSummary } from "@devdigest/shared";
import { formatUsd } from "@/components/run-cost-badge";
import { PROMPT_COLORS } from "../../constants";
import { formatSeconds, formatTokens, slotTokens } from "../../helpers";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { ToolCallRow } from "../ToolCallRow";
import { PromptBlock } from "../PromptBlock";
import { SkillsPromptBlocks } from "../SkillsPromptBlocks";
import { FindingsSection } from "../FindingsSection";
import { Row, Stat } from "../atoms";

export function TraceBody({
  trace,
  findings,
  run = null,
}: {
  trace: RunTrace;
  findings: FindingRecord[];
  run?: RunSummary | null;
}) {
  const t = useTranslations("runs");
  const stats = trace.stats;
  const pa = trace.prompt_assembly;
  // Cost: the run row is the source of truth (old traces lack stats.cost_usd);
  // an unfinished run never shows a price.
  const costUsd = run && run.status !== "done" ? null : (run?.cost_usd ?? stats.cost_usd ?? null);
  return (
    <>
      <TraceSection icon="Settings" title={t("trace.configuration")}>
        <div style={s.configList}>
          <Row label={t("trace.config.model")}>
            <span className="mono" style={s.configModel}>
              {trace.config.model}
            </span>
          </Row>
          <Row label={t("trace.config.provider")}>
            <span className="mono" style={s.configProvider}>
              {trace.config.provider ?? "—"}
            </span>
          </Row>
          <Row label={t("trace.config.memoryPulled")}>
            <span>{t("trace.config.items", { count: trace.memory_pulled.length })}</span>
          </Row>
          <Row label={t("trace.config.specsRead")}>
            <div style={s.specsWrap}>
              {trace.specs_read.length === 0 ? (
                <span style={s.specsNone}>{t("trace.config.none")}</span>
              ) : (
                trace.specs_read.map((sp, i) => (
                  <span key={i} className="mono" style={s.spec}>
                    {sp}
                  </span>
                ))
              )}
            </div>
          </Row>
        </div>
      </TraceSection>

      <TraceSection
        icon="Gauge"
        title={t("trace.stats")}
        right={
          <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
            {stats.grounding}
          </Badge>
        }
      >
        <div style={s.statsRow}>
          <Stat label={t("trace.stat.duration")} val={formatSeconds(stats.duration_ms)} />
          <Stat label={t("trace.stat.tokens")} val={formatTokens(stats.tokens_in, stats.tokens_out)} />
          <Stat label={t("trace.stat.cost")} val={formatUsd(costUsd)} />
          <Stat label={t("trace.stat.findings")} val={stats.findings} />
        </div>
      </TraceSection>

      <FindingsSection findings={findings} />

      <TraceSection icon="FileText" title={t("trace.promptAssembly")} defaultOpen={false}>
        {/* prompt_tokens / skills_used are absent on traces before spec 0006 —
            slotTokens returns null and the skills block renders whole. */}
        <PromptBlock
          label={t("trace.prompt.system")}
          text={pa.system}
          color={PROMPT_COLORS.system}
          tokens={slotTokens(trace, "system")}
        />
        {pa.skills != null && (
          <SkillsPromptBlocks text={pa.skills} used={trace.skills_used} tokens={slotTokens(trace, "skills")} />
        )}
        {pa.memory != null && (
          <PromptBlock
            label={t("trace.prompt.memory")}
            text={pa.memory}
            color={PROMPT_COLORS.memory}
            tokens={slotTokens(trace, "memory")}
          />
        )}
        {pa.repo_map != null && (
          <PromptBlock
            label={t("trace.prompt.repoMap")}
            text={pa.repo_map}
            color={PROMPT_COLORS.repoMap}
            tokens={slotTokens(trace, "repo_map")}
          />
        )}
        {pa.specs != null && (
          <PromptBlock
            label={t("trace.prompt.specs")}
            text={pa.specs}
            color={PROMPT_COLORS.specs}
            tokens={slotTokens(trace, "specs")}
          />
        )}
        {pa.callers != null && (
          <PromptBlock
            label={t("trace.prompt.callers")}
            text={pa.callers}
            color={PROMPT_COLORS.callers}
            tokens={slotTokens(trace, "callers")}
          />
        )}
        <PromptBlock
          label={t("trace.prompt.user")}
          text={pa.user}
          color={PROMPT_COLORS.user}
          tokens={slotTokens(trace, "user")}
        />
      </TraceSection>

      <TraceSection
        icon="Wrench"
        title={t("trace.toolCalls")}
        right={<Badge color="var(--text-muted)">{trace.tool_calls.length}</Badge>}
      >
        {trace.tool_calls.length === 0 ? (
          <span style={s.noToolCalls}>{t("trace.noToolCalls")}</span>
        ) : (
          trace.tool_calls.map((tc, i) => <ToolCallRow key={i} tc={tc} />)
        )}
      </TraceSection>

      <TraceSection icon="Code" title={t("trace.rawOutput")} defaultOpen={false}>
        <pre className="mono" style={s.rawPre}>
          {trace.raw_output || "—"}
        </pre>
      </TraceSection>
    </>
  );
}
