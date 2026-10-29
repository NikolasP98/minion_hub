import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spec 043 T033: every gated route refuses a Base org with 403 {code:'premium_required', feature}
// before any work starts (no model call, no fetch, no stream).
const h = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  execute: vi.fn(),
  model: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('@minion-stack/cache', async (orig) => ({
  ...(await orig<object>()),
  cached: async (_k: unknown, _o: unknown, loader: () => Promise<unknown>) => loader(),
}));
vi.mock('$lib/server/posthog', () => ({
  captureServerEvent: vi.fn(),
  getPostHogClient: async () => null,
}));
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: () => ({ execute: h.execute }),
  getOrgTransactionDb: vi.fn(),
}));
vi.mock('$server/llm', () => ({ getOpenRouterModel: h.model }));
vi.mock('$server/auth/assistant-principal', () => ({
  resolveAssistantPrincipal: async () => ({ principalId: 'p1', orgId: ORG, capabilities: [] }),
}));

const ORG = '11111111-1111-1111-1111-111111111111';
const modules = import.meta.glob('/src/routes/api/**/+server.ts');

/** [route file under src/routes/api, feature, methods (default: every exported verb)] */
const GATED: Array<[string, string, string[]?]> = [
  ...['analyze-run', 'dry-run', 'suggest-chapter', 'suggest-prompts', 'suggest-skill'].map(
    (r): [string, string] => [`builder/ai/${r}`, 'ai'],
  ),
  ...['autocomplete', 'polish', 'refine', 'spelling', 'transcribe'].map((r): [string, string] => [
    `notes/${r}`,
    'ai',
  ]),
  ['voice/tts', 'ai'],
  ['structured-stream', 'ai'],
  ['flows/[id]/copilot', 'ai'],
  ['crm/cleanup/review', 'ai'],
  ['crm/contacts/[id]/funnel/analyze', 'ai'],
  ['crm/contacts/[id]/journey/analyze', 'ai'],
  ['crm/contacts/[id]/similar-wins', 'ai'],
  ['crm/insights/win-index', 'ai'],
  ['crm/insights/sentiment', 'ai'],
  ['crm/tags/[id]/evaluate', 'ai'],
  ['crm/doors/[id]/faq-draft', 'ai'],
  ['artifacts/generate', 'ai'],
  ['artifacts/[id]/regenerate', 'ai'],
  ['agent-memories', 'ai', ['POST']],
  ['agent-memories/ingest', 'ai'],
  ['agent-memories/recall', 'ai'],
  ['brains', 'ai'],
  ['brains/[id]', 'ai'],
  ['brains/[id]/access', 'ai'],
  ['brains/[id]/agent', 'ai'],
  ['brains/[id]/documents', 'ai'],
  ['brains/[id]/documents/[docId]', 'ai'],
  ['brains/[id]/documents/[docId]/reingest', 'ai'],
  ['brains/[id]/search', 'ai'],
  ['brains/[id]/sources/[sourceId]', 'ai'],
  ['brains/module-sources', 'ai'],
  ['brains/settings', 'ai'],
  ['brains/template', 'ai'],
  ['workshop/compare', 'ai'],
  ['workshop/compare/rank', 'ai'],
  ['workshop/groupchat', 'ai'],
  ['workshop/groupchat/[id]', 'ai'],
  ['workshop/groupchat/[id]/advance', 'ai'],
  ['workshop/groupchat/[id]/cancel', 'ai'],
  ['workshop/leaderboard', 'ai'],
  ['workshop/saves', 'ai'],
  ['workshop/saves/[id]', 'ai'],
  ['workforce/[...path]', 'ai'],
  ['workforce/factory-intake', 'ai'],
  ['workforce/factory-intake/[id]', 'ai'],
  ['workforce/factory-intake/[id]/routing-decision', 'ai'],
  ['builder/agents/[id]', 'ai'],
  ['personal-agent/create', 'ai'],
  ['gateway/brain-search', 'ai'],
  ['gateway/brain-remember', 'ai'],
  ['gateway/search-crm-conversations', 'ai'],
  ['gateway/pulse/proposals', 'ai.proactive'],
  ['assistant/route', 'ai.chat'],
  ['marketplace/agents', 'marketplace'],
  ['marketplace/agents/[id]', 'marketplace'],
  ['marketplace/install', 'marketplace'],
  ['marketplace/generate-agent', 'marketplace'],
];
const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

