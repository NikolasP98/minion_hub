import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import type { GraphOpts, GraphResult, TokenResponse, PageWithToken, AdAccount, IgShortLivedToken, IgLongLivedToken } from './graph-read';

const exchangeCodeForToken = vi.fn<
  (params: { appId: string; appSecret: string; code: string; redirectUri: string }, opts?: GraphOpts) => Promise<GraphResult<TokenResponse>>
>();
const extendUserToken = vi.fn<
  (params: { appId: string; appSecret: string; shortToken: string }, opts?: GraphOpts) => Promise<GraphResult<TokenResponse>>
>();
const listPagesWithTokens = vi.fn<(userToken: string, opts?: GraphOpts) => Promise<GraphResult<PageWithToken[]>>>();
const listAdAccounts = vi.fn<(userToken: string, opts?: GraphOpts) => Promise<GraphResult<AdAccount[]>>>();
const exchangeIgCodeForToken = vi.fn<
  (params: { appId: string; appSecret: string; code: string; redirectUri: string }, opts?: unknown) => Promise<GraphResult<IgShortLivedToken>>
>();
const exchangeIgLongLivedToken = vi.fn<
  (params: { appSecret: string; shortToken: string }, opts?: unknown) => Promise<GraphResult<IgLongLivedToken>>
>();

vi.mock('./graph-read', () => ({
  exchangeCodeForToken: (params: unknown, opts?: unknown) => exchangeCodeForToken(params as never, opts as never),
  extendUserToken: (params: unknown, opts?: unknown) => extendUserToken(params as never, opts as never),
  listPagesWithTokens: (userToken: string, opts?: unknown) => listPagesWithTokens(userToken, opts as never),
  listAdAccounts: (userToken: string, opts?: unknown) => listAdAccounts(userToken, opts as never),
  exchangeIgCodeForToken: (params: unknown, opts?: unknown) => exchangeIgCodeForToken(params as never, opts as never),
  exchangeIgLongLivedToken: (params: unknown, opts?: unknown) => exchangeIgLongLivedToken(params as never, opts as never),
}));

// Import after the mock is registered.
const { createConnectionFromOAuth, createIgConnectionFromOAuth } = await import('./meta-connections.service');

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  process.env.META_APP_ID = 'app-1';
  process.env.META_APP_SECRET = 'secret-1';
  process.env.META_LOGIN_CONFIG_ID = 'config-1';
  process.env.META_IG_APP_ID = 'ig-app-1';
  process.env.META_IG_APP_SECRET = 'ig-secret-1';
  exchangeCodeForToken.mockReset();
  extendUserToken.mockReset();
  listPagesWithTokens.mockReset();
  listAdAccounts.mockReset();
  exchangeIgCodeForToken.mockReset();
  exchangeIgLongLivedToken.mockReset();
});

