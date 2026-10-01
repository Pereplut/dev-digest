/**
 * `formatRunDuration` exists to keep one decision in one place: what a run with
 * no measured duration shows. The interesting cases are therefore the ones that
 * are NOT a number of milliseconds.
 */
import { describe, it, expect } from 'vitest';
import { formatRunDuration, NO_DURATION } from '../src/platform/duration.js';

describe('formatRunDuration', () => {
  it('formats a measured duration', () => {
    expect(formatRunDuration(1500)).toBe('1.5s');
    expect(formatRunDuration(250)).toBe('250ms');
  });

  it('treats a missing duration as not measured, not as zero', () => {
    expect(formatRunDuration(null)).toBe(NO_DURATION);
    expect(formatRunDuration(undefined)).toBe(NO_DURATION);
  });

  it('refuses a nonsense duration rather than rendering it', () => {
    expect(formatRunDuration(Number.NaN)).toBe(NO_DURATION);
    expect(formatRunDuration(Number.POSITIVE_INFINITY)).toBe(NO_DURATION);
    expect(formatRunDuration(-1)).toBe(NO_DURATION);
  });

  it('still formats a genuine zero, which is a measurement', () => {
    expect(formatRunDuration(0)).toBe('0ms');
  });
});
