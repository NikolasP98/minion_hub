import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ getClient: vi.fn(), createCode: vi.fn(), memberships: vi.fn() }));
vi.mock('$server/config/urls', () => ({ hubBaseUrl: () => 'https://hub.test/' }));
vi.mock('$server/mcp/oauth.service', () => ({ getClient: m.getClient, createCode: m.createCode }));
vi.mock('$server/services/canonical-directory.service', () => ({
  loadCanonicalMemberships: m.memberships,
}));

import { actions, load } from './+page.server';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const base = {
  client_id: 'mcpc_a',
  redirect_uri: 'http://localhost:3118/callback',
  response_type: 'code',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  state: 'st8',
};
const urlOf = (over: Record<string, string | undefined> = {}) => {
  const u = new URL('https://hub.test/oauth/authorize');
  for (const [k, v] of Object.entries({ ...base, ...over }))
    if (v !== undefined) u.searchParams.set(k, v);
  return u;
};
const locals = { user: { supabaseId: 'u1' } };
const setHeaders = vi.fn();
const attempt = async <T>(fn: () => Promise<T>) => {
  try {
    return { value: await fn() };
  } catch (e) {
    return { thrown: e as { status: number; location: string } };
  }
};
const params = (location: string | undefined) =>
  Object.fromEntries(new URL(location ?? 'x:/').searchParams);
const run = (url: URL, over: object = {}) =>
  attempt(() => load({ url, locals, setHeaders, ...over } as never) as Promise<unknown>);
const act = (
  name: 'approve' | 'deny',
  url: URL,
  form: Record<string, string> = {},
  origin: string | null = 'https://hub.test',
  site?: string,
) =>
  attempt(
    () =>
      actions[name]!({
        url,
        locals,
        setHeaders,
        request: new Request(url, {
          method: 'POST',
          headers: { ...(origin ? { origin } : {}), ...(site ? { 'sec-fetch-site': site } : {}) },
          body: new URLSearchParams(form),
        }),
      } as never) as Promise<unknown>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.getClient.mockResolvedValue({
    id: 'mcpc_a',
    name: 'Claude Code',
    redirectUris: ['http://localhost:3118/callback'],
    createdAt: new Date(1_700_000_000_000),
  });
  m.memberships.mockResolvedValue([
    { id: 'org-1', name: 'FACES' },
    { id: 'org-2', name: 'Other' },
  ]);
  m.createCode.mockResolvedValue('mcp_ac_secret');
});

describe('approval screen load', () => {
  it("shows the app, its return address and only the person's organizations", async () => {
    const { value } = await run(urlOf());
    expect(value).toEqual({
      valid: true,
      appName: 'Claude Code',
      registeredAt: 1_700_000_000_000,
      redirectUri: 'http://localhost:3118/callback',
      orgs: [
        { id: 'org-1', name: 'FACES' },
        { id: 'org-2', name: 'Other' },
      ],
      refused: null,
    });
  });

  it('a person with no organization gets an empty list (the screen offers no approval)', async () => {
    m.memberships.mockResolvedValue([]);
    expect((await run(urlOf())).value).toMatchObject({ valid: true, orgs: [] });
  });

  it('an unknown app or a return address it did not register renders the error page, never a redirect', async () => {
    m.getClient.mockResolvedValue(null);
    expect((await run(urlOf())).value).toEqual({ valid: false, refused: null });
    m.getClient.mockResolvedValue({
      id: 'mcpc_a',
      name: 'X',
      redirectUris: ['http://localhost:3118/callback'],
    });
    for (const redirect_uri of ['http://localhost:3118/other', 'https://evil.test/cb', undefined]) {
      const r = await run(urlOf({ redirect_uri }));
      expect(r.thrown).toBeUndefined();
      expect(r.value).toEqual({ valid: false, refused: null });
    }
  });

  it('other invalid parameters redirect back to the registered address with the state', async () => {
    for (const over of [
      { code_challenge_method: 'plain' },
      { response_type: 'token' },
      { code_challenge: 'short' },
    ]) {
      const r = await run(urlOf(over));
      expect(r.thrown?.status).toBe(303);
      expect(params(r.thrown?.location)).toEqual({
        iss: 'https://hub.test',
        state: 'st8',
        error: 'invalid_request',
      });
    }
    const target = await run(urlOf({ resource: 'https://other.test/api/mcp' }));
    expect(params(target.thrown?.location).error).toBe('invalid_target');
  });

  it('refuses a state over 512 characters and does not echo it back', async () => {
    const r = await run(urlOf({ state: 's'.repeat(513) }));
    expect(params(r.thrown?.location)).toMatchObject({ error: 'invalid_request' });
    expect(params(r.thrown?.location).state).toBeUndefined();
  });

  it('strips control and bidirectional characters from the app name shown', async () => {
    m.getClient.mockResolvedValue({
      id: 'mcpc_a',
      name: 'Ev\u202eil\u0007',
      redirectUris: ['http://localhost:3118/callback'],
      createdAt: new Date(),
    });
    expect((await run(urlOf())).value).toMatchObject({ appName: 'Evil' });
  });

  it('accepts a resource equal to the MCP endpoint', async () => {
    expect((await run(urlOf({ resource: 'https://hub.test/api/mcp' }))).value).toMatchObject({
      valid: true,
    });
  });

  it('sends a signed-out person to sign in and back to the same request', async () => {
    const url = urlOf();
    const r = await run(url, { locals: {} });
    expect(r.thrown?.location).toBe(
      `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`,
    );
  });
});

