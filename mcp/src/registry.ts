/**
 * registry.ts — ring 4 (infra). The ONLY place, together with `entry/*`, that
 * imports the MCP SDK: tool names, descriptions, annotations and Zod-4 input
 * schemas are all declared here, and this is where a plain-data result from
 * rings 1-3 is wrapped into `{ content, isError }` — exactly once, per spec
 * 0011's "a service never imports a vendor SDK" rule.
 *
 * Registration order is fixed and never conditional, which is what makes
 * `tools/list` ordering deterministic across calls/processes (acceptance
 * criterion 1; the MCP spec's own recommendation for prompt-cache hit rates).
 *
 * `list_review_agents`, `get_repo_conventions` and `get_blast_radius` have no
 * dedicated ring-3 module: they call the port directly and pass the result
 * through a ring-1 projection, because a service that only forwards is a
 * Middle Man (spec 0011 "No Middle Man").
 */
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { DevDigestApi } from './ports.js';
import {
  projectAgents,
  projectBlast,
  projectConventions,
  projectFindings,
  resolveRepoSlug,
} from './core/project.js';
import {
  apiErrorText,
  apiUnreachableText,
  blastPullRequestUnknownText,
  bothRunIdAndRepoText,
  repositoryUnknownText,
  runStillExecutingText,
} from './core/errors.js';
import { runReview } from './tools/run-review.js';
import { getFindings } from './tools/findings.js';
import { ApiRequestError, ApiUnreachableError } from './adapters/http/client.js';

// ---- Server-level `instructions` — use verbatim (spec 0011) ----------------

const INSTRUCTIONS = `DevDigest is a local-first AI pull-request reviewer. Reviews are asynchronous.

Ordering: \`review_pull_request\` returns a \`run_id\` and finishes in the background. Read results with \`get_findings\` using that \`run_id\`. Do not call \`review_pull_request\` twice for the same pull request while a run is in flight — poll \`get_findings\` instead.

Identity: every tool takes a repository slug (\`owner/name\`) and a GitHub pull request number. Internal ids are never required, except the \`run_id\` and \`agent\` id that these tools hand you.

Cost: \`review_pull_request\` spends money on LLM calls and is limited to 10 calls per minute. Every other tool is read-only and cheap.

Severities are \`CRITICAL\`, \`WARNING\`, \`SUGGESTION\`. A \`CRITICAL\` finding is what blocks a pull request.`;

// ---- Shared enums (plain literal lists — never import the server's Zod-3
// contracts; this package is Zod 4) --------------------------------------

const SEVERITY = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;
const CATEGORY = ['bug', 'security', 'perf', 'style', 'test'] as const;
const CONVENTION_CATEGORY = [
  'naming',
  'structure',
  'error-handling',
  'async',
  'testing',
  'api',
  'data',
  'style',
] as const;
const CONVENTION_STATUS = ['pending', 'accepted', 'rejected'] as const;
const RESPONSE_FORMAT = ['concise', 'detailed'] as const;

/**
 * A repeatable enum parameter that also accepts a bare scalar, normalising to
 * an array. This mirrors `RunFindingsQuery` on the API side
 * (`server/src/vendor/shared/contracts/findings.ts`), which takes the same
 * `z.union([Scalar, z.array(Scalar)])` shape — so the tool is no stricter than
 * the route it wraps.
 *
 * The scalar arm is not cosmetic: `severity: "CRITICAL"` is the natural way to
 * write a single filter, and an array-only schema turns it into a hard
 * validation error and a wasted turn. It also matches what the stub's own error
 * text shows (`severity: ["CRITICAL"]`) without punishing the shorter spelling.
 */
function oneOrMany<T extends z.ZodType>(inner: T) {
  return z.union([inner, z.array(inner)]).transform((v) => (Array.isArray(v) ? v : [v]));
}

// ---- content-block helpers ---------------------------------------------------

function okJson(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorText(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** Every handler's outermost boundary: a port call that fails to reach the
 * API, or that the API answered with a non-2xx, becomes `isError: true` text
 * — never an uncaught throw (which the SDK would answer as a protocol-level
 * error, reserved for malformed requests and unknown tools, not this). */
async function withApiErrors(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiUnreachableError) return errorText(apiUnreachableText(err.url));
    if (err instanceof ApiRequestError) {
      return errorText(apiErrorText(err.status, err.body, err.message));
    }
    return errorText(err instanceof Error ? err.message : String(err));
  }
}

// ---- Tool schemas — parameter `.describe()` text is verbatim (spec 0011) ---

const ListReviewAgentsInput = z
  .object({
    response_format: z
      .enum(RESPONSE_FORMAT)
      .default('concise')
      .describe('concise: id, name, model, enabled. detailed adds description, strategy, ci_fail_on, skill_count.'),
  })
  .strict();

