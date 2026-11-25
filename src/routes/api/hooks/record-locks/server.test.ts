import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ caller: vi.fn(), apply: vi.fn() }));
vi.mock('$server/locks/caller', async (orig) => {
  const real = await orig<typeof import('$server/locks/caller')>();
  return { ...real, resolveLocksCaller: m.caller };
});
vi.mock('$server/services/record-locks.service', () => ({ applyExternalLock: m.apply }));

import { HookError } from '$server/services/record-locks.logic';
import { POST } from './+server';

const ctx = { db: {}, tenantId: 'org-1' };
const key = { id: 'k1', name: 'Contador' };
const post = (body: string) =>
  POST({
    request: new Request('https://hub.test/api/hooks/record-locks', { method: 'POST', body }),
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  m.caller.mockResolvedValue({ ctx, key });
});

describe('POST /api/hooks/record-locks', () => {
  it('locks by date: the service gets the key org, key and the parsed body', async () => {
    const out = {
      action: 'lock',
      created: 1,
      existing: 0,
      unknown: [],
      locks: [{ id: 'l1', label: 'Contabilidad', upTo: '2026-10-31' }],
    };
    m.apply.mockResolvedValue(out);
    const res = await post(
      JSON.stringify({ action: 'lock', label: 'Contabilidad', upTo: '2026-10-31' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(out);
    expect(m.apply).toHaveBeenCalledWith(ctx, key, {
      action: 'lock',
      label: 'Contabilidad',
      recordType: null,
      upTo: '2026-10-31',
      ids: null,
    });
  });

  it('locks by ids and lifts, lowercasing and de-duplicating ids', async () => {
    const id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    m.apply.mockResolvedValue({ action: 'lift', lifted: 1 });
    const res = await post(
      JSON.stringify({ action: 'lift', recordType: 'stock_receipt', ids: [id, id.toLowerCase()] }),
    );
    expect(await res.json()).toEqual({ action: 'lift', lifted: 1 });
    expect(m.apply.mock.calls[0]![2]).toMatchObject({ ids: [id.toLowerCase()], label: null });
  });

  it('a caller refusal (401, 403, 429) is returned as is and nothing runs', async () => {
    m.caller.mockResolvedValue(new Response('{"code":"scope_required"}', { status: 403 }));
    const res = await post('{}');
    expect(res.status).toBe(403);
    expect(m.apply).not.toHaveBeenCalled();
  });

  it.each([
    ['not json'],
    ['[]'],
    [JSON.stringify({ action: 'nuke', label: 'x', upTo: '2026-10-31' })],
    [JSON.stringify({ action: 'lock', label: 'x' })],
    [JSON.stringify({ action: 'lock', label: 'x', upTo: '2026-10-31', ids: [] })],
    [JSON.stringify({ action: 'lock', label: '', upTo: '2026-10-31' })],
    [JSON.stringify({ action: 'lock', label: 'x'.repeat(61), upTo: '2026-10-31' })],
    [JSON.stringify({ action: 'lock', label: 'x', upTo: '2026-02-30' })],
    [JSON.stringify({ action: 'lock', label: 'x', ids: ['a'], recordType: 'stock_receipt' })],
    [JSON.stringify({ action: 'lock', label: 'x', ids: ['0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c'] })],
    [JSON.stringify({ action: 'lock', label: 'x', upTo: '2026-10-31', orgId: 'other' })],
    [JSON.stringify({ action: 'lift', upTo: '2026-10-31' })],
  ])('a bad body is 400 invalid_request with its next step: %s', async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_request', next: expect.any(String) });
    expect(m.apply).not.toHaveBeenCalled();
  });

  it('more than 200 ids is 400', async () => {
    const ids = Array.from(
      { length: 201 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const res = await post(
      JSON.stringify({ action: 'lock', label: 'x', recordType: 'stock_receipt', ids }),
    );
    expect(res.status).toBe(400);
  });

  it('the rule being off is 409 webhook_rule_off with the next step', async () => {
    m.apply.mockRejectedValue(new HookError('webhook_rule_off'));
    const res = await post(JSON.stringify({ action: 'lock', label: 'x', upTo: '2026-10-31' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'webhook_rule_off',
      next: expect.stringContaining('Por webhook'),
    });
  });

  it('an unexpected failure is not swallowed', async () => {
    m.apply.mockRejectedValue(new Error('db down'));
    await expect(
      post(JSON.stringify({ action: 'lock', label: 'x', upTo: '2026-10-31' })),
    ).rejects.toThrow('db down');
  });
});
