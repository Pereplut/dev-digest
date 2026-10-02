import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { getEncoding } from 'js-tiktoken';
import { describe, expect, it } from 'vitest';
import { MockDevDigestApi } from '../src/adapters/mocks.js';
import { createDevDigestServer } from '../src/registry.js';

/**
 * The acceptance criterion ("stay under a recorded token ceiling, asserted by a
 * test") needs a number tight enough to fail on a real regression.
 *
 * Measured: the five tools serialise to **1446** cl100k tokens on spec 0011.
 * Spec 0011's original 2.5-3.5k was an estimate made before the schemas
 * existed and was ~2.4x too high; a 4000 ceiling derived from it would have
 * let the definitions nearly triple without firing, which is the failure mode
 * of a ruleset that never fails.
 *
 * Re-measured for spec 0012, which replaced the `get_blast_radius` stub
 * (`isError: true`, one short line) with its real description and body:
 * **1668** cl100k tokens. `TOKEN_CEILING` is held at 2000 per spec 0012 §5
 * ("never nudge the ceiling to fit") — still ~20% headroom over the new
 * figure, enough to reword a description, not enough to absorb a sixth tool
 * or a re-introduced `outputSchema`.
 */
const TOKEN_CEILING = 2000;
const MEASURED_AT_WRITING = 1668;

describe('token budget — serialised tool definitions', () => {
  it('tools/list output stays under the recorded ceiling', async () => {
    const server = createDevDigestServer(new MockDevDigestApi());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'token-budget-test', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const { tools } = await client.listTools();
    const serialised = JSON.stringify(tools);
    const encoding = getEncoding('cl100k_base');
    const tokenCount = encoding.encode(serialised).length;

    // Surfaced so a change that moves the budget shows up as a number, not just
    // a boolean flipping.
    expect({ tokenCount, ceiling: TOKEN_CEILING }).toMatchObject({
      tokenCount: expect.any(Number),
    });
    expect(tokenCount).toBeLessThan(TOKEN_CEILING);
    // Guards the other direction too: a big DROP means tools or descriptions
    // went missing (a registry that silently registers fewer tools still
    // "passes" a ceiling-only assertion).
    expect(tokenCount).toBeGreaterThan(MEASURED_AT_WRITING * 0.75);

    await client.close();
    await server.close();
  });
});
