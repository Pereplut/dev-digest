import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { buildGhaWorkflowYaml, buildGhaWorkflowFile, normalizeTriggers } from '../src/modules/ci/workflow.js';
import {
  CI_RESULT_ARTIFACT_NAME,
  CI_RESULT_FILE_NAME,
  FORBIDDEN_TRIGGER_EVENTS,
  GHA_WORKFLOW_PATH,
  OPENROUTER_SECRET_EXPR,
  GITHUB_TOKEN_SECRET_EXPR,
  PIN,
  POST_AS_VALUES,
  PR_BASE_SHA_EXPR,
  RUNNER_ENTRY_PATH,
  RUNNER_RUN_COMMAND,
} from '../src/modules/ci/constants.js';

/**
 * Workflow-YAML security tests (spec 0022: AC-30..AC-38, AC-78, AC-91).
 *
 * These PARSE the generated YAML with the `yaml` package and check structure,
 * never regex on the raw text. The invariants live in one checker,
 * `checkWorkflow`, which returns the list of violated rules. The checker is
 * only trustworthy if it can FAIL, so the second half of this file feeds it
 * deliberately bad fixtures and asserts each one is caught.
 */

// ---------------------------------------------------------------------------
// Parsed-document helpers (no `any`: everything is `unknown` + narrowing)
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asRec(v: unknown, what: string): Rec {
  if (!isRec(v)) throw new Error(`expected object at ${what}`);
  return v;
}

function asArr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`expected array at ${what}`);
  return v;
}

interface Leaf {
  /** Dotted path with array indices, e.g. `jobs.review.steps.3.env.GITHUB_TOKEN`. */
  path: string;
  /** The property keys along the path (for key-name checks). */
  keys: string[];
  value: string;
}

/** Every string leaf in the document (array indices count as path segments). */
function leaves(node: unknown, segs: string[] = []): Leaf[] {
  if (typeof node === 'string') return [{ path: segs.join('.'), keys: segs, value: node }];
  if (Array.isArray(node)) return node.flatMap((n, i) => leaves(n, [...segs, String(i)]));
  if (isRec(node)) return Object.entries(node).flatMap(([k, v]) => leaves(v, [...segs, k]));
  return [];
}

/** Every mapping key in the document, at any depth. */
function allKeys(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(allKeys);
  if (isRec(node)) return Object.entries(node).flatMap(([k, v]) => [k, ...allKeys(v)]);
  return [];
}

interface Step {
  index: number;
  doc: Rec;
}

function reviewJobOf(doc: Rec): Rec {
  return asRec(asRec(doc.jobs, 'jobs').review, 'jobs.review');
}

function stepsOf(doc: Rec): Step[] {
  return asArr(reviewJobOf(doc).steps, 'steps').map((s, index) => ({ index, doc: asRec(s, `steps.${index}`) }));
}

const SHA_PIN = /^[^@\s]+@[0-9a-f]{40}$/;
const EXPECTED_ACTIONS = ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact'];
const EXPECTED_SECRET_EXPRS = [OPENROUTER_SECRET_EXPR, GITHUB_TOKEN_SECRET_EXPR];

interface Violation {
  rule: string;
  detail: string;
}

/**
 * The invariant checker. Returns every violated rule for a workflow YAML text;
 * an empty array means the workflow satisfies AC-30..AC-38, AC-78 and AC-91.
 * `expectedPostAs` / `expectedTypes` are the export inputs the workflow was
 * generated from.
 */