type Handler = (event: unknown) => Promise<Response>;
async function handlers(route: string, only?: string[]): Promise<Array<[string, Handler]>> {
  const load = modules[`/src/routes/api/${route}/+server.ts`];
  if (!load) throw new Error(`no route file for ${route}`);
  const mod = (await load()) as Record<string, Handler>;
  return VERBS.filter((v) => typeof mod[v] === 'function' && (!only || only.includes(v))).map(
    (v) => [v, mod[v]],
  );
}

function event(method: string, locals: Record<string, unknown>) {
  const url = new URL('https://hub.test/api/x?agentId=personal-p1');
  return {
    locals,
    params: { id: 'id-1', docId: 'd1', sourceId: 's1', path: 'issues' },
    url,
    request: new Request(url, {
      method,
      ...(method === 'GET' ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }),
    }),
    route: { id: '/api/x' },
    cookies: { get: () => undefined },
    setHeaders: vi.fn(),
    getClientAddress: () => '127.0.0.1',
  };
}

const member = () => ({
  user: { id: 'u1', role: 'user', email: 'u@example.test' },
  tenantCtx: { tenantId: ORG, db: {} },
  serverId: 'srv-1',
  workforceIdentity: { token: 't' },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', h.fetch);
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.env.ENTITLEMENTS_ENFORCED = 'true';
  h.execute.mockResolvedValue([{ kind: 'business', plan_key: null }]); // Base
});

describe('gated routes refuse a Base org when enforced', () => {
  it.each(GATED)('%s → 403 premium_required (%s)', async (route, feature, only) => {
    const list = await handlers(route, only);
    expect(list.length).toBeGreaterThan(0);
    for (const [verb, handler] of list) {
      await expect(handler(event(verb, member())), `${verb} ${route}`).rejects.toMatchObject({
        status: 403,
        body: { code: 'premium_required', feature },
      });
    }
    expect(h.model).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('agent-memories GET (a plain list) stays open', async () => {
    const [[, get]] = await handlers('agent-memories', ['GET']);
    await get(event('GET', member())).catch((e: { body?: { code?: string } }) => {
      expect(e?.body?.code).not.toBe('premium_required');
    });
  });

  it('structured-stream refuses before a stream is created', async () => {
    const [[, post]] = await handlers('structured-stream', ['POST']);
    const result = post(event('POST', member()));
    await expect(result).rejects.toMatchObject({ status: 403 });
    expect(h.model).not.toHaveBeenCalled();
  });
});

describe('marketplace catalog GETs without a tenant', () => {
  it('401 only when enforced', async () => {
    const [[, get]] = await handlers('marketplace/agents', ['GET']);
    await expect(get(event('GET', {}))).rejects.toMatchObject({ status: 401 });
    delete h.env.ENTITLEMENTS_ENFORCED;
    h.execute.mockResolvedValue([]);
    await get(event('GET', {})).catch((e: { status?: number }) => {
      expect(e?.status).not.toBe(401);
    });
  });
});

describe('a lookup error fails closed', () => {
  it('503 entitlements_unavailable', async () => {
    h.execute.mockRejectedValue(new Error('db down'));
    const [[, post]] = await handlers('notes/polish', ['POST']);
    await expect(post(event('POST', member()))).rejects.toMatchObject({
      status: 503,
      body: { code: 'entitlements_unavailable' },
    });
  });
});
