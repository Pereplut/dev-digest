/**
 * `toStoredTour` — the DTO mapper (invariant I2). Hermetic: pure function
 * over a row shape, no DB. The claim-flow/concurrency behaviour of
 * `OnboardingRepository` itself needs Postgres and lives in
 * `onboarding-concurrency.it.test.ts` (the user's Docker lane).
 */
import { describe, it, expect } from 'vitest';
import { toStoredTour } from '../src/modules/onboarding/repository/onboarding.repo.js';
import type { OnboardingRow } from '../src/db/rows.js';

function row(over: Partial<OnboardingRow> = {}): OnboardingRow {
  return {
    repoId: 'r1',
    json: {},
    generatedAt: new Date('2026-01-01T00:00:00Z'),
    status: 'not_generated',
    reason: null,
    startedAt: null,
    jobId: null,
    generationId: null,
    ...over,
  };
}

describe('toStoredTour', () => {
  it('generated_at is null when json.sections is absent, even though the column itself is non-null', () => {
    const stored = toStoredTour(row({ json: {} }));
    expect(stored.sections).toBeNull();
    expect(stored.generatedAt).toBeNull();
  });

  it('a claim row (json: {}) is indistinguishable from "never generated" to the DTO mapper', () => {
    // This is the whole point of invariant I1/I2: the claim's INSERT must
    // write SOMETHING into the NOT NULL `json` column, and that something
    // must not look like a stored tour.
    const stored = toStoredTour(row({ json: {}, generatedAt: new Date() }));
    expect(stored.sections).toBeNull();
  });

  it('generated_at is the row value once json.sections exists', () => {
    const sections = [
      { kind: 'architecture', title: 'Architecture', body: 'x', diagram: null, links: [], generated: true, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
    ];
    const generatedAt = new Date('2026-03-01T00:00:00Z');
    const stored = toStoredTour(row({ json: { sections }, generatedAt }));
    expect(stored.sections).toEqual(sections);
    expect(stored.generatedAt).toBe(generatedAt.toISOString());
  });

  it('malformed json (wrong shape) degrades to no stored tour rather than throwing', () => {
    const stored = toStoredTour(row({ json: { sections: 'not-an-array' } as unknown as Record<string, unknown> }));
    expect(stored.sections).toBeNull();
  });
});
