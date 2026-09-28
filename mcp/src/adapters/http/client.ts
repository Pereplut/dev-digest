/**
 * adapters/http/client.ts — ring 4 (infra). The ONLY file that knows the
 * DevDigest API's base URL or calls `fetch`, modelled on `client/src/lib/api.ts`
 * (`apiFetch`) — the same "one file owns the base URL" shape, adapted to a
 * plain fetch wrapper instead of a React app's error taxonomy.
 *
 * The MCP process never builds a `Container` and never calls `buildApp()`:
 * `server/src/app.ts` reaps stale runs on boot on a single-API-instance
 * assumption, and `ReviewService.runReview` fires review execution and SSE
 * events in its own process — a second process here would race the API's
 * live runs and the studio UI would never see this process's events (spec
 * 0011 "Data access: HTTP adapter, never a second Container").
 */

export const DEFAULT_API_BASE = 'http://localhost:3001';

/** Thrown when the DevDigest API cannot be reached at all (network failure,
 * API not running) — maps to the verbatim "API unreachable" error text. */
export class ApiUnreachableError extends Error {
  constructor(public readonly url: string, cause: unknown) {
    super(`Cannot reach the DevDigest API at ${url}`);
    this.cause = cause;
  }
}

/** The API's own structured error envelope (`@devdigest/shared`'s
 * `ApiErrorBody`, hand-typed here — rings 1-4 in mcp/ never import server
 * contracts, only the plain shapes they need). */
export interface ApiErrorLike {
  error: { code: string; message: string; details?: unknown };
}

/** Thrown for a non-2xx response the API answered (as opposed to not
 * answering at all). */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorLike | null,
  ) {
    super(body?.error.message ?? `DevDigest API returned ${status}`);
  }
}

export interface HttpClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Thin JSON fetch wrapper. `get`/`post` are the only two verbs any adapter
 * method here needs. */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (cause) {
      throw new ApiUnreachableError(this.baseUrl, cause);
    }

    if (!res.ok) {
      let body: ApiErrorLike | null = null;
      try {
        body = (await res.json()) as ApiErrorLike;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiRequestError(res.status, body);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
