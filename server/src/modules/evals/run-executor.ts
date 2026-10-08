import type { Container } from '../../platform/container.js';
import type { Provider } from '@devdigest/shared';
import { reviewPullRequest, scoreEvalCase } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { RunLogger } from '../../platform/run-logger.js';
import type { AgentRow, EvalCaseRow } from '../../db/rows.js';
import { skillsLogLine, toLoadedSkills } from '../skills/helpers.js';
import { EVAL_TASK_LINE } from './constants.js';
import { rollupBatch, type EvalCaseResult } from './helpers.js';
import { EvalBatchRepository } from './repository/eval-batch.repo.js';

/**
 * The background sweep for one eval batch (spec 0019). Modelled on
 * `ReviewRunExecutor.runOneAgent` (`reviews/run-executor.ts:162-317`) minus
 * `loadDiff` and `agent_runs` persistence — an eval case already carries its
 * own stored diff and there is no PR row to persist against.
 *
 * AC-37: this file imports neither `reviews/run-executor.ts` nor
 * `reviews/diff-loader.ts` (pinned by `evals-imports.test.ts`); it calls
 * `reviewPullRequest` directly. AC-47: no prompt assembly happens here — the
 * only prompt input this file supplies is the fixed `EVAL_TASK_LINE` (no
 * interpolation) and the resolved skill blocks, exactly as the review
 * executor does; the diff itself reaches the model only through
 * `reviewPullRequest`'s own assembler.
 */

/** Minimal structured logger (pino-compatible), matching `reviews/run-executor.ts`'s `Logger`. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

export interface EvalRunJob {
  batchId: string;
  workspaceId: string;
  /** Snapshotted at queue time — editing the agent mid-batch must not change
   *  what this sweep reports (AC-38's "agent edited mid-batch" test). */
  agent: AgentRow;
  /** Snapshotted at queue time — exactly the set `cases_total` was computed from. */
  cases: EvalCaseRow[];
}

export class EvalRunExecutor {
  constructor(
    private container: Container,
    private batchRepo: EvalBatchRepository,
  ) {}

