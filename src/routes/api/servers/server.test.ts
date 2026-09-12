import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getTenant: vi.fn(),
  upsertServer: vi.fn(),
  safeUrl: vi.fn(),
  capture: vi.fn(),
  loadHosts: vi.fn(),
}));
vi.mock('$server/auth/authorize', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('$server/auth/tenant-ctx', () => ({ getOrCreateTenantCtx: mocks.getTenant }));
vi.mock('$server/services/server.service', () => ({ upsertServer: mocks.upsertServer }));
vi.mock('$server/services/hosts.service', () => ({ loadHostsForUser: mocks.loadHosts }));
vi.mock('$lib/server/posthog', () => ({
  captureServerEvent: mocks.capture,
}));
vi.mock('$server/services/ssrf-guard', () => ({
  assertSafeUrl: mocks.safeUrl,
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

import { POST, GET } from './+server';
import { SsrfBlockedError } from '$server/services/ssrf-guard';

const secret = 'synthetic-gateway-credential-DO-NOT-LOG';
const body = {
  name: 'Gateway',
  url: `wss://gateway.example.test/ws?token=${secret}`,
  token: secret,
};
const ctx = { db: {}, tenantId: 'org-1' };

function event() {
  return {
    route: { id: '/api/servers' },
    locals: { user: { id: 'user-1', email: 'person@example.test' } },
    request: new Request('https://hub.test/api/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockReturnValue({ id: 'user-1' });
  mocks.getTenant.mockResolvedValue(ctx);
  mocks.upsertServer.mockResolvedValue('server-1');
  mocks.safeUrl.mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

function recordedDiagnostics() {
  return JSON.stringify(
    [
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.error).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
      ...mocks.capture.mock.calls,
    ],
    (_key, value) =>
      value instanceof Error ? { message: value.message, stack: value.stack } : value,
  );
}

describe('POST /api/servers credential containment', () => {
  test('saves a host without logging its credential or credential-bearing URL', async () => {
    const response = await POST(event());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.safeUrl).toHaveBeenCalledWith(body.url, 'server URL');
    expect(mocks.upsertServer).toHaveBeenCalledWith(ctx, body, 'user-1');
    expect(recordedDiagnostics()).not.toContain(secret);
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'user:user-1',
        event: 'server_added',
        properties: expect.objectContaining({ route: '/api/servers' }),
      }),
    );
  });

  test('sanitizes persistence errors rather than logging or returning bound credential values', async () => {
    mocks.upsertServer.mockRejectedValue(new Error(`query failed with bound token ${secret}`));
    const response = await POST(event());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unable to save server.' });
    expect(recordedDiagnostics()).not.toContain(secret);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  test('preserves SSRF denial without echoing a sensitive URL from the error', async () => {
    mocks.safeUrl.mockRejectedValue(new SsrfBlockedError(`blocked URL: ${body.url}`));
    const response = await POST(event());
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Server URL is not allowed.',
    });
    expect(mocks.upsertServer).not.toHaveBeenCalled();
    expect(recordedDiagnostics()).not.toContain(secret);
  });

  test('requires authentication before parsing or persisting a host', async () => {
    mocks.requireAuth.mockImplementation(() => {
      throw new Error('Authentication required');
    });
    await expect(POST(event())).rejects.toThrow('Authentication required');
    expect(mocks.getTenant).not.toHaveBeenCalled();
    expect(mocks.safeUrl).not.toHaveBeenCalled();
    expect(mocks.upsertServer).not.toHaveBeenCalled();
    expect(recordedDiagnostics()).not.toContain('person@example.test');
  });
});

describe('GET /api/servers credential containment', () => {
  test('does not expose bound secrets in a load failure', async () => {
    mocks.loadHosts.mockRejectedValue(new Error(`database token ${secret}`));
    const response = await GET(event());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unable to load servers.' });
    expect(recordedDiagnostics()).not.toContain(secret);
  });
});
