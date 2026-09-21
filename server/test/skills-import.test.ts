import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { FflateArchiveReader, ArchiveLimitError } from '../src/adapters/archive/index.js';
import { buildImportDraft, isUnsafeArchivePath } from '../src/modules/skills/import/preview.js';
import { AppError } from '../src/platform/errors.js';

const reader = new FflateArchiveReader();

const SKILL_MD = [
  '---',
  'name: flaky-test-patterns',
  'description: >-',
  '  Use when a test depends on time,',
  '  order or the network.',
  'type: rubric',
  '---',
  '# Flaky tests',
  'Flag sleeps and real clocks.',
].join('\n');

function expect4xx(fn: () => unknown, status = 422): AppError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(status);
    return err as AppError;
  }
  throw new Error('expected an AppError');
}

describe('skill import preview', () => {
  it('zip with SKILL.md + scripts/detect.sh: script listed as executable, never processed', () => {
    const zip = zipSync({
      'SKILL.md': strToU8(SKILL_MD),
      'scripts/detect.sh': strToU8('#!/bin/sh\nrm -rf /\n'),
      'reference.md': strToU8('# Extra'),
      'data.json': strToU8('{}'),
    });
    const r = buildImportDraft(reader, 'flaky-test-patterns.zip', zip);
    expect(r.draft).toEqual({
      name: 'flaky-test-patterns',
      description: 'Use when a test depends on time, order or the network.',
      type: 'rubric',
      body: '# Flaky tests\nFlag sleeps and real clocks.',
    });
    expect(r.corePath).toBe('SKILL.md');
    expect(r.ignored_files).toEqual(
      expect.arrayContaining([
        { path: 'scripts/detect.sh', reason: 'executable — not processed' },
        { path: 'reference.md', reason: 'reference file — not imported' },
        { path: 'data.json', reason: 'not imported' },
      ]),
    );
    expect(r.ignored_files).toHaveLength(3);
  });

  it('finds SKILL.md (any case) inside a single top-level folder; .skill is a zip', () => {
    const zip = zipSync({
      'flaky/': new Uint8Array(0),
      'flaky/skill.MD': strToU8('Just a body paragraph.'),
      'flaky/bin/tool': strToU8('binary'),
    });
    const r = buildImportDraft(reader, 'bundle.skill', zip);
    expect(r.corePath).toBe('flaky/skill.MD');
    expect(r.draft.name).toBe('flaky');
    expect(r.ignored_files).toEqual([{ path: 'flaky/bin/tool', reason: 'executable — not processed' }]);
  });

  it('uses the only .md when there is no SKILL.md', () => {
    const zip = zipSync({ 'api-versioning.md': strToU8('Version every route.'), 'x.py': strToU8('') });
    const r = buildImportDraft(reader, 'a.zip', zip);
    expect(r.draft.name).toBe('api-versioning');
    expect(r.ignored_files).toEqual([{ path: 'x.py', reason: 'executable — not processed' }]);
  });

  it('422 when the archive has no .md', () => {
    const zip = zipSync({ 'run.sh': strToU8('echo') });
    expect4xx(() => buildImportDraft(reader, 'a.zip', zip));
  });

  it('422 when several .md and no SKILL.md', () => {
    const zip = zipSync({ 'a.md': strToU8('a'), 'b.md': strToU8('b') });
    const err = expect4xx(() => buildImportDraft(reader, 'a.zip', zip));
    expect(err.details).toEqual({ files: ['a.md', 'b.md'] });
  });

  it('4xx for too many entries', () => {
    const files: Record<string, Uint8Array> = { 'SKILL.md': strToU8(SKILL_MD) };
    for (let i = 0; i < 200; i++) files[`f${i}.txt`] = strToU8('x');
    expect4xx(() => buildImportDraft(reader, 'a.zip', zipSync(files)));
  });

  it('4xx for a zip bomb (declared uncompressed size over the cap) before inflating', () => {
    // 3 MB of zeros compresses to a few KB — small upload, big expansion.
    const zip = zipSync({ 'SKILL.md': strToU8(SKILL_MD), 'bomb.txt': new Uint8Array(3 * 1024 * 1024) });
    expect(zip.length).toBeLessThan(64 * 1024);
    expect4xx(() => buildImportDraft(reader, 'a.zip', zip));
  });

  it('4xx for garbage bytes and unsupported extensions', () => {
    expect4xx(() => buildImportDraft(reader, 'a.zip', strToU8('not a zip')));
    expect4xx(() => buildImportDraft(reader, 'a.exe', strToU8('MZ')));
  });

  it('a plain .md upload is parsed directly with nothing ignored', () => {
    const r = buildImportDraft(reader, 'secret-gate.md', strToU8(SKILL_MD));
    expect(r.draft.name).toBe('flaky-test-patterns');
    expect(r.ignored_files).toEqual([]);
  });

  it('path-traversal names are never the core and are listed as unsafe', () => {
    expect(isUnsafeArchivePath('../evil.md')).toBe(true);
    expect(isUnsafeArchivePath('a/../../evil.md')).toBe(true);
    expect(isUnsafeArchivePath('/etc/passwd')).toBe(true);
    expect(isUnsafeArchivePath('C:/x.md')).toBe(true);
    expect(isUnsafeArchivePath('a\\..\\x.md')).toBe(true);
    expect(isUnsafeArchivePath('ok/SKILL.md')).toBe(false);

    const zip = zipSync({ 'SKILL.md': strToU8(SKILL_MD), '../evil.md': strToU8('x') });
    const r = buildImportDraft(reader, 'a.zip', zip);
    expect(r.corePath).toBe('SKILL.md');
    expect(r.ignored_files).toEqual([{ path: '../evil.md', reason: 'unsafe path — not imported' }]);
  });
});

describe('FflateArchiveReader', () => {
  it('never yields more than the declared size, even when the header lies', () => {
    const zip = zipSync({ 'SKILL.md': strToU8('x'.repeat(5000)) }, { level: 9 });
    // Shrink the central directory's declared uncompressed size to 100 bytes.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i < zip.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 100, true);
    }
    const out = reader.read(zip, 'SKILL.md', 1000);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it('read rejects an entry whose declared size exceeds maxBytes, and a missing entry', () => {
    const zip = zipSync({ 'a.md': strToU8('x'.repeat(2000)) });
    expect(() => reader.read(zip, 'a.md', 100)).toThrow(ArchiveLimitError);
    expect(() => reader.read(zip, 'nope.md', 100)).toThrow(ArchiveLimitError);
  });
});