describe('approve', () => {
  it('creates a code for the chosen organization and redirects to the registered address with it', async () => {
    const r = await act('approve', urlOf(), { org_id: 'org-2' });
    expect(m.createCode).toHaveBeenCalledWith({
      clientId: 'mcpc_a',
      userId: 'u1',
      orgId: 'org-2',
      redirectUri: 'http://localhost:3118/callback',
      codeChallenge: CHALLENGE,
    });
    expect(r.thrown?.status).toBe(303);
    expect(r.thrown?.location).toMatch(/^http:\/\/localhost:3118\/callback\?/);
    expect(params(r.thrown?.location)).toEqual({
      iss: 'https://hub.test',
      state: 'st8',
      code: 'mcp_ac_secret',
    });
  });

  it('takes only the organization from the form: a forged redirect_uri changes nothing', async () => {
    await act('approve', urlOf(), { org_id: 'org-1', redirect_uri: 'https://evil.test/cb' });
    expect(m.createCode.mock.calls[0]![0].redirectUri).toBe('http://localhost:3118/callback');
  });

  it('an organization the person is not in goes back to this screen with refused=org and creates nothing', async () => {
    for (const form of [{ org_id: 'org-9' }, {}] as Record<string, string>[]) {
      const r = await act('approve', urlOf(), form);
      expect(r.thrown?.status).toBe(303);
      const back = new URL(r.thrown!.location, 'https://hub.test');
      expect(back.pathname).toBe('/oauth/authorize');
      expect(back.searchParams.get('refused')).toBe('org');
      expect(back.searchParams.get('client_id')).toBe('mcpc_a'); // the validated request is kept
    }
    expect(m.createCode).not.toHaveBeenCalled();
  });

  it('an invalid app or return address goes back with refused=invalid, never to the app', async () => {
    m.getClient.mockResolvedValue(null);
    const r = await act('approve', urlOf(), { org_id: 'org-1' });
    expect(r.thrown?.location).toMatch(/^\/oauth\/authorize\?/);
    expect(new URL(r.thrown!.location, 'https://hub.test').searchParams.get('refused')).toBe(
      'invalid',
    );
    expect(m.createCode).not.toHaveBeenCalled();
  });

  it('shows the refusal code the screen was sent back with, and only known ones', async () => {
    expect((await run(urlOf({ refused: 'org' }))).value).toMatchObject({ refused: 'org' });
    expect((await run(urlOf({ refused: '<script>' }))).value).toMatchObject({ refused: null });
  });
});

describe('same-origin assertion (P1)', () => {
  it.each(['approve', 'deny'] as const)(
    '%s with a foreign or missing Origin goes back with refused=origin',
    async (name) => {
      for (const origin of ['https://evil.test', null]) {
        const r = await act(name, urlOf(), { org_id: 'org-1' }, origin);
        expect(r.thrown?.status).toBe(303);
        expect(r.thrown?.location).toMatch(/^\/oauth\/authorize\?/);
        expect(new URL(r.thrown!.location, 'https://hub.test').searchParams.get('refused')).toBe(
          'origin',
        );
      }
      expect(m.createCode).not.toHaveBeenCalled();
    },
  );

  it('approve passes when Origin is blanked but the browser marks the post same-origin', async () => {
    const r = await act('approve', urlOf(), { org_id: 'org-1' }, 'null', 'same-origin');
    expect(new URL(r.thrown!.location, 'https://hub.test').searchParams.get('refused')).toBeNull();
    const cross = await act('approve', urlOf(), { org_id: 'org-1' }, 'null', 'cross-site');
    expect(new URL(cross.thrown!.location, 'https://hub.test').searchParams.get('refused')).toBe(
      'origin',
    );
  });

  it('drops the form-action key from the URL it goes back to', async () => {
    const url = new URL(`${urlOf().href}&%2Fapprove=`);
    const r = await act('approve', url, {}, null);
    expect(r.thrown!.location).not.toContain('approve');
  });
});

describe('deny', () => {
  it('tells the app access was denied and creates nothing', async () => {
    const r = await act('deny', urlOf());
    expect(params(r.thrown?.location)).toEqual({
      iss: 'https://hub.test',
      state: 'st8',
      error: 'access_denied',
    });
    expect(m.createCode).not.toHaveBeenCalled();
  });
});