describe('createConnectionFromOAuth', () => {
  it('happy path: exchanges code, debugs a never-expiring token, upserts connection + page + ad account', async () => {
    exchangeCodeForToken.mockResolvedValue({ ok: true, status: 200, data: { access_token: 'short-lived' } });
    listPagesWithTokens.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ id: 'page1', name: 'FACES Page', access_token: 'page-token' }],
    });
    listAdAccounts.mockResolvedValue({ ok: true, status: 200, data: [{ id: 'act_1', name: 'FACES Ads', currency: 'PEN' }] });

    // debug_token goes through the injected fetchImpl (not graph-read.ts — see
    // meta-connections.service.ts header comment on why it's inlined here).
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/debug_token')) {
        return jsonResponse({ data: { is_valid: true, expires_at: 0, scopes: ['ads_read', 'business_management'], user_id: 'sysuser1' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'conn-1' }], // connection insert().onConflictDoUpdate().returning()
      [], // page asset insert
      [], // ad_account asset insert
    ]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await createConnectionFromOAuth(
      ctx,
      { code: 'code-1', redirectUri: 'https://hub.minion-ai.org/api/meta/oauth/callback', connectedBy: 'user-1' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.connectionId).toBe('conn-1');
    expect(result.pagesFound).toBe(1);
    expect(result.adAccountsFound).toBe(1);
    expect(result.igFound).toBe(0);
    expect(result.pagePath).toBe('me/accounts');
    // Never-expiring token (expires_at: 0) → no extend call, per spec §5 LIVE FACTS.
    expect(extendUserToken).not.toHaveBeenCalled();
  });

  it('fails without touching the db when debug_token rejects the exchanged token', async () => {
    exchangeCodeForToken.mockResolvedValue({ ok: true, status: 200, data: { access_token: 'short-lived' } });
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'Invalid OAuth access token' } }, false, 401));

    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await createConnectionFromOAuth(
      ctx,
      { code: 'code-1', redirectUri: 'https://hub.minion-ai.org/api/meta/oauth/callback', connectedBy: 'user-1' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Invalid OAuth access token/);
    expect(db.insert).not.toHaveBeenCalled();
    expect(listPagesWithTokens).not.toHaveBeenCalled();
  });

  it('fails when the code exchange itself fails', async () => {
    exchangeCodeForToken.mockResolvedValue({ ok: false, status: 400, error: 'invalid code' });
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await createConnectionFromOAuth(
      ctx,
      { code: 'bad-code', redirectUri: 'https://hub.minion-ai.org/api/meta/oauth/callback', connectedBy: 'user-1' },
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid code');
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('createIgConnectionFromOAuth', () => {
  it('happy path: short→long-lived exchange, upserts an ig_login connection + single ig asset', async () => {
    exchangeIgCodeForToken.mockResolvedValue({
      ok: true,
      status: 200,
      data: { access_token: 'ig-short', user_id: 'ig-user-1', permissions: ['instagram_business_basic'] },
    });
    exchangeIgLongLivedToken.mockResolvedValue({
      ok: true,
      status: 200,
      data: { access_token: 'ig-long', token_type: 'bearer', expires_in: 5_184_000 },
    });

    // fetchIgUsername is a plain fetchImpl call (not routed through graph-read.ts) — respond to its URL specifically.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('fields=username')) return jsonResponse({ username: 'faces.sculptors' });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'ig-conn-1' }], // connection insert().onConflictDoUpdate().returning()
      [], // asset insert
    ]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await createIgConnectionFromOAuth(
      ctx,
      { code: 'ig-code-1', redirectUri: 'https://hub.minion-ai.org/api/meta/ig/callback', connectedBy: 'user-1' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.connectionId).toBe('ig-conn-1');
    expect(exchangeIgCodeForToken).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'ig-app-1', appSecret: 'ig-secret-1', code: 'ig-code-1' }),
      expect.anything(),
    );
    expect(exchangeIgLongLivedToken).toHaveBeenCalledWith(
      expect.objectContaining({ appSecret: 'ig-secret-1', shortToken: 'ig-short' }),
      expect.anything(),
    );
  });

  it('fails without touching the db when the short-lived exchange fails', async () => {
    exchangeIgCodeForToken.mockResolvedValue({ ok: false, status: 400, error: 'invalid code' });
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await createIgConnectionFromOAuth(
      ctx,
      { code: 'bad-code', redirectUri: 'https://hub.minion-ai.org/api/meta/ig/callback', connectedBy: 'user-1' },
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid code');
    expect(db.insert).not.toHaveBeenCalled();
    expect(exchangeIgLongLivedToken).not.toHaveBeenCalled();
  });

  it('fails without touching the db when the long-lived exchange fails', async () => {
    exchangeIgCodeForToken.mockResolvedValue({
      ok: true,
      status: 200,
      data: { access_token: 'ig-short', user_id: 'ig-user-1' },
    });
    exchangeIgLongLivedToken.mockResolvedValue({ ok: false, status: 400, error: 'exchange failed' });
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await createIgConnectionFromOAuth(
      ctx,
      { code: 'code-1', redirectUri: 'https://hub.minion-ai.org/api/meta/ig/callback', connectedBy: 'user-1' },
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('exchange failed');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('throws when META_IG_APP_ID/META_IG_APP_SECRET are not configured', async () => {
    delete process.env.META_IG_APP_ID;
    const { db } = createMockDb();
    const ctx = { db: db as never, tenantId: 'org-1' };

    await expect(
      createIgConnectionFromOAuth(ctx, { code: 'c', redirectUri: 'https://hub/api/meta/ig/callback', connectedBy: 'u' }, {}),
    ).rejects.toThrow(/META_IG_APP_ID/);
  });
});
