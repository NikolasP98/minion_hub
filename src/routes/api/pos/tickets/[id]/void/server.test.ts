import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  voidTicket: vi.fn(),
  PosError: class PosError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1', profileId: 'me' }),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(true),
}));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability: () => Promise.resolve() }));
vi.mock('$server/services/pos.service', () => ({
  voidTicket: (...args: unknown[]) => mocks.voidTicket(...args),
  PosError: mocks.PosError,
}));
import { POST } from './+server';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.voidTicket.mockResolvedValue({ id: 't1', status: 'void' });
});

function post(body: unknown) {
  return {
    locals: {},
    params: { id: 't1' },
    request: new Request('http://localhost/api/pos/tickets/t1/void', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/pos/tickets/:id/void', () => {
  it('passes the refund choice through to voidTicket', async () => {
    const res = await POST(post({ refund: 'credit' }));
    expect(res.status).toBe(200);
    expect(mocks.voidTicket.mock.calls[0]!.slice(1)).toEqual([
      't1',
      { id: 'me', name: null },
      { refund: 'credit' },
    ]);
  });

  it('an empty object leaves the refund to the service default (cash)', async () => {
    expect((await POST(post({}))).status).toBe(200);
    expect(mocks.voidTicket.mock.calls[0]![3]).toEqual({});
  });

  it('400s on an unknown refund kind', async () => {
    await expect(POST(post({ refund: 'cheque' }))).rejects.toMatchObject({ status: 400 });
    expect(mocks.voidTicket).not.toHaveBeenCalled();
  });

  it.each(['no_open_shift', 'no_party'])('maps %s to 409 {error, code}', async (code) => {
    mocks.voidTicket.mockRejectedValue(new mocks.PosError('refused', code));
    const res = await POST(post({ refund: 'cash' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'refused', code });
  });
});
