/* BlastRadiusCard — which callers and HTTP endpoints/cron jobs a PR's changed
   symbols reach, read from the finished repo-intel index (spec 0012). No LLM
   call on this path: the payload is a finished index read, rendered as-is.

   Four explicit states: loading (isLoading, never isFetching), populated (a
   collapsible tree, one row per changed symbol), no callers (EmptyState, not
   a blank box) and degraded (a role="status" marker naming the reason, shown
   above whatever data did come back). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, EmptyState, Icon, MonoLink, SectionLabel, Skeleton } from "@/components/ui-client";
import { usePrBlast } from "@/lib/hooks/core";
import { githubBlobUrl } from "@/lib/github-urls";
import {
  CALLER_DISPLAY_CAP,
  degradedReasonKey,
  findDownstream,
  totalCallers,
  uniqueSorted,
} from "./helpers";
import { s } from "./styles";

interface BlastRadiusCardProps {
  prId: string | null;
  repoFullName: string | null | undefined;
  headSha: string | null | undefined;
}

export function BlastRadiusCard({ prId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("prReview");
  const { data: blast, isLoading } = usePrBlast(prId);
  const [openSymbols, setOpenSymbols] = React.useState<ReadonlySet<string>>(new Set());

  const toggleSymbol = (name: string) => {
    setOpenSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (isLoading) {
    return (
      <section style={s.box} aria-labelledby="blast-radius-heading">
        <SectionLabel icon="GitBranch">
          <span id="blast-radius-heading">{t("blast.title")}</span>
        </SectionLabel>
        {/* role="status", not a bare div with aria-label alone: ARIA prohibits
            aria-label on the implicit `generic` role, so assistive technology
            would drop the name even though jsdom still reports it
            (client/INSIGHTS.md, 2026-09-27). `status` also carries an implicit
            aria-live="polite". */}
        <div role="status" aria-busy="true" aria-label={t("blast.loading")} style={s.loadingRow}>
          <Skeleton height={14} style={{ marginBottom: 8 }} />
          <Skeleton height={14} style={{ marginBottom: 8 }} />
          <Skeleton height={14} width="70%" />
        </div>
      </section>
    );
  }

  // The card is an enrichment, not the page: on error or before a pr id
  // resolves, render nothing rather than an error surface of its own.
  if (!blast) return null;

  const { changed_symbols, downstream } = blast;
  const noCallers = downstream.length === 0;
  const callerCount = totalCallers(downstream);
  const endpoints = uniqueSorted(downstream.map((group) => group.endpoints_affected));
  const crons = uniqueSorted(downstream.map((group) => group.crons_affected));

  return (
    <section style={s.box} aria-labelledby="blast-radius-heading">
      <SectionLabel icon="GitBranch">
        <span id="blast-radius-heading">{t("blast.title")}</span>
      </SectionLabel>
      <p style={s.subtitle}>{t("blast.subtitle")}</p>

      {blast.degraded &&
        (() => {
          const reasonText = t(`blast.degraded.reason.${degradedReasonKey(blast.reason)}`);
          const label = t("blast.degraded.label");
          return (
            // role="status" with an explicit aria-label: the accessible name of
            // "status" comes from the author, never from content, so a screen
            // reader hears nothing unless it is set here (client/INSIGHTS.md,
            // 2026-09-27, and the ARIA name-from-content table for this role).
            <div role="status" aria-label={`${label} — ${reasonText}`} style={s.degraded}>
              <Chip color="var(--warning)" icon="AlertTriangle">
                {label}
              </Chip>
              <span style={s.degradedReason}>{reasonText}</span>
            </div>
          );
        })()}

      {noCallers ? (
        <EmptyState icon="GitBranch" title={t("blast.emptyTitle")} body={t("blast.emptyBody")} />
      ) : (
        <>
          <div style={s.chips}>
            <Chip>{t("blast.chip.symbols", { count: changed_symbols.length })}</Chip>
            <Chip>{t("blast.chip.callers", { count: callerCount })}</Chip>
            <Chip>{t("blast.chip.endpoints", { count: endpoints.length })}</Chip>
            <Chip>{t("blast.chip.crons", { count: crons.length })}</Chip>
          </div>

          <div style={s.tree}>
            {changed_symbols.map((sym) => {
              const group = findDownstream(downstream, sym.name);
              const key = `${sym.file}:${sym.name}`;

              if (!group || group.callers.length === 0) {
                return (
                  <div key={key} style={s.symbolRowStatic}>
                    <span style={s.symbolName}>{sym.name}</span>
                    <span style={s.noCallers}>{t("blast.noCallersForSymbol")}</span>
                  </div>
                );
              }

              const open = openSymbols.has(sym.name);
              return (
                <div key={key} style={s.symbolGroup}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={t(open ? "blast.collapseSymbol" : "blast.expandSymbol", {
                      symbol: sym.name,
                    })}
                    onClick={() => toggleSymbol(sym.name)}
                    style={s.symbolHeader}
                  >
                    <Icon.ChevronRight size={13} style={s.chevron(open)} />
                    <span style={s.symbolName}>{sym.name}</span>
                    <span style={s.callerBadge} className="tnum">
                      {group.callers.length}
                    </span>
                  </button>

                  {open && (
                    <div style={s.symbolBody}>
                      <p style={s.listLabel}>{t("blast.callersLabel")}</p>
                      <ul style={s.callerList}>
                        {group.callers.map((caller) => {
                          const href =
                            repoFullName && headSha
                              ? githubBlobUrl(repoFullName, headSha, caller.file, caller.line)
                              : null;
                          const label = `${caller.file}:${caller.line}`;
                          return (
                            <li
                              key={`${caller.file}:${caller.line}:${caller.name}`}
                              style={s.callerRow}
                              title={t("blast.openOnGitHub", {
                                file: caller.file,
                                line: caller.line,
                              })}
                            >
                              {href ? (
                                <MonoLink href={href}>{label}</MonoLink>
                              ) : (
                                <span className="mono">{label}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {/* `capped` is server-truth (spec 0012): the client cannot tell a
                          symbol with exactly the cap's worth of real callers from one
                          that was actually truncated, so this note renders only when
                          the server says truncation happened — never from a client-side
                          `callers.length` comparison against the display cap. */}
                      {group.capped && (
                        <p style={s.capped}>
                          {t("blast.cappedCallers", { count: CALLER_DISPLAY_CAP })}
                        </p>
                      )}
                      {group.endpoints_affected.length > 0 && (
                        <>
                          <p style={s.listLabel}>{t("blast.endpointsLabel")}</p>
                          <div style={s.chips}>
                            {group.endpoints_affected.map((endpoint) => (
                              <Chip key={endpoint}>{endpoint}</Chip>
                            ))}
                          </div>
                        </>
                      )}
                      {group.crons_affected.length > 0 && (
                        <>
                          <p style={s.listLabel}>{t("blast.cronsLabel")}</p>
                          <div style={s.chips}>
                            {group.crons_affected.map((cron) => (
                              <Chip key={cron}>{cron}</Chip>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