function checkWorkflow(
  yamlText: string,
  expected: { postAs: string; types: string[] },
): Violation[] {
  const out: Violation[] = [];
  const fail = (rule: string, detail: string): void => {
    out.push({ rule, detail });
  };

  const doc = asRec(parse(yamlText), 'document');
  const all = leaves(doc);
  const job = reviewJobOf(doc);
  const steps = stepsOf(doc);

  // AC-30 -- trigger is `pull_request` only, with the filtered types.
  const on = doc.on;
  if (!isRec(on)) {
    fail('AC-30', 'on: is not a mapping');
  } else {
    const keys = Object.keys(on);
    if (keys.length !== 1 || keys[0] !== 'pull_request') fail('AC-30', `on keys = ${JSON.stringify(keys)}`);
    const types = isRec(on.pull_request) ? on.pull_request.types : undefined;
    if (JSON.stringify(types) !== JSON.stringify(expected.types)) {
      fail('AC-30', `types = ${JSON.stringify(types)}, expected ${JSON.stringify(expected.types)}`);
    }
  }

  // AC-31 -- no forbidden event name anywhere in the document (keys or values).
  const names = [...allKeys(doc), ...all.map((l) => l.value)];
  for (const event of FORBIDDEN_TRIGGER_EVENTS) {
    if (names.some((n) => n.includes(event))) fail('AC-31', `forbidden event ${event} present`);
  }

  // AC-32 -- exact top-level permissions, none per job.
  if (JSON.stringify(doc.permissions) !== JSON.stringify({ contents: 'read', 'pull-requests': 'write' })) {
    fail('AC-32', `permissions = ${JSON.stringify(doc.permissions)}`);
  }
  for (const [name, j] of Object.entries(asRec(doc.jobs, 'jobs'))) {
    if (isRec(j) && 'permissions' in j) fail('AC-32', `job ${name} declares permissions`);
  }

  // AC-33 -- job-level `if` refers to the head repo.
  if (typeof job.if !== 'string' || !job.if.includes('head.repo')) fail('AC-33', `job if = ${String(job.if)}`);

  // AC-34 -- every `uses` is SHA-pinned; the action set is exactly the three.
  const uses = steps.map((s) => s.doc.uses).filter((u): u is string => typeof u === 'string');
  for (const u of uses) if (!SHA_PIN.test(u)) fail('AC-34', `unpinned uses: ${u}`);
  const actionNames = [...new Set(uses.map((u) => u.split('@')[0]))].sort();
  if (JSON.stringify(actionNames) !== JSON.stringify(EXPECTED_ACTIONS)) {
    fail('AC-34', `actions = ${JSON.stringify(actionNames)}`);
  }
  if (all.some((l) => l.value.includes('devdigest/review-action'))) fail('AC-34', 'devdigest/review-action present');

  // The review step is the one whose run is the runner command.
  const reviewStep = steps.find(
    (s) => typeof s.doc.run === 'string' && s.doc.run.startsWith('node ') && s.doc.run.includes(RUNNER_ENTRY_PATH),
  );

  // AC-35 -- secrets: only the two exact expressions, only under the review step's env.
  for (const l of all) {
    if (!l.value.includes('secrets.')) continue;
    const underReviewEnv =
      reviewStep !== undefined && l.path.startsWith(`jobs.review.steps.${reviewStep.index}.env.`);
    if (!EXPECTED_SECRET_EXPRS.includes(l.value)) fail('AC-35', `non-exact secret reference at ${l.path}: ${l.value}`);
    if (!underReviewEnv) fail('AC-35', `secret outside the review step env at ${l.path}`);
  }

  // AC-36 -- no `run` contains an expression; the review run is the fixed command.
  for (const s of steps) {
    if (typeof s.doc.run === 'string' && s.doc.run.includes('${{')) {
      fail('AC-36', `run of step ${s.index} contains an expression`);
    }
  }
  if (!reviewStep || reviewStep.doc.run !== RUNNER_RUN_COMMAND) fail('AC-36', 'review run is not the fixed command');

  // AC-37 -- the review env passes the identity and DEVDIGEST_POST_AS equals the input.
  const env = reviewStep && isRec(reviewStep.doc.env) ? reviewStep.doc.env : {};
  const wantEnv: Record<string, string> = {
    PR_NUMBER: '${{ github.event.pull_request.number }}',
    GITHUB_REPOSITORY: '${{ github.repository }}',
    DEVDIGEST_COMMIT_SHA: '${{ github.event.pull_request.head.sha }}',
    DEVDIGEST_REPOSITORY_ID: '${{ github.repository_id }}',
  };
  for (const [k, v] of Object.entries(wantEnv)) if (env[k] !== v) fail('AC-37', `env ${k} = ${String(env[k])}`);
  if (env.DEVDIGEST_POST_AS !== expected.postAs) fail('AC-37', `DEVDIGEST_POST_AS = ${String(env.DEVDIGEST_POST_AS)}`);

  // AC-38 -- upload step: always(), artifact name, path.
  const upload = steps.find((s) => typeof s.doc.uses === 'string' && s.doc.uses.startsWith('actions/upload-artifact@'));
  if (!upload) {
    fail('AC-38', 'no upload step');
  } else {
    const cond = upload.doc.if;
    if (typeof cond !== 'string' || !cond.includes('always()')) fail('AC-38', `upload if = ${String(cond)}`);
    const w = isRec(upload.doc.with) ? upload.doc.with : {};
    if (w.name !== CI_RESULT_ARTIFACT_NAME) fail('AC-38', `artifact name = ${String(w.name)}`);
    if (w.path !== CI_RESULT_FILE_NAME) fail('AC-38', `artifact path = ${String(w.path)}`);
  }

  // AC-78 -- checkout at the base sha; no `ref` value anywhere names the head or merge ref.
  const checkouts = steps.filter((s) => typeof s.doc.uses === 'string' && s.doc.uses.startsWith('actions/checkout@'));
  if (checkouts.length === 0) fail('AC-78', 'no checkout step');
  for (const c of checkouts) {
    const w = isRec(c.doc.with) ? c.doc.with : {};
    if (w.ref !== PR_BASE_SHA_EXPR) fail('AC-78', `checkout ref = ${String(w.ref)}`);
  }
  for (const l of all) {
    if (l.keys[l.keys.length - 1] !== 'ref') continue;
    if (/head\.sha|head_ref|refs\/pull|merge/.test(l.value)) fail('AC-78', `ref at ${l.path} names the head: ${l.value}`);
  }

  // AC-91 -- a guard step before the runner tests for the runner file; runner + upload depend on it.
  const guard = steps.find(
    (s) => typeof s.doc.run === 'string' && s.doc.run.includes(RUNNER_ENTRY_PATH) && s !== reviewStep,
  );
  if (!guard || !reviewStep) {
    fail('AC-91', 'no guard step');
  } else {
    if (guard.index >= reviewStep.index) fail('AC-91', 'guard does not precede the runner step');
    if (typeof guard.doc.id !== 'string') {
      fail('AC-91', 'guard has no id');
    } else {
      const ref = `steps.${guard.doc.id}.outputs`;
      for (const [label, s] of [['runner', reviewStep], ['upload', upload]] as const) {
        const cond = s?.doc.if;
        if (typeof cond !== 'string' || !cond.includes(ref)) fail('AC-91', `${label} step not conditioned on the guard`);
      }
    }
    if (!/not installed/i.test(String(guard.doc.run))) fail('AC-91', 'guard prints no "not installed" notice');
  }

  return out;
}

