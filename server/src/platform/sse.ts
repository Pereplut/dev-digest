import { EventEmitter } from 'node:events';
import type { RunEvent, RunEventKind } from '@devdigest/shared';

/**
 * SSE / run-log bus.
 *
 * During a run, events are pushed to an in-memory buffer and emitted live to
 * any SSE subscriber on `/runs/:id/events`. On completion the full log is
 * persisted as ONE document in `run_traces` (done by the service layer, not here).
 *
 * Event shape on the wire (SSE `data`): RunEvent (see @devdigest/shared).
 */

/** Wall-clock time-of-day (HH:MM:SS, local) stamped on each log line. */
function clockTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

/** How long a finished run's log stays replayable before it is evicted. */
export const DEFAULT_BUFFER_TTL_MS = 10 * 60_000;

export class RunBus {
  private emitters = new Map<string, EventEmitter>();
  private buffers = new Map<string, RunEvent[]>();
  private seq = new Map<string, number>();
  private completed = new Set<string>();
  private cancelled = new Set<string>();
  private evictions = new Map<string, NodeJS.Timeout>();

  /**
   * @param bufferTtlMs how long after `complete()` a run's buffered log stays
   * available for a late SSE subscriber. Injectable so tests can drive it.
   */
  constructor(private readonly bufferTtlMs: number = DEFAULT_BUFFER_TTL_MS) {}

  /** Request cancellation of an in-flight run. The runner checks `isCancelled`
   *  at its next checkpoint (between map-reduce files) and stops. */
  cancel(runId: string): void {
    this.cancelled.add(runId);
  }

  /** Whether cancellation has been requested for a run. */
  isCancelled(runId: string): boolean {
    return this.cancelled.has(runId);
  }

  private emitterFor(runId: string): EventEmitter {
    // Renewed interest in a run (publish / subscribe / onDone) cancels a
    // pending eviction — the log is clearly still wanted.
    this.cancelEviction(runId);
    let e = this.emitters.get(runId);
    if (!e) {
      e = new EventEmitter();
      e.setMaxListeners(50);
      this.emitters.set(runId, e);
      // Preserve any existing buffer/seq (e.g. a late subscriber after the run
      // completed must still be able to replay the buffered events).
      if (!this.buffers.has(runId)) this.buffers.set(runId, []);
      if (!this.seq.has(runId)) this.seq.set(runId, 0);
    }
    return e;
  }

  /** Publish a live event for a run. Returns the constructed RunEvent. */
  publish(runId: string, kind: RunEventKind, msg: string, data?: unknown): RunEvent {
    const e = this.emitterFor(runId);
    const next = (this.seq.get(runId) ?? 0) + 1;
    this.seq.set(runId, next);
    const event: RunEvent = { runId, seq: next, kind, msg, t: clockTime(), data };
    this.buffers.get(runId)!.push(event);
    e.emit('event', event);
    return event;
  }

  /** Subscribe to live events. Replays any buffered events first. */
  subscribe(runId: string, listener: (e: RunEvent) => void): () => void {
    const e = this.emitterFor(runId);
    for (const buffered of this.buffers.get(runId) ?? []) listener(buffered);
    e.on('event', listener);
    return () => e.off('event', listener);
  }

  /** The full buffered log for a run (used to persist the trace on completion). */
  buffer(runId: string): RunEvent[] {
    // Reading the log means someone still needs it. This matters on the cancel
    // path: cancelRun() completes the bus (scheduling eviction) while the
    // executor is still unwinding towards traceFromBuffer() -> saveRunTrace().
    // Without this, a short TTL could evict in that window and persist a trace
    // with an empty log.
    this.cancelEviction(runId);
    return this.buffers.get(runId) ?? [];
  }

  /** Signal completion and release buffers/emitters. */
  complete(runId: string): void {
    const e = this.emitters.get(runId);
    this.completed.add(runId);
    this.cancelled.delete(runId);
    e?.emit('done');
    // Keep the buffer briefly available for late subscribers; clear emitter.
    this.emitters.delete(runId);
    this.scheduleEviction(runId);
  }

  /**
   * Release a finished run's buffered log after the TTL.
   *
   * `completed` is deliberately NOT evicted: `onDone` relies on it to fire
   * immediately for a late subscriber, and a run that is merely unknown cannot
   * be treated as done — the client subscribes right after POST /review, before
   * the first event exists, so ending those streams would break the live log.
   * A Set of run uuids is kilobytes; the buffers are the megabytes.
   */
  private scheduleEviction(runId: string): void {
    this.cancelEviction(runId);
    const timer = setTimeout(() => {
      this.evictions.delete(runId);
      this.buffers.delete(runId);
      this.seq.delete(runId);
    }, this.bufferTtlMs);
    // Never let a pending eviction hold the process (or a test run) open.
    timer.unref?.();
    this.evictions.set(runId, timer);
  }

  private cancelEviction(runId: string): void {
    const timer = this.evictions.get(runId);
    if (timer) {
      clearTimeout(timer);
      this.evictions.delete(runId);
    }
  }

  /** Whether a run has already completed (for replay-then-end late subscribers). */
  isComplete(runId: string): boolean {
    return this.completed.has(runId);
  }

  onDone(runId: string, listener: () => void): () => void {
    // A run that already completed fires immediately so late SSE subscribers,
    // after replaying the buffer, end the stream instead of hanging forever.
    if (this.completed.has(runId)) {
      queueMicrotask(listener);
      return () => undefined;
    }
    const e = this.emitterFor(runId);
    e.once('done', listener);
    return () => e.off('done', listener);
  }
}

export const runBus = new RunBus();
