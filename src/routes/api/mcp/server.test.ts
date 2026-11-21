import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  limit: vi.fn(async (_key: string, _limit: number) => true),
  verifyKey: vi.fn(),
  touchKey: vi.fn(async (_id: string) => undefined),
  upsertElement: vi.fn(),
}));

vi.mock('$server/auth/shared-rate-limit', () => ({
  checkSharedRateLimit: (key: string, limit: number) => mocks.limit(key, limit),
}));
vi.mock('$server/services/org-api-keys.service', () => ({
  verifyKey: (text: string) => mocks.verifyKey(text),
  touchKey: (id: string) => mocks.touchKey(id),
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
// Connection-credential path (spec 143): never reached by these key assertions.
vi.mock('$server/config/urls', () => ({ hubBaseUrl: () => 'http://hub.test' }));
vi.mock('$server/services/modules.service', () => ({ listModuleStates: vi.fn() }));
vi.mock('$server/services/entitlements.service', () => ({ resolveEntitlements: vi.fn() }));
vi.mock('$lib/modules/route-guard', () => ({ isAppRouteBlocked: () => false }));
vi.mock('$server/db/client', () => ({ getDb: () => ({}) }));
vi.mock('$server/mcp/oauth.service', () => ({
  findAccess: vi.fn(async () => null),
  endConnection: vi.fn(),
  touchConnection: vi.fn(),
}));
vi.mock('$server/auth/supabase-bridge.runtime', () => ({ resolveSupabaseTenant: vi.fn() }));
vi.mock('$server/services/canonical-directory.service', () => ({
  loadCanonicalProfile: vi.fn(),
  loadCanonicalMemberships: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({
  hasOrgCapability: vi.fn(),
  resolveCapabilities: vi.fn(),
}));
vi.mock('$server/sandbox/sandbox.service', () => ({
  LIBRARY_PAGE: 'library',
  datasetCatalog: () => [],
  listDatasets: vi.fn(),
  runQuery: vi.fn(),
  listElements: vi.fn(),
  listPages: vi.fn(),
  removeElement: vi.fn(),
  upsertElement: (...a: unknown[]) => mocks.upsertElement(...a),
}));

import * as route from './+server';
import { POST } from './+server';

const KEY = `mk_1a2b3c4d_${'A'.repeat(43)}`;
const call = (body: unknown, authorization: string | null = `Bearer ${KEY}`) =>
  POST({
    request: new Request('http://hub.test/api/mcp', {
      method: 'POST',
      headers: authorization ? { authorization } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as never) as Promise<Response>;
const write = {
  jsonrpc: '2.0',
  id: 7,
  method: 'tools/call',
  params: { name: 'sandbox_element_write', arguments: { page: 'ventas', title: 'T', html: '<p>' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue(true);
  mocks.verifyKey.mockResolvedValue({
    id: 'k1',
    orgId: 'org-1',
    lastUsedAt: null,
    scopes: ['sandbox'],
  });
  mocks.upsertElement.mockResolvedValue({
    id: 'e1',
    page: 'ventas',
    title: 'T',
    html: '<p>',
    css: '',
    js: '',
    w: 2,
    h: 2,
    position: 0,
    updatedAt: 'x',
  });
});

describe('POST /api/mcp', () => {
  it('has no GET handler (405 from the framework)', () => {
    expect('GET' in route).toBe(false);
  });

  it('401s no key, a non-key Authorization, a malformed/revoked key; nothing is written', async () => {
    mocks.verifyKey.mockResolvedValue(null);
    for (const auth of [null, 'Basic abc', 'Bearer nope', `Bearer ${KEY}`]) {
      expect((await call(write, auth)).status).toBe(401);
    }
    expect(mocks.upsertElement).not.toHaveBeenCalled();
  });

  it('403s a key without the sandbox scope, naming the scope', async () => {
    mocks.verifyKey.mockResolvedValue({ id: 'k1', orgId: 'org-1', lastUsedAt: null, scopes: [] });
    const res = await call(write);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain('"sandbox"');
    expect(mocks.upsertElement).not.toHaveBeenCalled();
  });

  it('429s over the per-key limit', async () => {
    mocks.limit.mockResolvedValue(false);
    const res = await call(write);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(mocks.limit).toHaveBeenCalledWith('mcp-key:k1', 120);
  });

  it('a write returns the id and passes the key org and key id to the service', async () => {
    const res = await call(write);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(body.result.content[0]!.text).element.id).toBe('e1');
    expect(mocks.upsertElement).toHaveBeenCalledWith(
      { db: {}, tenantId: 'org-1' },
      expect.objectContaining({ page: 'ventas', title: 'T', writtenByKey: 'k1' }),
    );
    expect(mocks.touchKey).toHaveBeenCalledWith('k1');
  });

  it('answers invalid JSON with a protocol error, and a notification with 202', async () => {
    const bad = await call('{nope');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: -32700 } });
    const note = await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(note.status).toBe(202);
  });
});

describe('POST /api/mcp — sign-in pointer and neutral refusals', () => {
  it('answers a missing, foreign or unknown credential with 401 and the pointer, no body secrets', async () => {
    for (const auth of [null, 'Basic abc', 'Bearer nope', 'Bearer mcp_at_unknown']) {
      const res = await call(write, auth);
      expect(res.status).toBe(401);
      const header = res.headers.get('www-authenticate') ?? '';
      expect(header).toContain(
        'resource_metadata="http://hub.test/.well-known/oauth-protected-resource/api/mcp"',
      );
      expect(header.includes('error="invalid_token"')).toBe(auth !== null);
      expect(((await res.json()) as { error: string }).error).toBe(
        'Send a valid API key or sign in.',
      );
    }
  });

  it('429s a connection credential over the per-address limit before any lookup; keys skip that limit', async () => {
    mocks.limit.mockResolvedValue(false);
    const res = await call(write, `Bearer mcp_at_${'A'.repeat(43)}`);
    expect(res.status).toBe(429);
    expect(mocks.verifyKey).not.toHaveBeenCalled();
    expect(mocks.limit).toHaveBeenCalledWith('mcp-ip:unknown', 300);
  });

  it('a key caller is not offered whoami or sandbox_query', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = (
      (await res.json()) as { result: { tools: { name: string }[] } }
    ).result.tools.map((t) => t.name);
    expect(names).toContain('sandbox_datasets');
    expect(names).not.toContain('whoami');
    expect(names).not.toContain('sandbox_query');
  });
});
