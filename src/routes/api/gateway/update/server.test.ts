import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireAdmin = vi.fn();
vi.mock('$server/auth/authorize', () => ({
  requireAdmin: (locals: unknown) => mockRequireAdmin(locals),
}));

const mockGatewayCall = vi.fn<(method: string, params: unknown) => Promise<unknown>>();
vi.mock('$lib/server/gateway-rpc', () => ({
  gatewayCall: (method: string, params: unknown) => mockGatewayCall(method, params),
}));

const mockFleetAvailability = vi.fn();
vi.mock('$server/services/fleet-update.service', () => ({
  getFleetUpdateAvailability: (...args: unknown[]) => mockFleetAvailability(...args),
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
  mockFleetAvailability.mockResolvedValue(null);
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
    expect(await res.json()).toEqual({
      current: '1.0.0',
      pending: null,
      lastResult: null,
      updateSource: 'package',
      targetSource: 'package',
    });
  });

  it('returns fleet-aware image availability without the selected gateway npm status', async () => {
    mockFleetAvailability.mockResolvedValue({
      current: '2026.7.12-dev',
      pending: {
        version: 'sha256:new',
        source: 'external-image',
        detectedAt: '2026-07-13T00:00:00.000Z',
        artifact: { digest: 'sha256:new' },
      },
      updateSource: 'external-image',
      targetArtifact: { digest: 'sha256:new' },
    });
    const res = await GET(makeEvent());
    expect((await res.json()).updateSource).toBe('external-image');
    expect(mockGatewayCall).not.toHaveBeenCalled();
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

  it('action=check resolves fleet image availability first', async () => {
    mockFleetAvailability.mockResolvedValue({
      current: 'old',
      pending: null,
      updateSource: 'external-image',
      targetArtifact: { digest: 'sha256:current' },
    });
    const res = await POST(makeEvent({ action: 'check' }));
    expect((await res.json()).updateSource).toBe('external-image');
    expect(mockFleetAvailability).toHaveBeenCalledWith(true);
    expect(mockGatewayCall).not.toHaveBeenCalled();
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
