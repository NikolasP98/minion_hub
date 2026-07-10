import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireAdmin = vi.fn();
vi.mock('$server/auth/authorize', () => ({
  requireAdmin: (locals: unknown) => mockRequireAdmin(locals),
}));

const mockGatewayCall = vi.fn<(method: string, params: unknown) => Promise<unknown>>();
vi.mock('$lib/server/gateway-rpc', () => ({
  gatewayCall: (method: string, params: unknown) => mockGatewayCall(method, params),
}));

import { GET, POST } from './+server';

function makeEvent(body?: unknown, role: 'admin' | 'user' = 'admin') {
  return {
    locals: { user: { id: 'u1', role } },
    request: { json: async () => body } as Request,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockImplementation(() => ({ id: 'u1', role: 'admin' }));
});

describe('GET /api/gateway/update', () => {
  it('requires admin', async () => {
    mockRequireAdmin.mockImplementation(() => {
      throw { status: 403 };
    });
    await expect(GET(makeEvent())).rejects.toMatchObject({ status: 403 });
    expect(mockGatewayCall).not.toHaveBeenCalled();
  });

  it('proxies update.status', async () => {
    mockGatewayCall.mockResolvedValue({ current: '1.0.0', pending: null, lastResult: null });
    const res = await GET(makeEvent());
    expect(mockGatewayCall).toHaveBeenCalledWith('update.status', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ current: '1.0.0', pending: null, lastResult: null });
  });
});

describe('POST /api/gateway/update', () => {
  it('requires admin', async () => {
    mockRequireAdmin.mockImplementation(() => {
      throw { status: 403 };
    });
    await expect(POST(makeEvent({ action: 'check' }))).rejects.toMatchObject({ status: 403 });
    expect(mockGatewayCall).not.toHaveBeenCalled();
  });

  it('action=check proxies update.check', async () => {
    mockGatewayCall.mockResolvedValue({ ok: true });
    const res = await POST(makeEvent({ action: 'check' }));
    expect(mockGatewayCall).toHaveBeenCalledWith('update.check', {});
    expect(res.status).toBe(200);
  });

  it('action=run proxies update.run', async () => {
    mockGatewayCall.mockResolvedValue({ ok: true });
    const res = await POST(makeEvent({ action: 'run' }));
    expect(mockGatewayCall).toHaveBeenCalledWith('update.run', {});
    expect(res.status).toBe(200);
  });

  it('400 on missing/invalid action', async () => {
    await expect(POST(makeEvent({}))).rejects.toMatchObject({ status: 400 });
    await expect(POST(makeEvent({ action: 'bogus' }))).rejects.toMatchObject({ status: 400 });
    expect(mockGatewayCall).not.toHaveBeenCalled();
  });
});
