import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registry: vi.fn(),
  getCoreDb: vi.fn(),
  getDb: vi.fn(),
  getSession: vi.fn(),
  bridgeUser: vi.fn(),
  bridgeTenant: vi.fn(),
  decryptToken: vi.fn(),
  themes: vi.fn(),
  search: vi.fn(),
  embed: vi.fn(),
  entitlement: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({
  env: { AUTH_DISABLED: 'false', GATEWAY_TURSO_FALLBACK: 'false' },
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: mocks.getCoreDb }));
vi.mock('$server/db/client', () => ({ getDb: mocks.getDb }));
vi.mock('$server/auth/crypto', () => ({ decryptToken: mocks.decryptToken }));
vi.mock('$server/supabase', () => ({
  supabaseServer: () => ({ auth: { getSession: mocks.getSession } }),
  supabaseAdmin: vi.fn(),
}));
vi.mock('$server/auth/supabase-bridge.runtime', () => ({
  resolveSupabaseUser: mocks.bridgeUser,
  resolveSupabaseTenant: mocks.bridgeTenant,
}));
vi.mock('$server/services/rbac.service', () => ({ resolveCapabilities: vi.fn() }));
vi.mock('$server/services/crm-conversation-analysis.service', () => ({
  conversationThemes: mocks.themes,
}));
vi.mock('$server/services/crm-conversation-vectors.service', () => ({
  similarConversations: mocks.search,
}));
vi.mock('$server/services/embeddings', () => ({ embedText: mocks.embed }));
vi.mock('$server/services/entitlements.service', () => ({
  requireOrgFeature: mocks.entitlement,
}));

import { resolveIdentity } from './resolve-identity';
import { POST as themes } from '../../routes/api/gateway/crm-conversation-themes/+server';
import { POST as search } from '../../routes/api/gateway/search-crm-conversations/+server';

const ORG = '10000000-0000-4000-8000-000000000001';
const OTHER_ORG = '10000000-0000-4000-8000-000000000002';
const GATEWAY = '20000000-0000-4000-8000-000000000001';
const OTHER_GATEWAY = '20000000-0000-4000-8000-000000000002';
const PROFILE = '30000000-0000-4000-8000-000000000001';
const legacyDb = {};
const routes = [
  { path: '/api/gateway/crm-conversation-themes', post: themes },
  { path: '/api/gateway/search-crm-conversations', post: search },
];
let sequence = 0;
let token: string;

function gatewayRow(id: string, orgId: string) {
  return { id, orgId, legacyServerId: null, token: `sealed:${token}`, tokenIv: 'fixture-iv' };
}

function eventFor(path: string, bearer: string | null = token, hint = GATEWAY) {
  const url = new URL(`https://hub.test${path}?agentId=personal-${PROFILE}&orgId=${ORG}`);
  const headers = new Headers({ 'content-type': 'application/json', 'x-minion-server-id': hint });
  if (bearer !== null) headers.set('authorization', `Bearer ${bearer}`);
  return {
    url,
    request: new Request(url, { method: 'POST', headers, body: '{}' }),
    route: { id: path },
    cookies: { get: vi.fn(), getAll: () => [], delete: vi.fn() },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Successful token lookups are cached in production. Unique per-case tokens
  // keep fixtures independent without resetting or exposing private cache state.
  token = `synthetic-crm-token-${++sequence}`;
  mocks.registry.mockResolvedValue([gatewayRow(GATEWAY, ORG)]);
  mocks.getCoreDb.mockReturnValue({ select: () => ({ from: mocks.registry }) });
  mocks.getDb.mockReturnValue(legacyDb);
  mocks.decryptToken.mockImplementation((sealed: string) => sealed.slice('sealed:'.length));
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
});

describe.each(routes)('CRM machine identity: $path', ({ path, post }) => {
  it('admits the configured gateway credential on the exact route', async () => {
    const result = await resolveIdentity(eventFor(path) as never);
    expect(result).toEqual({
      bypassGate: true,
      locals: { serverId: GATEWAY, tenantCtx: { db: legacyDb, tenantId: ORG } },
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('selects and caches each configured identity when two gateways share a token', async () => {
    mocks.registry.mockResolvedValue([
      gatewayRow(OTHER_GATEWAY, OTHER_ORG),
      gatewayRow(GATEWAY, ORG),
    ]);
    const own = await resolveIdentity(eventFor(path) as never);
    const other = await resolveIdentity(eventFor(path, token, OTHER_GATEWAY) as never);
    const ownAgain = await resolveIdentity(eventFor(path) as never);
    expect(own.locals.tenantCtx?.tenantId).toBe(ORG);
    expect(other.locals.tenantCtx?.tenantId).toBe(OTHER_ORG);
    expect(ownAgain.locals.tenantCtx?.tenantId).toBe(ORG);
    expect(own.locals.serverId).toBe(GATEWAY);
    expect(other.locals.serverId).toBe(OTHER_GATEWAY);
    expect(mocks.registry).toHaveBeenCalledTimes(2);
  });

  it.each(['missing token', 'invalid token', 'unmatched server hint'])(
    'keeps %s anonymous and the real handler/principal rejects before data work',
    async (cause) => {
      const event = eventFor(
        path,
        cause === 'missing token' ? null : cause === 'invalid token' ? 'invalid' : token,
        cause === 'unmatched server hint' ? OTHER_GATEWAY : GATEWAY,
      );
      const identity = await resolveIdentity(event as never);
      expect(identity).toEqual({ locals: {}, bypassGate: false });
      // Real route and real principal: gateway routes own anonymous rejection;
      // the shared hook intentionally dispatches these requests to the handler.
      await expect(post({ ...event, locals: identity.locals } as never)).rejects.toMatchObject({
        status: 401,
        body: { message: 'Authentication required' },
      });
      expect(mocks.entitlement).not.toHaveBeenCalled();
      expect(mocks.themes).not.toHaveBeenCalled();
      expect(mocks.embed).not.toHaveBeenCalled();
      expect(mocks.search).not.toHaveBeenCalled();
    },
  );

  it.each([null, 'invalid-browser-bearer'])(
    'preserves verified browser fallback with Bearer %s',
    async (bearer) => {
      mocks.getSession.mockResolvedValue({
        data: { session: { access_token: 'browser-jwt' } },
        error: null,
      });
      mocks.bridgeUser.mockResolvedValue({
        id: PROFILE,
        supabaseId: PROFILE,
        email: 'staff@example.test',
        role: 'user',
      });
      mocks.bridgeTenant.mockResolvedValue({ orgId: ORG, kind: 'business' });
      const result = await resolveIdentity(eventFor(path, bearer) as never);
      expect(result.bypassGate).toBe(false);
      expect(result.locals.serverId).toBeUndefined();
      expect(result.locals.user?.supabaseId).toBe(PROFILE);
      expect(result.locals.tenantCtx?.tenantId).toBe(ORG);
      expect(mocks.bridgeUser).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        'browser-jwt',
      );
    },
  );
});

describe('CRM credential admission is exact', () => {
  it.each([
    '/api/gateway/crm-conversation-themes-extra',
    '/api/gateway/crm-conversation-themes/private',
    '/api/gateway/search-crm-conversations-extra',
    '/api/gateway/search-crm-conversations/private',
    '/api/gateway/unreviewed-crm-tool',
  ])('does not admit %s with a valid gateway credential', async (path) => {
    expect(await resolveIdentity(eventFor(path) as never)).toEqual({
      locals: {},
      bypassGate: false,
    });
    expect(mocks.registry).not.toHaveBeenCalled();
  });
});
