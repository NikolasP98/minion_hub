import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$server/supabase', () => ({
  supabaseServer: () => ({
    auth: {
      exchangeCodeForSession: async () => ({
        data: { session: { provider_refresh_token: null }, user: { id: 'u1' } },
        error: null,
      }),
    },
  }),
  supabaseAdmin: () => ({}),
}));
vi.mock('$server/auth/identity-sync', () => ({ syncGoogleLogin: vi.fn() }));
vi.mock('@minion-stack/db/pg', () => ({ sealSecret: vi.fn() }));

import { GET } from './+server';

const land = async (search: string, cookie: string | undefined) => {
  const deleted: string[] = [];
  try {
    await GET({
      url: new URL(`https://hub.test/auth/callback${search}`),
      cookies: { get: () => cookie, delete: (n: string) => deleted.push(n) },
    } as never);
  } catch (r) {
    return { location: (r as { location: string }).location, deleted };
  }
  throw new Error('no redirect');
};

beforeEach(() => vi.clearAllMocks());

describe('GET /auth/callback return path', () => {
  it('returns to the page kept by the login page, and forgets it', async () => {
    const path = '/oauth/authorize?client_id=mcpc_a&state=s';
    const r = await land('?code=c', path);
    expect(r.location).toBe(path);
    expect(r.deleted).toEqual(['login_next']);
  });

  it('falls back to next, then /home; never leaves the origin', async () => {
    expect((await land('?code=c&next=/pos', undefined)).location).toBe('/pos');
    expect((await land('?code=c', undefined)).location).toBe('/home');
    for (const evil of [
      '//evil.test',
      'https://evil.test',
      '/\\evil.test',
      '/\t/evil.test',
      '/\n/evil.test',
      '//evil.test/%2F',
    ])
      expect((await land('?code=c', evil)).location).toBe('/home');
    // The same values arriving as the `next` parameter (already percent-decoded by the URL parser).
    for (const next of ['/%09/evil.test', '/%5Cevil.test', '//evil.test', '/%2F%2Fevil.test'])
      expect((await land(`?code=c&next=${next}`, undefined)).location).toBe('/home');
  });

  it('keeps a normal approval path with its full query string', async () => {
    const path =
      '/oauth/authorize?client_id=mcpc_a&redirect_uri=http%3A%2F%2Flocalhost%3A1%2Fcb&state=a%2Fb';
    expect((await land('?code=c', path)).location).toBe(path);
    expect((await land(`?code=c&next=${encodeURIComponent(path)}`, undefined)).location).toBe(path);
  });
});