const ReviewPullRequestInput = z
  .object({
    repo: z.string().describe('Repository slug as `owner/name`, e.g. `acme/web`.'),
    pull_number: z.number().int().positive().describe('The pull request number as shown on GitHub, not an internal id.'),
    agent: z.string().optional().describe('Agent id from `list_review_agents`. Omit to run every enabled agent.'),
  })
  .strict()
  // One of the two tools with an optional parameter to demonstrate (spec
  // 0011 "input_examples appear only on the two tools with an optional
  // parameter to demonstrate"): shows the common case of omitting `agent`.
  .meta({ examples: [{ repo: 'acme/web', pull_number: 42 }] });

const GetFindingsInput = z
  .object({
    // `.uuid()` is not extra strictness: the wrapped route validates the same
    // id as `z.string().uuid()` (server `_shared/schemas.ts` `IdParams`), so the
    // tool is exactly as strict as the endpoint — the bar mcp/INSIGHTS.md
    // (2026-09-27, "array-only enum param") sets. Unconstrained, this string
    // reached the URL path directly and could re-address the request.
    run_id: z
      .uuid()
      .optional()
      .describe('Run id from `review_pull_request`. Use this OR repo+pull_number, not both.')
      // Field-level, not on the object. The SDK converts via
      // `schema['~standard'].jsonSchema.input()` (zod >= 4.2; `z.toJSONSchema`
      // is only a warned fallback), and that conversion SILENTLY DROPS
      // `examples` from every object with a transform anywhere below it —
      // `oneOrMany` is one. So the object-level `.meta({examples})` this tool
      // used to carry never reached a client. Only `examples` is affected:
      // `title` and `description` survive. `.describe()` before `.meta()` keeps
      // both here. An example on the `oneOrMany` field itself would vanish too,
      // so the scalar-or-array spelling can only be shown in `.describe()` text.
      .meta({ examples: ['9e865e64-2f1b-4c3a-a0d7-1e0670f4b8c2'] }),
    repo: z.string().optional().describe('Repository slug as `owner/name`, e.g. `acme/web`.'),
    // Deliberately undescribed — the name carries it (spec 0011).
    pull_number: z.number().int().positive().optional(),
    severity: oneOrMany(z.enum(SEVERITY)).optional().describe('Keep only these severities. Omit for all.'),
    category: oneOrMany(z.enum(CATEGORY)).optional(),
    limit: z.number().int().positive().max(200).default(20),
    cursor: z.string().optional().describe('Opaque `next_cursor` from a previous response.'),
    response_format: z
      .enum(RESPONSE_FORMAT)
      .default('concise')
      .describe('concise: file, line, severity, title. detailed adds rationale and suggestion.'),
  })
  .strict();
// No object-level `.meta({examples})` here, deliberately: this schema contains a
// transform (`oneOrMany`), and the conversion drops an object's `examples` when
// a transform sits anywhere below it — so the examples this tool appeared to
// advertise were never published. Nesting the transform deeper would not help
// (every ancestor loses them) and `{io:'output'}` would erase the enum from
// every transform field. The run_id-vs-repo+pull_number choice lives in the
// tool description; the concrete uuid shape is the field-level example above.

const GetRepoConventionsInput = z
  .object({
    repo: z.string().describe('Repository slug as `owner/name`, e.g. `acme/web`.'),
    status: oneOrMany(z.enum(CONVENTION_STATUS))
      .default(['accepted'])
      .describe('Which candidates to include. Defaults to accepted rules only.'),
    // Deliberately undescribed — the name carries it (spec 0011).
    category: z.enum(CONVENTION_CATEGORY).optional(),
    response_format: z
      .enum(RESPONSE_FORMAT)
      .default('concise')
      .describe('concise: category, rule, evidence path. detailed adds the evidence snippet.'),
  })
  .strict();

const GetBlastRadiusInput = z
  .object({
    repo: z.string().describe('Repository slug as `owner/name`, e.g. `acme/web`.'),
    // Deliberately undescribed — the name carries it (spec 0011).
    pull_number: z.number().int().positive(),
  })
  .strict();

// ---- Shared annotations ------------------------------------------------------
// All four fields are set explicitly on every tool: the protocol defaults are
// the pessimistic ones (readOnlyHint=false, destructiveHint=true,
// idempotentHint=false), so an unset read tool reads as destructive and
// non-idempotent (spec 0011).

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Builds and registers the five DevDigest tools against one `DevDigestApi`.
 * Both `entry/stdio.ts` and `entry/http.ts` call this per server instance —
 * it is the composition boundary the MCP SDK sits behind.
 */
