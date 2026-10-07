import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Hermetic guard for the "migration is additive" review check (spec 0019's
 * `## Non-functional`, formerly AC-5): the diff for a schema change must add
 * exactly one new migration file and never hand-edit, rename or reorder an
 * existing one. This cannot be enforced from inside a running system (a
 * reviewer reads `git diff --name-status`), so the standing guard is a
 * journal-hash proxy: every pre-existing migration's content hash is pinned
 * here, and a hand-edit, rename or reorder of any of them changes either the
 * hash at that index or the tag at that index, failing the test.
 *
 * The fixture below is frozen at indices 0-21 (migrations `0000_init.sql`
 * through `0021_jazzy_skullbuster.sql`, as committed before spec 0019). A new
 * migration appends a new entry with a higher idx and must NOT be added here.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../src/db/migrations/', import.meta.url));
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

/** idx → { tag, sha256 of the migration's .sql content }, frozen 2026-10-07 (spec 0019, S10). */
const FROZEN_JOURNAL: { idx: number; tag: string; sha256: string }[] = [
  { idx: 0, tag: '0000_init', sha256: 'ae250334482de08c77b8647644cee3d83e68bfe643b31a5c2159621ca14e3512' },
  { idx: 1, tag: '0001_add_agent_run_error', sha256: '7b6654e7fc52b2cacea2d71a213f4518e017d09b250c3faafd66edd4c3de16bd' },
  { idx: 2, tag: '0002_warm_moonstone', sha256: '887eb514acaf292c17b67d76677c97687262d65b41e9c629458e7d9c0df657ea' },
  { idx: 3, tag: '0003_minor_overlord', sha256: '87ce590763ef23d4b4f1274e5cc07c86c2f3adcbc73b1432d02d53ad7fc21576' },
  { idx: 4, tag: '0004_needy_grey_gargoyle', sha256: 'e094de3ab321d0e549d7ecda76caeecb21bf5270fec3c444725862d3824bf569' },
  { idx: 5, tag: '0005_gray_peter_parker', sha256: 'fc635196ba86822437d151a1015b2171b1b52d11c3181cdecdd8ed66ebcb3f10' },
  { idx: 6, tag: '0006_sharp_mordo', sha256: '34c3c19ef2b87aa437510e3f109720ad03f2a25db1d66b9ab9a163c3e0d52e71' },
  { idx: 7, tag: '0007_minor_mad_thinker', sha256: '86e5d03c157125c1a21df720d76daef522a33a11387870501ad30e2a0ceaf7a6' },
  { idx: 8, tag: '0008_striped_lady_deathstrike', sha256: '2f2d5e4f82e3f9308ecedc8008ef97c509529b11162a47e4b7b5a166cf93077b' },
  { idx: 9, tag: '0009_complex_runaways', sha256: '2e4c88e4ff83d9be6864d4f7e86ecc7ac24b815121a2f5ebb021bfa140518957' },
  { idx: 10, tag: '0010_lethal_karen_page', sha256: '348c3d9c6b565440d70c714df0ee023c12ce6bb755132ccc06b33ca4ff1a09e1' },
  { idx: 11, tag: '0011_classy_smiling_tiger', sha256: '311cb0ad3f56057d4a4c45883e632081573d6dd98399e6759ec4e46f55245327' },
  { idx: 12, tag: '0012_past_reptil', sha256: '6f0ce0c9d155ebc628dc33a09c6357e9fa50fd8cb743d5f9b7dd657b6537674a' },
  { idx: 13, tag: '0013_magenta_nehzno', sha256: '84699c30d5ab28f752e5053d93d7f748bfaa11c6c58da493150a896ebfa1f759' },
  { idx: 14, tag: '0014_absurd_human_robot', sha256: 'e556fdcf31f8e5fd92f3aaca1ac8702175f916f872660df0c6a1c307631ab110' },
  { idx: 15, tag: '0015_wooden_iron_fist', sha256: '551ea91a4836732a4b5100736f4d575e358139067fef83e948d37581e0172664' },
  { idx: 16, tag: '0016_volatile_wallop', sha256: 'f013199d3a35a9e3f0420dfdc2ff4e83bd8249f7f6afcb360b01e3202dc84fce' },
  { idx: 17, tag: '0017_oval_thunderbolt', sha256: 'f4d6c7b39c5b6604db2624923a926966eb7628f4051631903572627f031d197f' },
  { idx: 18, tag: '0018_clever_bloodstorm', sha256: '42c7b8ea7b0bdfeda7af694f77ff9385684c15915f3b032c9da863a4c66e7439' },
  { idx: 19, tag: '0019_flimsy_gressill', sha256: 'b4af5018f4e652885df7f7864f0bbe562d890192dc91bce9b52a1768b8f7ef87' },
  { idx: 20, tag: '0020_opposite_tenebrous', sha256: '54ea0a5a6eb27555f1616a23a16e90228b7875f1c969f9386e75bb408caf0939' },
  { idx: 21, tag: '0021_jazzy_skullbuster', sha256: 'f209fbaf71486d6659883de42811d55dd187e27da40d8c173e7ddd6d3275d28b' },
];

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('migrations-additive guard (review-checklist line, spec 0019 `## Non-functional`)', () => {
  it('every frozen journal entry (idx 0-21) still matches its committed tag + content hash', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as Journal;
    const byIdx = new Map(journal.entries.map((e) => [e.idx, e]));

    for (const frozen of FROZEN_JOURNAL) {
      const entry = byIdx.get(frozen.idx);
      expect(entry, `journal entry idx ${frozen.idx} is missing`).toBeDefined();
      expect(entry!.tag, `journal entry idx ${frozen.idx} was reordered or renamed`).toBe(frozen.tag);

      const sqlPath = join(MIGRATIONS_DIR, `${frozen.tag}.sql`);
      const actualHash = sha256File(sqlPath);
      expect(actualHash, `${frozen.tag}.sql was hand-edited after it shipped`).toBe(frozen.sha256);
    }
  });

  it('negative control: the hash check actually distinguishes content, not just presence', () => {
    const tamperedHash = createHash('sha256').update('-- a hand-edit\n').digest('hex');
    expect(tamperedHash).not.toBe(FROZEN_JOURNAL[0]!.sha256);
  });
});
