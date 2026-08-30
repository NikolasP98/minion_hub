import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, resolveSupabaseUser } = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveSupabaseUser: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$server/supabase', () => ({
  supabaseServer: () => ({ auth: { getSession } }),
  supabaseAdmin: vi.fn(),
}));
vi.mock('$server/auth/supabase-bridge.runtime', () => ({
  resolveSupabaseUser,
  resolveSupabaseTenant: vi.fn(),
}));
vi.mock('$server/db/client', () => ({ getDb: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: vi.fn() }));
vi.mock('$server/auth/crypto', () => ({ decryptToken: vi.fn() }));
vi.mock('$server/auth/tenant', () => ({ resolveUserTenant: vi.fn() }));
vi.mock('$server/auth/identity-cache', () => ({
  getCachedIdentity: vi.fn(),
  setCachedIdentity: vi.fn(),
}));
vi.mock('@minion-stack/db/schema', () => ({ servers: {} }));
vi.mock('@minion-stack/db/pg', () => ({ gateway: {} }));

import { resolveIdentity } from './resolve-identity';

function eventWithCookies() {
  const deleted: Array<{ name: string; path: string | undefined }> = [];
  return {
    event: {
      url: new URL('https://hub.minion-ai.org/en/home'),
      request: new Request('https://hub.minion-ai.org/en/home'),
      cookies: {
        get: vi.fn(),
        getAll: () => [
          { name: 'sb-project-auth-token.0', value: 'stale' },
          { name: 'sb-project-auth-token.1', value: 'session' },
          { name: 'paraglide_lang', value: 'en' },
        ],
        delete: (name: string, options: { path?: string }) =>
          deleted.push({ name, path: options.path }),
      },
    },
    deleted,
  };
}

describe('Supabase browser-session recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('degrades a rejected refresh request to anonymous and expires the stale chunks', async () => {
    getSession.mockRejectedValueOnce(new Error('rejected refresh token'));
    const { event, deleted } = eventWithCookies();

    await expect(resolveIdentity(event as never)).resolves.toEqual({
      locals: {},
      bypassGate: false,
    });
    expect(deleted).toEqual([
      { name: 'sb-project-auth-token.0', path: '/' },
      { name: 'sb-project-auth-token.1', path: '/' },
    ]);
  });

  it('expires a locally present session when claims verification rejects it', async () => {
    getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'expired.jwt' } },
      error: null,
    });
    resolveSupabaseUser.mockResolvedValueOnce(null);
    const { event, deleted } = eventWithCookies();

    await expect(resolveIdentity(event as never)).resolves.toEqual({
      locals: {},
      bypassGate: false,
    });
    expect(resolveSupabaseUser).toHaveBeenCalledWith(event, expect.any(Object), 'expired.jwt');
    expect(deleted).toHaveLength(2);
  });
});
