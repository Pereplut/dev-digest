#!/usr/bin/env node
/**
 * entry/stdio.ts — ring 4 (infra composition root). The primary transport:
 * "no port, no Origin/Host surface, and the specification's own guidance for
 * local servers is to use the stdio transport to limit access to just the
 * MCP client" (spec 0011). This and `entry/http.ts` are the only files that
 * choose a `DevDigestApi` implementation and hand it to `registry.ts`.
 *
 * stdio hazard: stdout is the JSON-RPC channel. Every diagnostic in this file
 * goes to stderr — never `console.log`.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildApi } from '../container.js';
import { createDevDigestServer } from '../registry.js';

function logStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

const api = buildApi();

const handle = serveStdio(() => createDevDigestServer(api), {
  onerror: (err) => logStderr(`devdigest-mcp: ${err.message}`),
});

// stdio hazard: release the keep-alive handle on close so the process can
// exit. `serveStdio` already exits naturally once stdin closes (the MCP
// stdio binding's own guidance), but a client-initiated shutdown signal
// should tear the connection down explicitly rather than let the process be
// killed mid-write.
async function shutdown(): Promise<void> {
  await handle.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
