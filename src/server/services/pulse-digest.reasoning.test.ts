import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  digestFixturePolicy,
  digestFixtureSnapshot,
  digestFixtureResponse,
} from '../test-utils/pulse-digest-fixtures';
import {
  reasonDigest,
  parseDigestReceipt,
  validateDigestResult,
  reportedMicroUsd,
  type DigestTerminalReceipt,
} from './pulse-digest.reasoning';
import { validateOpenRouterDigestReceipt, assertOpenRouterDigestWireSupport } from '$server/llm';
let server: Server,
  origin: string,
  calls: Record<string, unknown>[],
  response: unknown,
  status: number;
beforeEach(async () => {
  process.env.OPENROUTER_API_KEY = 'local-fixture-no-paid-access';
  calls = [];
  status = 200;
  response = digestFixtureResponse(await digestFixtureSnapshot());
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    calls.push(JSON.parse(body));
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof response === 'string' ? response : JSON.stringify(response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture_bind');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  delete process.env.OPENROUTER_API_KEY;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const localTransport: typeof fetch = (input, init) => {
  const requested = new URL(String(input));
  if (
    requested.origin !== 'https://openrouter.ai' ||
    requested.pathname !== '/api/v1/chat/completions'
  )
    throw new Error('external_network_denied');
  return fetch(origin + requested.pathname, init);
};
describe('installed SDK digest wire and durable terminal envelopes', () => {
  it('serializes one chat request with token cap and disables tools retries and provider fallback', async () => {
    const receipts: DigestTerminalReceipt[] = [];
    const p = digestFixturePolicy(),
      s = await digestFixtureSnapshot(p);
    const result = await reasonDigest(
      p,
      s,
      {
        signal: AbortSignal.timeout(1000),
        onReceipt: async (r) => {
          receipts.push(r);
        },
      },
      localTransport,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: 'fixture/model',
      max_tokens: 1024,
      provider: { allow_fallbacks: false, require_parameters: true },
      usage: { include: true },
    });
    expect(calls[0]).not.toHaveProperty('tools');
    expect(calls[0]).not.toHaveProperty('models');
    expect(calls[0].stream).not.toBe(true);
    expect(receipts).toHaveLength(1);
    expect(result.sdkFailed).toBe(false);
    expect(receipts[0].costMicroUsd).toBe(100);
    expect(validateDigestResult(receipts[0], p, s).disposition).toBe('actionable');
  });
  it('retains authoritative usage before SDK parse and custom schema failures without recall', async () => {
    response = {
      model: 'fixture/model',
      usage: { cost: 0.0002 },
      malformed: 'SDK choices missing',
    };
    const receipts: DigestTerminalReceipt[] = [];
    const p = digestFixturePolicy(),
      s = await digestFixtureSnapshot(p);
    const result = await reasonDigest(
      p,
      s,
      {
        signal: AbortSignal.timeout(1000),
        onReceipt: async (r) => {
          receipts.push(r);
        },
      },
      localTransport,
    );
    expect(result.sdkFailed).toBe(true);
    expect(receipts[0].costMicroUsd).toBe(200);
    expect(calls).toHaveLength(1);
    expect(() => validateDigestResult(receipts[0], p, s)).toThrow();
  });
  it('accepts provider reported zero but never estimates unknown or negative cost', async () => {
    const p = digestFixturePolicy(),
      s = await digestFixtureSnapshot(p);
    for (const cost of [0, null]) {
      response = digestFixtureResponse(s, { cost });
      const result = await reasonDigest(
        p,
        s,
        { signal: AbortSignal.timeout(1000), onReceipt: async () => {} },
        localTransport,
      );
      expect(result.receipt.usageStatus).toBe(cost === 0 ? 'known' : 'unknown');
      expect(result.receipt.costMicroUsd).toBe(cost === 0 ? 0 : null);
    }
    expect(reportedMicroUsd(-1)).toBeNull();
    expect(reportedMicroUsd(0.0000001)).toBe(1);
    expect(reportedMicroUsd(Infinity)).toBeNull();
    expect(reportedMicroUsd(Number.MAX_SAFE_INTEGER)).toBeNull();
  });
  it('records model drift and nonexistent citations as invalid local validation', async () => {
    const p = digestFixturePolicy(),
      s = await digestFixtureSnapshot(p);
    response = digestFixtureResponse(s, { model: 'other/model' });
    const result = await reasonDigest(
      p,
      s,
      { signal: AbortSignal.timeout(1000), onReceipt: async () => {} },
      localTransport,
    );
    expect(result.receipt.usageStatus).toBe('known');
    expect(() => validateDigestResult(result.receipt, p, s)).toThrow('unqualified');
    const wire = digestFixtureResponse(s);
    const obj = JSON.parse(wire.choices[0].message.content);
    obj.citations[0].contentHash = '0'.repeat(64);
    wire.choices[0].message.content = JSON.stringify(obj);
    expect(() => validateDigestResult(parseDigestReceipt(JSON.stringify(wire), 200), p, s)).toThrow(
      'unknown_citation',
    );
    expect(calls).toHaveLength(1);
  });
  it('does not retry HTTP failure and bounds streaming response bytes', async () => {
    const p = digestFixturePolicy(),
      s = await digestFixtureSnapshot(p);
    status = 503;
    const first = await reasonDigest(
      p,
      s,
      { signal: AbortSignal.timeout(1000), onReceipt: async () => {} },
      localTransport,
    );
    expect(first.receipt.usageStatus).toBe('unknown');
    expect(calls).toHaveLength(1);
    status = 200;
    response = 'x'.repeat(65537);
    const result = await reasonDigest(
      p,
      s,
      { signal: AbortSignal.timeout(1000), onReceipt: async () => {} },
      localTransport,
    );
    expect(result.receipt.rawResponse).toBeNull();
    expect(result.receipt.usageStatus).toBe('unknown');
    expect(calls).toHaveLength(2);
  });
  it('persists late received facts even when signal is retired and rejects uncommitted receipts', async () => {
    const p = digestFixturePolicy(),
      s = await digestFixtureSnapshot(p);
    const abort = new AbortController();
    let retained = false;
    await reasonDigest(
      p,
      s,
      {
        signal: abort.signal,
        onReceipt: async () => {
          retained = true;
          abort.abort();
        },
      },
      localTransport,
    );
    expect(retained).toBe(true);
    expect(calls).toHaveLength(1);
    await expect(
      reasonDigest(
        p,
        s,
        {
          signal: AbortSignal.timeout(1000),
          onReceipt: async () => {
            throw new Error('receipt database down');
          },
        },
        localTransport,
      ),
    ).rejects.toThrow('receipt_persistence_failed');
    expect(calls).toHaveLength(2);
  });
  it('uses the installed SDK to validate received recovery locally with zero transport requests', async () => {
    const wire = digestFixtureResponse(await digestFixtureSnapshot());
    await validateOpenRouterDigestReceipt('fixture/model', JSON.stringify(wire), 200);
    expect(calls).toHaveLength(0);
    const malformed = { ...wire, choices: [{ ...wire.choices[0], index: 'invalid-sdk-index' }] };
    await expect(
      validateOpenRouterDigestReceipt('fixture/model', JSON.stringify(malformed), 200),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('denies unsupported model wire caps before any admitted or external attempt', async () => {
    await assertOpenRouterDigestWireSupport('fixture/model', 'fixture prompt');
    await expect(assertOpenRouterDigestWireSupport('o3', 'fixture prompt')).rejects.toThrow(
      'digest_unsupported_wire',
    );
    expect(calls).toHaveLength(0);
  });
});
