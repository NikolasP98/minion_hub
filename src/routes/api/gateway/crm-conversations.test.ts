import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capabilities } from '$server/services/rbac.service';

const mocks = vi.hoisted(() => ({
  principal: vi.fn<typeof import('$server/auth/assistant-principal').resolveAssistantPrincipal>(),
  db: vi.fn(),
  themes:
    vi.fn<typeof import('$server/services/crm-conversation-analysis.service').conversationThemes>(),
  search:
    vi.fn<
      typeof import('$server/services/crm-conversation-vectors.service').similarConversations
    >(),
  embed: vi.fn<typeof import('$server/services/embeddings').embedText>(),
  entitlement: vi.fn<typeof import('$server/services/entitlements.service').requireOrgFeature>(),
}));

vi.mock('$server/auth/assistant-principal', () => ({ resolveAssistantPrincipal: mocks.principal }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: mocks.db }));
vi.mock('$server/services/crm-conversation-analysis.service', () => ({
  conversationThemes: mocks.themes,
}));
vi.mock('$server/services/crm-conversation-vectors.service', () => ({
  similarConversations: mocks.search,
}));
vi.mock('$server/services/embeddings', () => ({ embedText: mocks.embed }));
vi.mock('$server/services/entitlements.service', () => ({ requireOrgFeature: mocks.entitlement }));

import { POST as themes } from './crm-conversation-themes/+server';
import { POST as search } from './search-crm-conversations/+server';

const ORG = '10000000-0000-4000-8000-000000000001';
const PROFILE = '20000000-0000-4000-8000-000000000001';
const db = {};
const ctx = { db, tenantId: ORG, profileId: PROFILE };
const summary = {
  topPainPoints: [{ point: 'appointment availability', count: 2 }],
  intentDistribution: [{ intent: 'booking', count: 3 }],
  overAnswered: { rate: 0.25, count: 1, total: 4 },
};
const hits = [
  {
    chat_id: 'synthetic-chat',
    channel: 'fixture',
    contact_id: null,
    content: 'A synthetic question about appointment availability.',
    similarity: 0.8,
    last_at: '2026-11-01T00:00:00.000Z',
  },
];
const vector = [0.1, 0.2];
const unsupportedScope = {
  code: 'CRM_CONVERSATION_SCOPE_UNSUPPORTED',
  error:
    'Conversation analysis is unavailable for roles with record or sensitive-field restrictions.',
};
const routes = [
  { path: 'crm-conversation-themes', post: themes },
  { path: 'search-crm-conversations', post: search },
];

function capabilities({ canView = true, own = false, field = 1 } = {}): Capabilities {
  return {
    roles: ['staff'],
    can: vi.fn((module, action) => module === 'crm' && action === 'view' && canView),
    canRunAnalytics: () => canView,
    visibleModules: () => (canView ? ['crm'] : []),
    ownerScoped: vi.fn(() => own),
    fieldLevel: vi.fn(() => field),
    explicitView: () => undefined,
  };
}

function useCapabilities(caps: Capabilities) {
  mocks.principal.mockResolvedValue({
    principalId: PROFILE,
    orgId: ORG,
    role: 'staff',
    capabilities: caps,
  });
}

function eventFor(path: string, body: unknown = { query: 'availability' }) {
  const url = new URL(`https://hub.test/api/gateway/${path}?agentId=personal-${PROFILE}`);
  return {
    locals: {},
    url,
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };
}

function expectNoDataWork() {
  expect(mocks.db).not.toHaveBeenCalled();
  expect(mocks.themes).not.toHaveBeenCalled();
  expect(mocks.embed).not.toHaveBeenCalled();
  expect(mocks.search).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  useCapabilities(capabilities());
  mocks.db.mockReturnValue(db);
  mocks.themes.mockResolvedValue(summary);
  mocks.embed.mockResolvedValue(vector);
  mocks.search.mockResolvedValue(hits);
  mocks.entitlement.mockResolvedValue(undefined);
});

