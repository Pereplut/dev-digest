/**
 * container.ts — ring 4 (infra composition root). Builds the single
 * `DevDigestApi` implementation both entries (`entry/stdio.ts`,
 * `entry/http.ts`) hand to `registry.ts`. Real requests go through
 * `HttpDevDigestApi`; `DEVDIGEST_MCP_MOCK=1` swaps in `MockDevDigestApi` for a
 * dependency-free smoke test (e.g. the MCP Inspector `tools/list` check).
 */
import type { DevDigestApi } from './ports.js';
import { HttpDevDigestApi } from './adapters/http/index.js';
import { MockDevDigestApi } from './adapters/mocks.js';
import { DEFAULT_API_BASE } from './adapters/http/client.js';

export function buildApi(env: NodeJS.ProcessEnv = process.env): DevDigestApi {
  if (env.DEVDIGEST_MCP_MOCK === '1') {
    return new MockDevDigestApi();
  }
  const baseUrl = env.DEVDIGEST_API_BASE ?? DEFAULT_API_BASE;
  return new HttpDevDigestApi({ baseUrl });
}
