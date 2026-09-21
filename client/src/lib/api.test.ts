/**
 * api.ts — the typed fetch client every hook is built on. These tests pin the
 * behaviour the error-UX taxonomy branches on: a network failure and an HTTP
 * failure must both arrive as ApiError, but with different status/code, and a
 * 204 must not be parsed. They also pin the conditional content-type header,
 * whose absence on a body-less POST is load-bearing against Fastify ("Body
 * cannot be empty when content-type is application/json") and would otherwise
 * regress invisibly.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { api, apiFetch, ApiError, API_BASE } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A minimal stand-in: apiFetch only touches ok/status/statusText/json. */
function response(opts: {
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
}): Response {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: opts.statusText ?? "",
    json: opts.json ?? (async () => ({})),
  } as unknown as Response;
}

/* The impl is declared with fetch's own signature, not `() => …`: vi.fn infers
   the mock's type from it, and a zero-arg impl would type mock.mock.calls as
   the empty tuple, so reading calls[n][0] is then a compile error. */
function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** The RequestInit apiFetch actually passed on call `n`. */
function initOf(mock: ReturnType<typeof stubFetch>, n = 0): RequestInit {
  return mock.mock.calls[n]![1] ?? {};
}

function headersOf(mock: ReturnType<typeof stubFetch>, n = 0): Record<string, string> {
  return (initOf(mock, n).headers ?? {}) as Record<string, string>;
}

/** The URL apiFetch actually requested on call `n`. */
function urlOf(mock: ReturnType<typeof stubFetch>, n = 0): string {
  return String(mock.mock.calls[n]![0]);
}

describe("apiFetch — success", () => {
  it("prefixes API_BASE and returns the parsed body", async () => {
    const mock = stubFetch(async () => response({ json: async () => ({ id: "repo-1" }) }));

    await expect(apiFetch<{ id: string }>("/repos")).resolves.toEqual({ id: "repo-1" });
    expect(urlOf(mock)).toBe(`${API_BASE}/repos`);
  });

  it("returns undefined for 204 without parsing a body", async () => {
    const json = vi.fn(async () => ({ never: "read" }));
    stubFetch(async () => response({ status: 204, json }));

    await expect(apiFetch("/runs/r1")).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });
});

describe("apiFetch — the conditional content-type header", () => {
  it("omits content-type when there is no body", async () => {
    const mock = stubFetch(async () => response({}));

    await apiFetch("/repos/r1/poll", { method: "POST" });
    expect(headersOf(mock)).not.toHaveProperty("content-type");
  });

  it("declares content-type when a body is sent", async () => {
    const mock = stubFetch(async () => response({}));

    await apiFetch("/repos", { method: "POST", body: JSON.stringify({ url: "u" }) });
    expect(headersOf(mock)["content-type"]).toBe("application/json");
  });

  it("lets caller headers through, and lets them win", async () => {
    const mock = stubFetch(async () => response({}));

    await apiFetch("/repos", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "text/plain", "x-trace": "abc" },
    });
    expect(headersOf(mock)).toEqual({ "content-type": "text/plain", "x-trace": "abc" });
  });
});

describe("apiFetch — failures arrive as ApiError", () => {
  it("a network failure becomes status 0 / network_error, naming the base URL", async () => {
    const cause = new Error("ECONNREFUSED");
    stubFetch(async () => {
      throw cause;
    });

    const err = await apiFetch("/repos").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(0);
    expect(apiErr.code).toBe("network_error");
    expect(apiErr.message).toContain(API_BASE);
    expect(apiErr.details).toBe(cause);
  });

  it("unpacks code, message and details from an error envelope", async () => {
    stubFetch(async () =>
      response({
        status: 409,
        statusText: "Conflict",
        json: async () => ({
          error: { code: "repo_exists", message: "That repo is already imported.", details: { id: "r1" } },
        }),
      }),
    );

    const err = (await apiFetch("/repos").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("repo_exists");
    expect(err.message).toBe("That repo is already imported.");
    expect(err.details).toEqual({ id: "r1" });
  });

  it("falls back to status + statusText when the error body is not JSON", async () => {
    stubFetch(async () =>
      response({
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }),
    );

    const err = (await apiFetch("/repos").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(500);
    expect(err.message).toBe("500 Internal Server Error");
    expect(err.code).toBeUndefined();
  });

  it("keeps the status line when the JSON body carries no error key", async () => {
    stubFetch(async () => response({ status: 404, statusText: "Not Found", json: async () => ({ ok: false }) }));

    const err = (await apiFetch("/repos/nope").catch((e: unknown) => e)) as ApiError;
    expect(err.message).toBe("404 Not Found");
    expect(err.code).toBeUndefined();
  });

  it("is a real Error subclass, so it survives instanceof and carries a name", () => {
    const err = new ApiError("boom", 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ApiError");
  });
});

describe("api verb helpers", () => {
  it("get issues no method and no body", async () => {
    const mock = stubFetch(async () => response({ json: async () => [] }));

    await api.get("/repos");
    expect(urlOf(mock)).toBe(`${API_BASE}/repos`);
    expect(initOf(mock).method).toBeUndefined();
    expect(initOf(mock).body).toBeUndefined();
  });

  it("post, put and patch serialize the body and set the method", async () => {
    const mock = stubFetch(async () => response({}));

    await api.post("/repos", { url: "u" });
    await api.put("/settings", { key: "v" });
    await api.patch("/agents/a1", { enabled: false });

    expect(initOf(mock, 0).method).toBe("POST");
    expect(initOf(mock, 0).body).toBe('{"url":"u"}');
    expect(initOf(mock, 1).method).toBe("PUT");
    expect(initOf(mock, 1).body).toBe('{"key":"v"}');
    expect(initOf(mock, 2).method).toBe("PATCH");
    expect(initOf(mock, 2).body).toBe('{"enabled":false}');
  });

  it("a body-less post sends no body and no content-type", async () => {
    const mock = stubFetch(async () => response({}));

    await api.post("/repos/r1/resync");
    expect(initOf(mock).method).toBe("POST");
    expect(initOf(mock).body).toBeUndefined();
    expect(headersOf(mock)).not.toHaveProperty("content-type");
  });

  it("del issues DELETE", async () => {
    const mock = stubFetch(async () => response({ status: 204 }));

    await expect(api.del("/runs/r1")).resolves.toBeUndefined();
    expect(initOf(mock).method).toBe("DELETE");
  });
});
