/**
 * RunBus — the in-memory run-log / SSE bus.
 *
 * CHARACTERIZATION TESTS, written before the F8 lifecycle work touches this
 * file. RunBus had no tests of any kind: the only thing exercising it was one
 * replay-only assertion in reviews.it.test.ts, which subscribes AFTER a run has
 * finished and so never covers a live subscriber, cancellation, or completion
 * ordering. These pin the behaviour that must survive capping the bridge queue
 * and evicting buffers.
 *
 * Hermetic: no DB, no HTTP. Each test builds its own RunBus rather than using
 * the module-level `runBus` singleton, which is shared by every Container in
 * the process (and therefore by every buildApp in a test run).
 */
import { describe, it, expect, vi } from 'vitest';
import { RunBus } from '../src/platform/sse.js';

describe('RunBus — publish and buffer', () => {
  it('numbers events per run, independently of other runs', () => {
    const bus = new RunBus();

    const a1 = bus.publish('run-a', 'info', 'first');
    const a2 = bus.publish('run-a', 'tool', 'second');
    const b1 = bus.publish('run-b', 'info', 'other run');

    expect([a1.seq, a2.seq]).toEqual([1, 2]);
    expect(b1.seq).toBe(1);
    expect(bus.buffer('run-a').map((e) => e.msg)).toEqual(['first', 'second']);
    expect(bus.buffer('run-b').map((e) => e.msg)).toEqual(['other run']);
  });

  it('stamps kind, message, payload and a wall-clock time', () => {
    const bus = new RunBus();

    const e = bus.publish('r', 'result', 'grounding', { passed: 2 });

    expect(e).toMatchObject({ runId: 'r', kind: 'result', msg: 'grounding', data: { passed: 2 } });
    expect(e.t).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('returns an empty buffer for a run it has never seen', () => {
    expect(new RunBus().buffer('nope')).toEqual([]);
  });
});

describe('RunBus — subscribe', () => {
  it('replays what was already buffered, then delivers live events', () => {
    const bus = new RunBus();
    bus.publish('r', 'info', 'before');

    const seen: string[] = [];
    bus.subscribe('r', (e) => seen.push(e.msg));
    expect(seen).toEqual(['before']); // replay happens synchronously on subscribe

    bus.publish('r', 'info', 'after');
    expect(seen).toEqual(['before', 'after']);
  });

  it('stops delivering once unsubscribed', () => {
    const bus = new RunBus();
    const seen: string[] = [];

    const off = bus.subscribe('r', (e) => seen.push(e.msg));
    bus.publish('r', 'info', 'one');
    off();
    bus.publish('r', 'info', 'two');

    expect(seen).toEqual(['one']);
  });

  it('still replays the buffer for a subscriber that arrives after completion', () => {
    // The replay-first contract the SSE route depends on: a late client gets
    // the whole log rather than an empty stream.
    const bus = new RunBus();
    bus.publish('r', 'info', 'Starting review');
    bus.complete('r');

    const seen: string[] = [];
    bus.subscribe('r', (e) => seen.push(e.msg));

    expect(seen).toEqual(['Starting review']);
  });
});

describe('RunBus — completion', () => {
  it('fires onDone listeners registered before completion', () => {
    const bus = new RunBus();
    const done = vi.fn();
    bus.onDone('r', done);

    bus.complete('r');

    expect(done).toHaveBeenCalledTimes(1);
    expect(bus.isComplete('r')).toBe(true);
  });

  it('fires onDone on a microtask for a run that already completed', async () => {
    // Without this, a late SSE subscriber would replay the buffer and then hang
    // forever waiting for a 'done' that can no longer be emitted.
    const bus = new RunBus();
    bus.complete('r');

    const done = vi.fn();
    bus.onDone('r', done);
    expect(done).not.toHaveBeenCalled(); // deferred, not synchronous

    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('keeps the buffer after completion, which is what trace persistence reads', () => {
    const bus = new RunBus();
    bus.publish('r', 'info', 'Starting review');
    bus.publish('r', 'result', 'Citation grounding: 2/2 passed');

    bus.complete('r');

    expect(bus.buffer('r').map((e) => e.msg)).toEqual([
      'Starting review',
      'Citation grounding: 2/2 passed',
    ]);
  });
});

describe('RunBus — buffer eviction (F8)', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('releases a finished run’s buffer after the TTL, but remembers it completed', async () => {
    const bus = new RunBus(5);
    bus.publish('r', 'info', 'hello');
    bus.complete('r');

    await sleep(40);

    // Read only AFTER the wait: reading cancels a pending eviction by design.
    expect(bus.buffer('r')).toEqual([]);
    // Completion is still known, so a late subscriber ends instead of hanging.
    expect(bus.isComplete('r')).toBe(true);
  });

  it('does not evict while something is still reading the log', async () => {
    // The cancel path: cancelRun() completes the bus, then the executor
    // unwinds and reads the buffer to persist the trace. Evicting in that
    // window would persist an empty log.
    const bus = new RunBus(20);
    bus.publish('r', 'info', 'hello');
    bus.complete('r');

    expect(bus.buffer('r')).toHaveLength(1); // trace persistence reads it
    await sleep(50);
    expect(bus.buffer('r')).toHaveLength(1); // that read cancelled the eviction

    bus.complete('r'); // the executor completes again — re-arms it
    await sleep(50);
    expect(bus.buffer('r')).toEqual([]);
  });

  it('keeps a live run’s buffer indefinitely', async () => {
    const bus = new RunBus(5);
    bus.publish('r', 'info', 'still running');

    await sleep(40);

    expect(bus.buffer('r')).toHaveLength(1);
  });
});

describe('RunBus — cancellation', () => {
  it('records and reports a cancellation request', () => {
    const bus = new RunBus();
    expect(bus.isCancelled('r')).toBe(false);

    bus.cancel('r');

    expect(bus.isCancelled('r')).toBe(true);
  });

  it('scopes cancellation to one run', () => {
    const bus = new RunBus();
    bus.cancel('r');
    expect(bus.isCancelled('other')).toBe(false);
  });

  it('clears the cancellation flag on completion', () => {
    // The runner checks isCancelled at each checkpoint; leaving the flag set
    // after the run ended would cancel a later run that reused the id.
    const bus = new RunBus();
    bus.cancel('r');

    bus.complete('r');

    expect(bus.isCancelled('r')).toBe(false);
  });
});
