#!/usr/bin/env node
/**
 * entry/http.ts — ring 4 (infra composition root). The optional Streamable
 * HTTP transport, mounting `createMcpHandler`'s web-standard handler onto
 * `@modelcontextprotocol/fastify`'s `createMcpFastifyApp()` via
 * `toNodeHandler` from `@modelcontextprotocol/node`. Same registry, same
 * `DevDigestApi`, as `entry/stdio.ts` — the two entries are the only places
 * that choose a port implementation.
 *
 * Three mounting hazards this file exists to get right (spec 0011), each of
 * which fails SILENTLY if skipped:
 *
 * 1. Fastify has already parsed the body — pass it as the THIRD argument to
 *    `toNodeHandler`'s returned handler, or it tries to read an
 *    already-consumed stream.
 * 2. Auth reaches the handler through the raw request
 *    (`Object.assign(req.raw, { auth })`), surfacing as `ctx.http.authInfo`.
 *    This server has no auth (authentication is a non-goal — spec 0011), so
 *    `auth` is always `undefined`; the assignment is still made so the shape
 *    matches what a future auth layer would set.
 * 3. `createMcpFastifyApp()` arms DNS-rebinding protection automatically for
 *    a localhost-class bind, but the hook is composed explicitly here too —
 *    "the bare handler trusts its caller entirely" once anything is mounted
 *    on top of it, so this stays correct if `host` ever changes.
 */
import { createMcpFastifyApp, hostHeaderValidation } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { buildApi } from '../container.js';
import { createDevDigestServer } from '../registry.js';

const api = buildApi();
const mcpHandler = createMcpHandler(() => createDevDigestServer(api));
const nodeHandler = toNodeHandler(mcpHandler, {
  onerror: (err) => process.stderr.write(`devdigest-mcp (http): ${err.message}\n`),
});

const app = createMcpFastifyApp();

// Mounting hazard 3 — see module docstring.
app.addHook('onRequest', hostHeaderValidation(['localhost', '127.0.0.1', '[::1]']));

app.route({
  method: ['GET', 'POST', 'DELETE'],
  url: '/mcp',
  handler: async (req, reply) => {
    // Mounting hazard 2 — see module docstring.
    Object.assign(req.raw, { auth: undefined });
    // Mounting hazard 1 — Fastify's body parser has already run; `req.body`
    // is the parsed value, passed as the third argument.
    await nodeHandler(req.raw, reply.raw, req.body);
  },
});

const port = Number(process.env.PORT ?? 3100);

app.listen({ port, host: '127.0.0.1' }, (err) => {
  if (err) {
    process.stderr.write(`devdigest-mcp (http): ${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`devdigest-mcp (http): listening on http://127.0.0.1:${port}/mcp\n`);
});

async function shutdown(): Promise<void> {
  await mcpHandler.close();
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
