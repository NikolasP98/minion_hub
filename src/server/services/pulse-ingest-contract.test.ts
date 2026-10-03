import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  legacyOrgId,
  PULSE_PAYLOAD_MAX_BYTES,
  PULSE_REQUEST_MAX_BYTES,
  PulseIngestError,
  readPulseRequestObject,
  validatePulseProposals,
} from './pulse-ingest-contract';

const card = (overrides: Record<string, unknown> = {}) => ({
  source: 'calendar',
  kind: 'reminder',
  title: 'Upcoming visit',
  dedupKey: 'visit:1',
  ...overrides,
});

function request(body: BodyInit, headers?: HeadersInit): Request {
  return new Request('http://fixture.test/api/gateway/pulse/proposals', {
    method: 'POST',
    body,
    headers,
    ...(body instanceof ReadableStream ? { duplex: 'half' as const } : {}),
  } as RequestInit & { duplex?: 'half' });
}

describe('Pulse ingest request contract', () => {
  it('counts Unicode scalars and accepts the exact bounded card shape', () => {
    const proposals = validatePulseProposals({
      proposals: [
        card({
          source: '😀'.repeat(100),
          title: 'x'.repeat(500),
          summary: 'y'.repeat(4000),
          dedupKey: 'z'.repeat(250),
          payload: { z: 1, a: ['ok'] },
        }),
      ],
    });
    expect(proposals).toHaveLength(1);
    expect(canonicalJson(proposals[0]?.payload)).toBe('{"a":["ok"],"z":1}');
  });

  it.each([
    { proposals: [] },
    { proposals: Array.from({ length: 101 }, (_, i) => card({ dedupKey: String(i) })) },
    { proposals: [card({ source: '' })] },
    { proposals: [card({ kind: 'x'.repeat(101) })] },
    { proposals: [card({ title: 'x'.repeat(501) })] },
    { proposals: [card({ summary: 'x'.repeat(4001) })] },
    { proposals: [card({ dedupKey: 'x'.repeat(251) })] },
    { proposals: [card({ payload: [] })] },
    { proposals: [card(), { title: 'partial' }] },
  ])('rejects an invalid or partially valid batch atomically', (body) => {
    expect(() => validatePulseProposals(body)).toThrowError(
      expect.objectContaining({ code: 'invalid_proposals' }),
    );
  });

  it('uses canonical UTF-8 bytes for the per-card payload limit', () => {
    const largest = { data: 'a'.repeat(PULSE_PAYLOAD_MAX_BYTES - 11) };
    expect(new TextEncoder().encode(canonicalJson(largest))).toHaveLength(PULSE_PAYLOAD_MAX_BYTES);
    expect(() => validatePulseProposals({ proposals: [card({ payload: largest })] })).not.toThrow();
    expect(() =>
      validatePulseProposals({ proposals: [card({ payload: { data: `${largest.data}a` } })] }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_proposals' }));
  });

  it('reads an exact-size request even when Content-Length lies', async () => {
    const prefix =
      '{"proposals":[{"source":"s","kind":"k","title":"t","dedupKey":"d"}],"padding":"';
    const suffix = '"}';
    const json = `${prefix}${'x'.repeat(PULSE_REQUEST_MAX_BYTES - prefix.length - suffix.length)}${suffix}`;
    expect(new TextEncoder().encode(json)).toHaveLength(PULSE_REQUEST_MAX_BYTES);
    const parsed = await readPulseRequestObject(request(json, { 'content-length': '1' }));
    expect(validatePulseProposals(parsed)).toHaveLength(1);
  });

  it('stops a chunked body after the actual byte cap', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(PULSE_REQUEST_MAX_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    await expect(readPulseRequestObject(request(stream))).rejects.toMatchObject({
      code: 'body_too_large',
      status: 413,
    });
  });

  it.each(['', '{', '[]', 'null'])('rejects malformed or non-object JSON: %s', async (body) => {
    await expect(readPulseRequestObject(request(body))).rejects.toBeInstanceOf(PulseIngestError);
  });

  it('accepts no legacy organization or an exact bounded string', () => {
    expect(legacyOrgId({ proposals: [card()] })).toBeUndefined();
    expect(legacyOrgId({ orgId: 'org-a' })).toBe('org-a');
    expect(() => legacyOrgId({ orgId: 42 })).toThrowError(
      expect.objectContaining({ code: 'invalid_legacy_org' }),
    );
  });
});