  async run(job: EvalRunJob, logger?: Logger): Promise<void> {
    const { batchId, workspaceId, agent, cases } = job;

    // Single-target RunLogger (not the fan-out form) keyed by the batch id, so
    // GET /runs/:id/events called with the batch id streams it unchanged (AC-36).
    const runLog = new RunLogger(this.container.runBus, [batchId], logger, {
      batchId,
      agentId: agent.id,
    });

    const abortController = new AbortController();
    const unregisterAbort = this.container.runBus.registerAbort(batchId, abortController);

    try {
      runLog.info(
        `Running ${cases.length} eval case(s) for agent "${agent.name}" (${agent.provider}/${agent.model})`,
      );
      await this.batchRepo.markRunning(batchId);

      let llm;
      try {
        llm = await runLog.step(
          `Resolving ${agent.provider} provider`,
          () => this.container.llm(agent.provider as Provider),
          { kind: 'tool' },
        );
      } catch (err) {
        // AC-40: zero child rows, zero model calls — fail the whole batch here,
        // before the case loop ever starts.
        const msg = (err as Error).message;
        runLog.error(`Run failed: ${msg}`);
        await this.batchRepo.failImmediately(batchId, msg);
        return;
      }

      // AC-43: the same pure mapper + the agent's own enabled linked skills,
      // reusing the lifted half of `loadSkills` (skills/helpers.ts).
      const skillRows = await this.container.skillsRepo.enabledForAgent(workspaceId, agent.id);
      const skills = toLoadedSkills(skillRows, (t) => this.container.tokenizer.count(t));
      runLog.info(skillsLogLine(skills));

      const results: EvalCaseResult[] = [];
      const startedAt = Date.now();
      let cancelled = false;

      // Best-effort persistence of a failed case row: a case can be deleted out
      // from under a live sweep (`DELETE /eval-cases/:id` has no live-batch
      // guard), which turns `insertCaseRun`'s FK into eval_cases into a
      // 23503 violation. Losing that one row must not strand the rest of the
      // batch — the sweep still owes every other case a verdict, and the
      // outer `catch` below is the last resort, not the normal path for this.
      const recordCaseFailure = async (
        n: number,
        case_: EvalCaseRow,
        reason: string,
        durationMs: number,
      ): Promise<void> => {
        try {
          await this.batchRepo.insertCaseRun({
            caseId: case_.id,
            batchId,
            actualOutput: { error: reason },
            pass: false,
            recall: null,
            precision: null,
            citationAccuracy: null,
            durationMs,
            costUsd: null,
          });
        } catch (insertErr) {
          runLog.error(
            `Case ${n}/${cases.length} ${case_.name}: failed to record case failure: ` +
              `${(insertErr as Error).message}`,
          );
        }
      };

      // AC-45: sequential — at most one case in flight, so at most one
      // concurrent model call.
      for (const [index, case_] of cases.entries()) {
        // AC-43/AC-71: checked BEFORE starting each case, so a signalled
        // cancellation starts no further one.
        if (this.container.runBus.isCancelled(batchId)) {
          cancelled = true;
          break;
        }
        const n = index + 1;
        const caseStart = Date.now();

        // AC-42: a stored diff that parses to zero files is a CASE failure,
        // not a batch failure — no model call is made for it.
        const diff = parseUnifiedDiff(case_.inputDiff ?? '');
        if (diff.files.length === 0) {
          const reason = 'stored diff has no changed files';
          runLog.result(`Case ${n}/${cases.length} ${case_.name}: FAIL — ${reason}`, {
            evalCase: { index: n, total: cases.length, pass: false },
          });
          await recordCaseFailure(n, case_, reason, Date.now() - caseStart);
          results.push({
            pass: false,
            recallMatched: null,
            recallTotal: null,
            precisionAvoided: null,
            precisionAvoidedTotal: null,
            citationKept: null,
            citationDropped: null,
            costUsd: null,
          });
          continue;
        }

        try {
          // AC-37/AC-46/AC-58: the engine entry point directly; scoring runs
          // against its GROUNDED findings, never raw model output.
          const outcome = await reviewPullRequest({
            systemPrompt: agent.systemPrompt,
            model: agent.model,
            diff,
            llm,
            strategy: agent.strategy,
            ...(skills.length > 0 ? { skills: skills.map((s) => s.block) } : {}),
            task: EVAL_TASK_LINE,
            sessionId: `eval:${batchId}:${case_.id}`,
            onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
            signal: abortController.signal,
          });

          const score = scoreEvalCase({
            expectationKind: case_.expectationKind as 'must_find' | 'must_not_flag',
            expectations: [
              {
                file: case_.expectedFile,
                startLine: case_.expectedStartLine,
                endLine: case_.expectedEndLine,
              },
            ],
            findings: outcome.review.findings,
            kept: outcome.review.findings.length,
            dropped: outcome.dropped.length,
          });

          runLog.result(
            `Case ${n}/${cases.length} ${case_.name}: ${score.pass ? 'PASS' : 'FAIL'} — ` +
              `recall ${score.recall.toFixed(2)} precision ${score.precision.toFixed(2)} ` +
              `citation ${score.citationAccuracy.toFixed(2)}`,
            { evalCase: { index: n, total: cases.length, pass: score.pass } },
          );

          await this.batchRepo.insertCaseRun({
            caseId: case_.id,
            batchId,
            actualOutput: { findings: outcome.review.findings },
            pass: score.pass,
            recall: score.recall,
            precision: score.precision,
            citationAccuracy: score.citationAccuracy,
            durationMs: Date.now() - caseStart,
            costUsd: outcome.costUsd,
          });
          results.push({
            pass: score.pass,
            recallMatched: score.recallMatched,
            recallTotal: score.recallTotal,
            // Batch `precision` pools must_not_flag expectation counts, not
            // finding counts (spec 0019 AC-13 amendment) — see
            // `EvalCaseResult`'s doc comment. `score.precision` itself (the
            // finding-denominated per-case ratio) is unaffected and is what
            // `insertCaseRun` above persists on the `eval_runs` row.
            precisionAvoided: score.mustNotFlagAvoided,
            precisionAvoidedTotal: score.mustNotFlagTotal,
            citationKept: score.citationKept,
            citationDropped: score.citationDropped,
            costUsd: outcome.costUsd,
          });
        } catch (err) {
          // A cancel mid-call aborts the HTTP request on a provider that
          // honours `signal`; this run never promised more than that (C11).
          // Treat it as cancellation, not a case failure: write no row for an
          // interrupted case, matching AC-71 ("keeps the rows already written
          // intact" — it does not require one for the case cut off mid-flight).
          if (abortController.signal.aborted) {
            cancelled = true;
            break;
          }
          const msg = (err as Error).message;
          runLog.error(`Case ${n}/${cases.length} ${case_.name} failed: ${msg}`, {
            evalCase: { index: n, total: cases.length, pass: false },
          });
          await recordCaseFailure(n, case_, msg, Date.now() - caseStart);
          results.push({
            pass: false,
            recallMatched: null,
            recallTotal: null,
            precisionAvoided: null,
            precisionAvoidedTotal: null,
            citationKept: null,
            citationDropped: null,
            costUsd: null,
          });
        }
      }

      const rollup = rollupBatch(results, startedAt, Date.now());
      const status = cancelled ? 'cancelled' : 'done';
      // AC-44: the ONE terminal write.
      await this.batchRepo.completeTerminal(batchId, {
        status,
        error: cancelled ? 'Cancelled by user' : null,
        recall: rollup.recall,
        precision: rollup.precision,
        citationAccuracy: rollup.citationAccuracy,
        casesPassed: rollup.casesPassed,
        durationMs: rollup.durationMs,
        costUsd: rollup.costUsd,
      });
      runLog.result(cancelled ? 'Run cancelled by user' : 'Run complete');
    } catch (err) {
      // Catch-all: anything that escapes the sweep above (markRunning,
      // skillsRepo.enabledForAgent, tokenizer.count, rollupBatch,
      // completeTerminal, or an insertCaseRun the per-case handling above
      // didn't already absorb) must still leave the batch in a terminal
      // status (AC-44) — the alternative is `running` forever, which AC-34's
      // guard (and `eval_run_batches_owner_live_uq`) then turns into a
      // permanent block on every future run of this agent, recoverable only
      // by an API restart's boot reap (`failOrphaned`).
      const msg = (err as Error).message;
      runLog.error(`Run failed: ${msg}`);
      await this.batchRepo.failImmediately(batchId, msg).catch((failErr) => {
        runLog.error(
          `Run failed, and failed to persist the failure: ${(failErr as Error).message}`,
        );
      });
    } finally {
      // Ends the SSE generator for GET /runs/:id/events (AC-36).
      this.container.runBus.complete(batchId);
      unregisterAbort();
    }
  }
}
