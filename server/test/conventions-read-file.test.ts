import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTextFile } from '../src/modules/conventions/service.js';
import { MAX_SAMPLE_FILE_BYTES } from '../src/modules/conventions/constants.js';

/**
 * `readTextFile` is the only way repository bytes enter the extractor, so it is
 * the chokepoint for "what may this feature read". Hermetic: a real temp tree,
 * no DB, no clone, no model.
 */
describe('readTextFile', () => {
  let root: string;
  let outside: string;

  beforeAll(async () => {
    outside = await mkdtemp(join(tmpdir(), 'dd-outside-'));
    await writeFile(join(outside, 'secrets.env'), 'AWS_SECRET=hunter2');

    root = await mkdtemp(join(tmpdir(), 'dd-clone-'));
    await writeFile(join(root, 'tsconfig.json'), '{ "compilerOptions": {} }');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'app.ts'), 'export const x = 1;\n');

    // The clone's own git metadata, which carries the PAT from the clone URL.
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(
      join(root, '.git', 'config'),
      '[remote "origin"]\n\turl = https://x-access-token:ghp_SECRET@github.com/acme/x\n',
    );

    // A repository is free to commit these.
    await symlink(join(outside, 'secrets.env'), join(root, '.prettierrc'));
    await symlink(join(root, '.git', 'config'), join(root, 'package.json'));
    await mkdir(join(root, 'linked'), { recursive: true });
    await symlink(outside, join(root, 'linked', 'out'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('reads an ordinary file in the clone', async () => {
    expect(await readTextFile(root, 'src/app.ts')).toBe('export const x = 1;\n');
    expect(await readTextFile(root, 'tsconfig.json')).toContain('compilerOptions');
  });

  it('returns null for a file that is not there', async () => {
    expect(await readTextFile(root, 'nope.ts')).toBeNull();
  });

  /**
   * Regression: the path check vetted the STRING only, and `readFile` follows
   * links — so a committed symlink read whatever it pointed at, which then went
   * into the prompt sample and, once cited, into `evidence_snippet`.
   */
  it('refuses a config symlinked to a file outside the clone', async () => {
    const content = await readTextFile(root, '.prettierrc');
    expect(content).toBeNull();
  });

  it('refuses a config symlinked to the clone\'s own .git/config', async () => {
    const content = await readTextFile(root, 'package.json');
    expect(content).toBeNull();
    expect(content ?? '').not.toContain('ghp_SECRET');
  });

  it('refuses a path that escapes through a symlinked DIRECTORY', async () => {
    expect(await readTextFile(root, 'linked/out/secrets.env')).toBeNull();
  });

  it('refuses .git even when reached directly', async () => {
    expect(await readTextFile(root, '.git/config')).toBeNull();
  });

  /**
   * Regression: the sample caps are applied AFTER the read, so without a size
   * guard the whole file is resident in the API process first — and a repo need
   * only commit a huge `package.json`, which is probed by fixed name.
   */
  it('refuses a file larger than the sample cap', async () => {
    const big = 'x'.repeat(MAX_SAMPLE_FILE_BYTES + 1);
    await writeFile(join(root, 'huge.ts'), big);
    expect(await readTextFile(root, 'huge.ts')).toBeNull();
  });

  it('still reads a file just under the cap', async () => {
    await writeFile(join(root, 'big-enough.ts'), 'y'.repeat(MAX_SAMPLE_FILE_BYTES - 1));
    const content = await readTextFile(root, 'big-enough.ts');
    expect(content).toHaveLength(MAX_SAMPLE_FILE_BYTES - 1);
  });

  it('still refuses the string-level escapes', async () => {
    expect(await readTextFile(root, '../secrets.env')).toBeNull();
    expect(await readTextFile(root, '/etc/passwd')).toBeNull();
  });
});
