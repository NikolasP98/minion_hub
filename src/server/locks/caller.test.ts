import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  limit: vi.fn(async (_k: string, _n: number) => true),
  verifyKey: vi.fn(),
  touchKey: vi.fn(),
}));
vi.mock('$server/auth/shared-rate-limit', () => ({
  checkSharedRateLimit: (k: string, n: number) => m.limit(k, n),
}));
vi.mock('$server/services/org-api-keys.service', () => ({
  verifyKey: m.verifyKey,
  touchKey: m.touchKey,
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({ core: true }) }));

import { resolveLocksCaller } from './caller';

const KEY = `mk_0a0a0a0a_${'A'.repeat(43)}`;
const ev = (authorization: string | null) =>
  ({
    request: new Request('https://hub.test/api/hooks/record-locks', {
      method: 'POST',
      headers: authorization ? { authorization } : {},
    }),
  }) as never;
const key = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  orgId: 'org-1',
  name: 'Contador',
  lastUsedAt: null,
  scopes: ['locks'],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.limit.mockResolvedValue(true);
  m.verifyKey.mockResolvedValue(key());
});

describe('resolveLocksCaller', () => {
  it.each([null, 'Basic abc', 'Bearer mcp_at_x', 'Bearer nope'])(
    'no usable credential (%s) is 401 with its next step and never reaches the key lookup',
    async (auth) => {
      const res = (await resolveLocksCaller(ev(auth))) as Response;
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'unauthorized', next: expect.any(String) });
      expect(m.verifyKey).not.toHaveBeenCalled();
    },
  );

  it('an unknown, malformed or revoked key is 401', async () => {
    m.verifyKey.mockResolvedValue(null);
    expect(((await resolveLocksCaller(ev(`Bearer ${KEY}`))) as Response).status).toBe(401);
  });

  it('a key without the locks scope is 403 scope_required, before the limiter and before touch', async () => {
    m.verifyKey.mockResolvedValue(key({ scopes: ['sandbox'] }));
    const res = (await resolveLocksCaller(ev(`Bearer ${KEY}`))) as Response;
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'scope_required' });
    expect(m.limit).not.toHaveBeenCalled();
    expect(m.touchKey).not.toHaveBeenCalled();
  });

  it('over 60 calls a minute per key is 429 with retry-after', async () => {
    m.limit.mockResolvedValue(false);
    const res = (await resolveLocksCaller(ev(`Bearer ${KEY}`))) as Response;
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(m.limit).toHaveBeenCalledWith('locks-key:k1', 60);
  });

  it('a valid key returns the key organization (never a body one), its id and name, and is touched', async () => {
    const caller = await resolveLocksCaller(ev(`Bearer ${KEY}`));
    expect(caller).toEqual({
      ctx: { db: { core: true }, tenantId: 'org-1' },
      key: { id: 'k1', name: 'Contador' },
    });
    expect(m.touchKey).toHaveBeenCalledWith('k1');
  });

  it('a key used within the last minute is not touched again', async () => {
    m.verifyKey.mockResolvedValue(key({ lastUsedAt: new Date() }));
    await resolveLocksCaller(ev(`Bearer ${KEY}`));
    expect(m.touchKey).not.toHaveBeenCalled();
  });
});
