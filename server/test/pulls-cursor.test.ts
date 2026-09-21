/**
 * PR-list cursor codec (`modules/pulls/helpers.ts`). The repository binds both
 * halves into SQL casts, so anything the decoder lets through must be a value
 * Postgres accepts; everything else has to come back `null` (a 400).
 */
import { describe, it, expect } from 'vitest';
import { decodePullCursor, encodePullCursor } from '../src/modules/pulls/helpers.js';
import type { PullRow } from '../src/db/rows.js';

const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';
const enc = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('pull cursor codec', () => {
  it('round-trips a row, including a NULL updated_at', () => {
    const at = new Date('2026-09-18T10:00:00.000Z');
    expect(decodePullCursor(encodePullCursor({ id: ID, updatedAt: at } as PullRow))).toEqual({ updatedAt: at, id: ID });
    expect(decodePullCursor(encodePullCursor({ id: ID, updatedAt: null } as PullRow))).toEqual({
      updatedAt: new Date(0),
      id: ID,
    });
  });

  it.each([
    ['garbage', 'not-a-real-cursor'],
    ['non-uuid id', enc('2020-01-01T00:00:00.000Z|x')],
    ['empty id', enc('2020-01-01T00:00:00.000Z|')],
    ['non-ISO timestamp', enc(`January 1 2020|${ID}`)],
    ['out-of-range year', enc(`+275760-09-13T00:00:00.000Z|${ID}`)],
    ['no separator', enc(ID)],
  ])('rejects %s', (_label, raw) => {
    expect(decodePullCursor(raw)).toBeNull();
  });
});
