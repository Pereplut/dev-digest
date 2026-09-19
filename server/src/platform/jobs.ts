import PQueue from 'p-queue';
import type { JobsRepository } from './jobs.repo.js';
import { withTimeout, withRetry } from './resilience.js';
import { redactCredentials } from './redact.js';

/**
 * JobRunner — async work (clone, PR import, indexing, polling) on a
 * concurrency-limited p-queue, mirrored into the `jobs` table with
 * timeouts + retry/backoff.
 *
 * Handlers are registered by kind. enqueue() inserts a `jobs` row, schedules
 * the handler on the queue, and updates status/attempts/error as it runs. All
 * table access goes through JobsRepository (jobs.repo.ts).
 */

export type JobHandler = (payload: unknown, ctx: { jobId: string }) => Promise<void>;

export interface JobRunnerOptions {
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
}

export interface EnqueuedJob {
  id: string;
  /** Resolves when the job finishes (or rejects if it ultimately fails). */
  done: Promise<void>;
}

export class JobRunner {
  private queue: PQueue;
  private handlers = new Map<string, JobHandler>();
  private timeoutMs: number;
  private retries: number;

  constructor(
    private repo: JobsRepository,
    opts: JobRunnerOptions = {},
  ) {
    this.queue = new PQueue({ concurrency: opts.concurrency ?? 3 });
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.retries = opts.retries ?? 2;
  }

  register(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async enqueue(workspaceId: string, kind: string, payload: unknown): Promise<EnqueuedJob> {
    const handler = this.handlers.get(kind);
    if (!handler) throw new Error(`No job handler registered for kind '${kind}'`);

    const jobId = await this.repo.insertQueued(workspaceId, kind, payload);

    const done = this.queue.add(async () => {
      await this.repo.markRunning(jobId);
      try {
        await withRetry(
          () =>
            withTimeout(handler(payload, { jobId }), this.timeoutMs).then(() =>
              this.repo.setAttempts(jobId, 1),
            ),
          {
            retries: this.retries,
            // withRetry does not await onRetry, so a failed bookkeeping write
            // would be an unhandled rejection; it is not worth failing the job.
            onRetry: (attempt) => {
              void this.repo.setAttempts(jobId, attempt).catch(() => undefined);
            },
          },
        );
        await this.repo.markDone(jobId);
      } catch (err) {
        // A handler can throw a non-Error (a string, a rejected plain value);
        // `(err as Error).message` would then be undefined and redactCredentials
        // would throw, leaving the row stuck at 'running'.
        const message = err instanceof Error ? err.message : String(err);
        // A clone URL can carry a PAT; git echoes it in its failure stderr and
        // simple-git copies that into the Error message. Never persist it in
        // cleartext — see platform/redact.ts.
        await this.repo.markFailed(jobId, redactCredentials(message));
        throw err;
      }
    }) as Promise<void>;

    // No caller consumes `done` today, and p-queue rejects it when a handler
    // ultimately fails — which under Node's default unhandled-rejection policy
    // terminates the API on a routine failure like an unreachable repo URL.
    // Attach a sink so the rejection is handled; the failure is already
    // recorded on the `jobs` row above. Callers that DO await `done` still get
    // the rejection, since a promise may carry more than one handler.
    void done.catch(() => undefined);

    return { id: jobId, done };
  }

  /**
   * On boot: mark jobs left `queued` or `running` by a previous process as
   * failed. The queue is IN-MEMORY, so nothing will ever pick those rows up
   * again — they are abandoned, not pending.
   *
   * This deliberately does NOT recover the work. Doing that needs a durable
   * claim (`SELECT … FOR UPDATE SKIP LOCKED`) plus handler registration at
   * boot, which is a feature rather than a fix. What it does is stop the table
   * lying: nothing in the codebase ever SELECTs `jobs`, so an abandoned row sat
   * at 'queued' forever and `jobs_status_idx` indexed a status no one read.
   *
   * `failed` is the only terminal state the status enum offers; adding an
   * 'abandoned' value would be a migration for a column with no readers.
   */
  async reapOrphanedJobs(): Promise<number> {
    return this.repo.failUnfinished(
      'Abandoned: the process running this job exited before it finished.',
    );
  }

  /** Wait for the queue to drain (useful in tests). */
  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }
}
