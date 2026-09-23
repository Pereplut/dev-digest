import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  PrIntentRecord,
  PrIntentResponse,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  PrMeta,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
    // Traces written before run cost was persisted have no stats.cost_usd.
    expect(trace.stats.cost_usd).toBeUndefined();
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });

  it('PrMeta list-only finding counts are optional and non-negative', () => {
    const base = {
      number: 482,
      title: 't',
      author: 'a',
      branch: 'b',
      base: 'main',
      head_sha: 'sha',
      additions: 1,
      deletions: 0,
      files_count: 1,
      status: 'reviewed',
    };
    expect(() => PrMeta.parse(base)).not.toThrow();
    const row = PrMeta.parse({
      ...base,
      findings_counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 2 },
      findings_run_id: 'run-1',
    });
    expect(row.findings_counts?.SUGGESTION).toBe(2);
    expect(() =>
      PrMeta.parse({ ...base, findings_counts: { CRITICAL: -1, WARNING: 0, SUGGESTION: 0 } }),
    ).toThrow();
  });

  /**
   * Spec 0008. `confidence` is a server-computed band, not a model number, so
   * the schema takes a closed enum and not a float — a 0..1 field here would
   * invite exactly the self-reported confidence decision D1 rules out.
   */
  it('PrIntentRecord parses a full record and rejects an unknown category', () => {
    const full = {
      pr_id: 'pr-1',
      intent: 'Add a readiness probe so orchestrators stop routing to a booting instance.',
      in_scope: ['server/src/app.ts'],
      out_of_scope: ['the client'],
      category: 'feature',
      confidence: 'high',
      rationale: 'The body links a spec that states the goal.',
      sources: [
        { kind: 'body', ref: 'pr#482', chars: 320, truncated: false, status: 'used' },
        { kind: 'spec', ref: 'specs/0007.md', chars: 4000, truncated: true, status: 'used' },
      ],
      evidence: [
        { source_kind: 'spec', ref: 'specs/0007.md', quote: 'readiness probe', valid: true },
      ],
      head_sha: 'abc123',
      model: 'gpt-4.1-mini',
      cost_usd: 0.0032,
      derived_at: '2026-09-23T12:00:00.000Z',
    };
    const parsed = PrIntentRecord.parse(full);
    expect(parsed.category).toBe('feature');
    expect(parsed.sources).toHaveLength(2);

    expect(() => PrIntentRecord.parse({ ...full, category: 'rewrite' })).toThrow();
    expect(() => PrIntentRecord.parse({ ...full, confidence: 0.9 })).toThrow();
  });

  /** An unreadable linked spec must survive to the UI, not be dropped. */
  it('IntentSource carries an unreadable spec, and the response allows null', () => {
    const record = PrIntentRecord.parse({
      pr_id: 'pr-2',
      intent: 'Unclear from the description.',
      in_scope: [],
      out_of_scope: [],
      category: 'unknown',
      confidence: 'low',
      sources: [{ kind: 'spec', ref: 'docs/plan.md', chars: 0, truncated: false, status: 'unreadable' }],
      evidence: [],
      derived_at: '2026-09-23T12:00:00.000Z',
    });
    expect(record.sources[0]?.status).toBe('unreadable');
    expect(record.rationale ?? null).toBeNull();

    expect(PrIntentResponse.parse({ intent: null }).intent).toBeNull();
    expect(PrIntentResponse.parse({ intent: record }).intent?.category).toBe('unknown');
  });
});