describe.each(routes)('CRM conversation permissions: $path', ({ path, post }) => {
  it.each([1, 2])('allows an unrestricted CRM viewer at field level %i', async (field) => {
    const caps = capabilities({ field });
    useCapabilities(caps);
    const event = eventFor(path);
    const response = await post(event as never);
    expect(response.status).toBe(200);
    expect(mocks.principal).toHaveBeenCalledWith(event.locals, event.url);
    expect(await response.json()).toEqual(
      path === 'crm-conversation-themes' ? { orgId: ORG, ...summary } : { orgId: ORG, hits },
    );
    if (path === 'crm-conversation-themes') {
      expect(mocks.themes).toHaveBeenCalledWith(ctx, { channel: undefined, since: undefined });
      expect(mocks.embed).not.toHaveBeenCalled();
      expect(mocks.entitlement).not.toHaveBeenCalled();
    } else {
      expect(mocks.entitlement).toHaveBeenCalledWith(ORG, 'ai', 'gateway.search-crm-conversations');
      expect(mocks.embed).toHaveBeenCalledWith('availability');
      expect(mocks.search).toHaveBeenCalledWith(ctx, vector, 8);
    }
  });

  it.each([
    { label: 'owner-only', own: true, field: 1 },
    { label: 'masked sensitive fields', own: false, field: 0 },
    { label: 'both restrictions', own: true, field: 0 },
  ])('rejects $label before parsing input or accessing data', async ({ own, field }) => {
    useCapabilities(capabilities({ own, field }));
    const event = eventFor(path);
    const parse = vi.spyOn(event.request, 'json');
    const response = await post(event as never);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(unsupportedScope);
    expect(parse).not.toHaveBeenCalled();
    expectNoDataWork();
  });

  it('rejects denied CRM view before conversation work', async () => {
    useCapabilities(capabilities({ canView: false }));
    const response = await post(eventFor(path) as never);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Your role does not permit reading this organization’s CRM data.',
    });
    expectNoDataWork();
  });

  it('propagates trusted-principal rejection without a fallback actor or data work', async () => {
    const rejection = {
      status: 403,
      body: { code: 'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED', message: 'Assignment required.' },
    };
    mocks.principal.mockRejectedValue(rejection);
    await expect(post(eventFor(path) as never)).rejects.toBe(rejection);
    expect(mocks.entitlement).not.toHaveBeenCalled();
    expectNoDataWork();
  });
});

describe('CRM conversation input and entitlement contracts', () => {
  it('passes aggregate filters within the trusted principal context', async () => {
    await themes(
      eventFor('crm-conversation-themes', {
        channel: 'fixture',
        since: '2026-11-01',
        orgId: 'untrusted-org',
      }) as never,
    );
    expect(mocks.themes).toHaveBeenCalledWith(ctx, { channel: 'fixture', since: '2026-11-01' });
  });

  it('preserves search entitlement rejection before embedding', async () => {
    const rejection = { status: 403, body: { message: 'AI entitlement required.' } };
    mocks.entitlement.mockRejectedValue(rejection);
    await expect(search(eventFor('search-crm-conversations') as never)).rejects.toBe(rejection);
    expectNoDataWork();
  });

  it.each([{}, { query: '  ' }, { query: 123 }])(
    'rejects invalid search input %j without embedding',
    async (body) => {
      await expect(
        search(eventFor('search-crm-conversations', body) as never),
      ).rejects.toMatchObject({ status: 400 });
      expect(mocks.embed).not.toHaveBeenCalled();
      expect(mocks.search).not.toHaveBeenCalled();
    },
  );

  it.each([
    { k: -1, expected: 1 },
    { k: 100, expected: 25 },
    { k: 3.7, expected: 3 },
  ])('retains bounded search result count $k → $expected', async ({ k, expected }) => {
    await search(eventFor('search-crm-conversations', { query: 'availability', k }) as never);
    expect(mocks.search).toHaveBeenCalledWith(ctx, vector, expected);
  });
});