export function createDevDigestServer(api: DevDigestApi): McpServer {
  const server = new McpServer({ name: 'devdigest', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'list_review_agents',
    {
      description:
        'List the review agents configured in this DevDigest workspace, with the model and provider each one uses. Call this before `review_pull_request` when the user names a reviewer by description rather than by id — the `id` returned here is what that tool expects. Disabled agents are included and marked as such, because a disabled agent cannot be run but is still worth reporting. This is cheap and read-only, so prefer calling it over guessing an agent id.',
      inputSchema: ListReviewAgentsInput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      withApiErrors(async () => {
        const agents = await api.listAgents();
        return okJson({ agents: projectAgents(agents, input.response_format) });
      }),
  );

  server.registerTool(
    'review_pull_request',
    {
      description:
        "Start a review of one pull request with one or more of the configured review agents. This is asynchronous: it returns a `run_id` per agent immediately and the review continues in the background, so follow it with `get_findings` using that `run_id` rather than expecting findings in this response. Identify the pull request by repository slug and PR number as shown on GitHub, not by an internal id. Rate-limited to 10 calls per minute, and each run spends money on LLM calls — do not retry a call that already returned run ids.",
      inputSchema: ReviewPullRequestInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) =>
      withApiErrors(async () => {
        const result = await runReview(api, {
          repo: input.repo,
          pullNumber: input.pull_number,
          ...(input.agent ? { agentId: input.agent } : {}),
        });
        if (result.kind === 'error') return errorText(result.text);
        return okJson({
          runs: result.runs.map((r) => ({ run_id: r.runId, agent_id: r.agentId, agent_name: r.agentName })),
        });
      }),
  );

  server.registerTool(
    'get_findings',
    {
      description:
        "Get the findings a review produced — the issues, risks and suggestions it raised — for one run or for a whole pull request. Pass the `run_id` returned by `review_pull_request` to read just that agent's result, or pass `repo` and `pull_number` to read the latest findings from every agent. While a run is still executing this returns its status and no findings, so poll it rather than starting the review again. It defaults to a concise projection and the 20 highest-severity findings; raise `limit` or ask for `detailed` only when you need the rationale and suggested fix, because full findings are large.",
      inputSchema: GetFindingsInput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      withApiErrors(async () => {
        if (input.run_id && input.repo) return errorText(bothRunIdAndRepoText());
        if (!input.run_id && !input.repo) {
          return errorText('Pass either run_id or repo and pull_number.');
        }
        if (input.repo && input.pull_number === undefined) {
          return errorText('pull_number is required when repo is given.');
        }

        const common = {
          ...(input.severity ? { severity: input.severity } : {}),
          ...(input.category ? { category: input.category } : {}),
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
        };
        const result = await getFindings(
          api,
          input.run_id
            ? { by: 'run', runId: input.run_id, ...common }
            : { by: 'pull', repo: input.repo!, pullNumber: input.pull_number!, ...common },
        );

        if (result.kind === 'error') return errorText(result.text);
        if (result.kind === 'still-running') return errorText(runStillExecutingText(result.info));
        return okJson({
          findings: projectFindings(result.findings, input.response_format),
          next_cursor: result.nextCursor,
          ...(result.status ? { run_status: result.status } : {}),
          ...(result.grounding ? { grounding: result.grounding } : {}),
        });
      }),
  );

  server.registerTool(
    'get_repo_conventions',
    {
      description:
        "Get the coding conventions DevDigest extracted from a repository — the rules it holds new code to, each with the file and line range that evidences it. Returns only accepted conventions by default, because pending and rejected candidates are review artefacts rather than rules. Use it to learn a repository's house style before writing code in it, or to explain why a review finding was raised. If the repository has never been scanned this returns an empty rule set together with the scan status, not an error.",
      inputSchema: GetRepoConventionsInput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      withApiErrors(async () => {
        const repos = await api.listRepos();
        const resolution = resolveRepoSlug(repos, input.repo);
        if (!resolution.ok) return errorText(repositoryUnknownText(input.repo, resolution.closest));
        const page = await api.getConventions(resolution.repo.id, {
          status: input.status,
          ...(input.category ? { category: input.category } : {}),
        });
        return okJson(projectConventions(page, input.response_format));
      }),
  );

  server.registerTool(
    'get_blast_radius',
    {
      description:
        'Get the blast radius of a pull request — which symbols it changes, which callers reach them, and which HTTP endpoints and cron jobs sit behind those callers. Identify the pull request by repository slug and PR number as shown on GitHub, not by an internal id. This reads a code index DevDigest built when it cloned the repository: it is read-only, cheap, and calls no model, so prefer it over reading the diff yourself to guess what a change affects. An empty `downstream` means no caller outside the changed files resolved — not that the change is safe; a `degraded` flag with its `reason` means the index is missing or partial, so the map under-reports rather than being complete.',
      inputSchema: GetBlastRadiusInput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      withApiErrors(async () => {
        const repos = await api.listRepos();
        const resolution = resolveRepoSlug(repos, input.repo);
        if (!resolution.ok) return errorText(repositoryUnknownText(input.repo, resolution.closest));
        const pull = await api.getPullByNumber(resolution.repo.id, input.pull_number);
        if (!pull) return errorText(blastPullRequestUnknownText(input.pull_number, resolution.repo.fullName));
        const result = await api.getBlastRadius(pull.id);
        return okJson(projectBlast(result));
      }),
  );

  return server;
}