const rules = (vs: Violation[]): string[] => [...new Set(vs.map((v) => v.rule))].sort();

/** Replace `from` with `to`; fails loudly if `from` is absent so a mutation can never silently no-op. */
function mutate(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`mutation target not found: ${from}`);
  return text.replace(from, to);
}

const DEFAULT_EXPECTED = { postAs: 'github_review', types: ['opened', 'synchronize'] };

// ---------------------------------------------------------------------------
// The real generator
// ---------------------------------------------------------------------------

describe('buildGhaWorkflowYaml -- security invariants (parsed YAML)', () => {
  const yamlText = buildGhaWorkflowYaml();
  const doc = asRec(parse(yamlText), 'document');

  it('AC-30: on has exactly one key, pull_request; types are the requested triggers filtered to the allowed set', () => {
    expect(Object.keys(asRec(doc.on, 'on'))).toEqual(['pull_request']);
    expect(asRec(asRec(doc.on, 'on').pull_request, 'pr').types).toEqual(['opened', 'synchronize']);

    // Input ['opened','issue_comment','reopened'] is filtered to ['opened','reopened'].
    const filtered = asRec(parse(buildGhaWorkflowYaml({ triggers: ['opened', 'issue_comment', 'reopened'] })), 'doc');
    expect(asRec(asRec(filtered.on, 'on').pull_request, 'pr').types).toEqual(['opened', 'reopened']);
    expect(normalizeTriggers(['opened', 'issue_comment', 'reopened'])).toEqual(['opened', 'reopened']);
    // Only disallowed values falls back to the default, never to an empty list.
    expect(normalizeTriggers(['issue_comment'])).toEqual(['opened', 'synchronize']);
  });

  it('AC-31: no forbidden event name appears anywhere in the document, for any trigger input', () => {
    for (const triggers of [undefined, ['opened', 'synchronize', 'reopened'], [...FORBIDDEN_TRIGGER_EVENTS]]) {
      const parsed = asRec(parse(buildGhaWorkflowYaml({ triggers })), 'doc');
      const names = [...allKeys(parsed), ...leaves(parsed).map((l) => l.value)];
      for (const event of FORBIDDEN_TRIGGER_EVENTS) {
        expect(names.filter((n) => n.includes(event))).toEqual([]);
      }
    }
  });

  it('AC-32: top-level permissions deep-equal the two entries and no job has permissions', () => {
    expect(doc.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(Object.keys(asRec(doc.permissions, 'permissions'))).toHaveLength(2);
    for (const job of Object.values(asRec(doc.jobs, 'jobs'))) {
      expect(asRec(job, 'job')).not.toHaveProperty('permissions');
    }
  });

  it('AC-33: the review job is gated on the head repo being the base repo', () => {
    const cond = reviewJobOf(doc).if;
    expect(typeof cond).toBe('string');
    expect(cond).toContain('head.repo');
    expect(cond).toBe('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('AC-34: every uses is pinned to a 40-hex SHA and the action names are exactly the three', () => {
    const uses = stepsOf(doc)
      .map((s) => s.doc.uses)
      .filter((u): u is string => typeof u === 'string');
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const u of uses) expect(u).toMatch(SHA_PIN);
    expect([...new Set(uses.map((u) => u.split('@')[0]))].sort()).toEqual(EXPECTED_ACTIONS);
    expect(uses).toContain(PIN.checkout);
    expect(yamlText).not.toContain('devdigest/review-action');
  });

  it('AC-35: every secrets. occurrence is one of the two exact expressions and sits under the review step env', () => {
    const steps = stepsOf(doc);
    const review = steps.find((s) => s.doc.run === RUNNER_RUN_COMMAND);
    expect(review).toBeDefined();
    const withSecrets = leaves(doc).filter((l) => l.value.includes('secrets.'));
    expect(withSecrets.map((l) => l.value).sort()).toEqual([...EXPECTED_SECRET_EXPRS].sort());
    for (const l of withSecrets) {
      expect(l.path.startsWith(`jobs.review.steps.${review!.index}.env.`)).toBe(true);
    }
    const env = asRec(review!.doc.env, 'env');
    expect(env.OPENROUTER_API_KEY).toBe(OPENROUTER_SECRET_EXPR);
    expect(env.GITHUB_TOKEN).toBe(GITHUB_TOKEN_SECRET_EXPR);
  });

  it('AC-36: no run contains a ${{ expression, and the review run is exactly the fixed command', () => {
    const runs = stepsOf(doc)
      .map((s) => s.doc.run)
      .filter((r): r is string => typeof r === 'string');
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (const r of runs) expect(r).not.toContain('${{');
    expect(RUNNER_RUN_COMMAND).toBe('node .devdigest/runner/index.js');
    expect(runs).toContain('node .devdigest/runner/index.js');
  });

  it.each(POST_AS_VALUES)('AC-37: the review env passes the PR identity and DEVDIGEST_POST_AS equals the input (%s)', (postAs) => {
    const parsed = asRec(parse(buildGhaWorkflowYaml({ postAs })), 'doc');
    const review = stepsOf(parsed).find((s) => s.doc.run === RUNNER_RUN_COMMAND)!;
    const env = asRec(review.doc.env, 'env');
    expect(env.PR_NUMBER).toBe('${{ github.event.pull_request.number }}');
    expect(env.GITHUB_REPOSITORY).toBe('${{ github.repository }}');
    expect(env.DEVDIGEST_COMMIT_SHA).toBe('${{ github.event.pull_request.head.sha }}');
    expect(env.DEVDIGEST_REPOSITORY_ID).toBe('${{ github.repository_id }}');
    expect(env.DEVDIGEST_POST_AS).toBe(postAs);
  });

  it('AC-37: an unknown post_as is not echoed into the workflow; it falls back to github_review', () => {
    const parsed = asRec(parse(buildGhaWorkflowYaml({ postAs: 'none"\n  evil: 1' })), 'doc');
    const review = stepsOf(parsed).find((s) => s.doc.run === RUNNER_RUN_COMMAND)!;
    expect(asRec(review.doc.env, 'env').DEVDIGEST_POST_AS).toBe('github_review');
    expect(Object.keys(asRec(parsed.jobs, 'jobs'))).toEqual(['review']);
  });

  it('AC-38: the upload step has if: always(), the artifact name and the result path', () => {
    const upload = stepsOf(doc).find((s) => String(s.doc.uses).startsWith('actions/upload-artifact@'));
    expect(upload).toBeDefined();
    expect(String(upload!.doc.if)).toContain('always()');
    expect(asRec(upload!.doc.with, 'with')).toEqual({ name: 'devdigest-result', path: 'devdigest-result.json' });
  });

  it('AC-78: the checkout ref is the PR base sha, and no ref anywhere names head.sha, head_ref or the merge ref', () => {
    const checkout = stepsOf(doc).filter((s) => String(s.doc.uses).startsWith('actions/checkout@'));
    expect(checkout).toHaveLength(1);
    expect(asRec(checkout[0]!.doc.with, 'with').ref).toBe('${{ github.event.pull_request.base.sha }}');

    const refs = leaves(doc).filter((l) => l.keys[l.keys.length - 1] === 'ref');
    expect(refs.length).toBeGreaterThanOrEqual(1);
    for (const r of refs) {
      expect(r.value).not.toContain('pull_request.head.sha');
      expect(r.value).not.toContain('github.head_ref');
      expect(r.value).not.toMatch(/refs\/pull|merge/);
    }
    // head.sha is still allowed under the review step env (AC-37), and only there.
    const headShaPaths = leaves(doc)
      .filter((l) => l.value.includes('pull_request.head.sha'))
      .map((l) => l.keys[l.keys.length - 1]);
    expect(headShaPaths).toEqual(['DEVDIGEST_COMMIT_SHA']);
  });

  it('AC-91: a guard step before the runner tests for the runner file; the runner and upload steps are conditioned on its output', () => {
    const steps = stepsOf(doc);
    const runner = steps.find((s) => s.doc.run === RUNNER_RUN_COMMAND)!;
    const guard = steps.find((s) => typeof s.doc.run === 'string' && s.doc.run.includes(`-f ${RUNNER_ENTRY_PATH}`))!;
    expect(guard).toBeDefined();
    expect(guard.index).toBeLessThan(runner.index);
    expect(typeof guard.doc.id).toBe('string');
    const outputRef = `steps.${String(guard.doc.id)}.outputs.present`;
    expect(String(guard.doc.run)).toMatch(/not installed on the base branch/);
    expect(String(guard.doc.run)).not.toMatch(/\bexit 1\b/);
    expect(String(runner.doc.if)).toContain(outputRef);
    const upload = steps.find((s) => String(s.doc.uses).startsWith('actions/upload-artifact@'))!;
    expect(String(upload.doc.if)).toContain(outputRef);
    expect(String(upload.doc.if)).toContain('always()');
  });

  it('the file wrapper installs it at the workflow path and marks it editable', () => {
    const file = buildGhaWorkflowFile({ postAs: 'none' });
    expect(file.path).toBe(GHA_WORKFLOW_PATH);
    expect(file.editable).toBe(true);
    expect(file.contents).toBe(buildGhaWorkflowYaml({ postAs: 'none' }));
  });

  it('the single invariant checker passes on the generated workflow for every post_as and trigger combination', () => {
    for (const postAs of POST_AS_VALUES) {
      for (const triggers of [undefined, ['opened'], ['opened', 'synchronize', 'reopened'], ['opened', 'issue_comment', 'reopened']]) {
        const types = normalizeTriggers(triggers);
        expect(checkWorkflow(buildGhaWorkflowYaml({ triggers, postAs }), { postAs, types })).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The checker must be able to fail (negative fixtures)
// ---------------------------------------------------------------------------

describe('checkWorkflow -- negative fixtures prove the checker can fail', () => {
  const good = buildGhaWorkflowYaml();

  it('the baseline is clean (so any violation below comes from the mutation alone)', () => {
    expect(checkWorkflow(good, DEFAULT_EXPECTED)).toEqual([]);
  });

  it('the spec fixture (issue_comment trigger + @v4 tag + a PR title in run:) fails the checker on AC-30, AC-31, AC-34 and AC-36', () => {
    let bad = mutate(good, 'pull_request:\n    types: [opened, synchronize]', 'pull_request:\n    types: [opened, synchronize]\n  issue_comment:\n    types: [created]');
    bad = mutate(bad, PIN.checkout, 'actions/checkout@v4');
    bad = mutate(bad, 'run: node .devdigest/runner/index.js', 'run: echo "${{ github.event.pull_request.title }}" && node .devdigest/runner/index.js');
    const violations = checkWorkflow(bad, DEFAULT_EXPECTED);
    expect(rules(violations)).toEqual(expect.arrayContaining(['AC-30', 'AC-31', 'AC-34', 'AC-36']));
  });

  const cases: { name: string; rule: string; from: string; to: string }[] = [
    { name: 'pull_request_target instead of pull_request', rule: 'AC-30', from: '\n  pull_request:\n', to: '\n  pull_request_target:\n' },
    { name: 'an extra "synchronize" type the input did not request', rule: 'AC-30', from: 'types: [opened, synchronize]', to: 'types: [opened, synchronize, labeled]' },
    { name: 'write-all permissions', rule: 'AC-32', from: 'contents: read', to: 'contents: write' },
    { name: 'a job-level permissions block', rule: 'AC-32', from: '    runs-on: ubuntu-latest', to: '    runs-on: ubuntu-latest\n    permissions:\n      contents: write' },
    { name: 'no fork gate on the job', rule: 'AC-33', from: 'if: github.event.pull_request.head.repo.full_name == github.repository', to: 'if: true' },
    { name: 'a tag-pinned action', rule: 'AC-34', from: PIN.setupNode, to: 'actions/setup-node@v4' },
    { name: 'a 39-char SHA pin', rule: 'AC-34', from: PIN.uploadArtifact, to: PIN.uploadArtifact.slice(0, -1) },
    { name: 'a marketplace review action', rule: 'AC-34', from: 'uses: ' + PIN.setupNode, to: 'uses: devdigest/review-action@' + 'a'.repeat(40) },
    { name: 'an OPENROUTER secret outside the review step env', rule: 'AC-35', from: "node-version: '22'", to: "node-version: '22'\n          token: ${{ secrets.OPENROUTER_API_KEY }}" },
    { name: 'a third secret reference', rule: 'AC-35', from: 'GITHUB_REPOSITORY: ${{ github.repository }}', to: 'GITHUB_REPOSITORY: ${{ secrets.PROD_DB_PASSWORD }}' },
    { name: 'an expression in the guard run', rule: 'AC-36', from: 'if [ -f .devdigest', to: 'echo ${{ github.head_ref }}; if [ -f .devdigest' },
    { name: 'a review run that is not the fixed command', rule: 'AC-36', from: 'run: node .devdigest/runner/index.js', to: 'run: node .devdigest/runner/index.js --extra' },
    { name: 'DEVDIGEST_POST_AS not equal to the input', rule: 'AC-37', from: 'DEVDIGEST_POST_AS: github_review', to: 'DEVDIGEST_POST_AS: none' },
    { name: 'the head sha missing from the env', rule: 'AC-37', from: 'DEVDIGEST_COMMIT_SHA: ${{ github.event.pull_request.head.sha }}', to: 'DEVDIGEST_COMMIT_SHA: ${{ github.sha }}' },
    { name: 'an upload step without always()', rule: 'AC-38', from: 'if: always() && steps.guard.outputs.present', to: 'if: steps.guard.outputs.present' },
    { name: 'a renamed artifact', rule: 'AC-38', from: 'name: devdigest-result', to: 'name: result' },
    { name: 'a checkout of head.sha', rule: 'AC-78', from: 'ref: ${{ github.event.pull_request.base.sha }}', to: 'ref: ${{ github.event.pull_request.head.sha }}' },
    { name: 'a checkout of github.head_ref', rule: 'AC-78', from: 'ref: ${{ github.event.pull_request.base.sha }}', to: 'ref: ${{ github.head_ref }}' },
    { name: 'a checkout of the merge ref', rule: 'AC-78', from: 'ref: ${{ github.event.pull_request.base.sha }}', to: 'ref: refs/pull/${{ github.event.pull_request.number }}/merge' },
    { name: 'a checkout with no ref (defaults to the merge commit)', rule: 'AC-78', from: '        with:\n          ref: ${{ github.event.pull_request.base.sha }}\n', to: '' },
  ];

  it.each(cases)('$rule: $name is caught', ({ rule, from, to }) => {
    const bad = mutate(good, from, to);
    expect(rules(checkWorkflow(bad, DEFAULT_EXPECTED))).toContain(rule);
  });

  it('AC-91: a fixture without the guard step fails the checker', () => {
    // Remove the guard step entirely, and drop the conditions that referenced it.
    const start = good.indexOf('      - name: Check the runner is installed on base');
    const end = good.indexOf('      - name: Setup Node.js');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const noGuard = good.slice(0, start) + good.slice(end);
    expect(rules(checkWorkflow(noGuard, DEFAULT_EXPECTED))).toContain('AC-91');
  });

  it('AC-91: a guard that exists but does not condition the runner and upload steps fails the checker', () => {
    let bad = mutate(good, "if: steps.guard.outputs.present == 'true'\n        uses: " + PIN.setupNode, 'uses: ' + PIN.setupNode);
    bad = mutate(bad, "if: steps.guard.outputs.present == 'true'\n        env:", 'env:');
    bad = mutate(bad, "if: always() && steps.guard.outputs.present == 'true'", 'if: always()');
    expect(rules(checkWorkflow(bad, DEFAULT_EXPECTED))).toContain('AC-91');
  });

  it('AC-91: a guard placed after the runner step fails the checker', () => {
    const gStart = good.indexOf('      - name: Check the runner is installed on base');
    const gEnd = good.indexOf('      - name: Setup Node.js');
    const guardBlock = good.slice(gStart, gEnd);
    const withoutGuard = good.slice(0, gStart) + good.slice(gEnd);
    const uploadAt = withoutGuard.indexOf('      - name: Upload review result artifact');
    const moved = withoutGuard.slice(0, uploadAt) + guardBlock + withoutGuard.slice(uploadAt);
    expect(rules(checkWorkflow(moved, DEFAULT_EXPECTED))).toContain('AC-91');
  });

  it('the checker rejects a mismatched expected post_as and expected types (the inputs are really compared)', () => {
    expect(rules(checkWorkflow(good, { postAs: 'none', types: ['opened', 'synchronize'] }))).toEqual(['AC-37']);
    expect(rules(checkWorkflow(good, { postAs: 'github_review', types: ['opened'] }))).toEqual(['AC-30']);
  });
});
