import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spec 043 T030: the model-call backstop (llm usage middleware, embeddings, assistant router).
const h = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  execute: vi.fn(),
  capture: vi.fn(),
  cacheFail: false,
}));

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('@minion-stack/cache', () => ({
  cached: async (_k: unknown, _o: unknown, loader: () => Promise<unknown>) => {
    if (h.cacheFail) throw new Error('cache down');
    return loader();
  },
  invalidateTags: vi.fn(),
  keys: { hub: (d: string, p: Record<string, string>) => `hub:${d}:${p.t}` },
  tags: { tenantDomain: (t: string, d: string) => [`tenant:${t}:${d}`] },
}));
vi.mock('$lib/server/posthog', () => ({ captureServerEvent: h.capture }));
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: () => ({
    execute: h.execute,
    insert: () => ({ values: () => ({ catch: () => {} }) }),
  }),
}));

import { runWithAiUsageScope, withAiUsageOrg } from '$server/ai-usage';
import { assertAiCallAllowed } from '$server/services/entitlements.service';
import { EntitlementError } from '$server/entitlements/errors';
import { getOpenRouterModel } from '$server/llm';

const ORG = '11111111-1111-1111-1111-111111111111';
const base = () => h.execute.mockResolvedValue([{ kind: 'business', plan_key: null }]);
const premium = () => h.execute.mockResolvedValue([{ kind: 'business', plan_key: 'premium' }]);
const scope = (orgId: string | null, authenticated: boolean) => ({
  orgId,
  route: '/api/notes/polish',
  feature: null,
  authenticated,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.cacheFail = false;
  base();
});

describe('assertAiCallAllowed', () => {
  it('is a no-op when not enforced, even for a Base org, and does not look the plan up', async () => {
    await runWithAiUsageScope(scope(ORG, true), () => assertAiCallAllowed('llm'));
    expect(h.execute).not.toHaveBeenCalled();
  });

  describe('enforced', () => {
    beforeEach(() => {
      h.env.ENTITLEMENTS_ENFORCED = 'true';
    });

    it('denies a Base org in scope and reports the request denial', async () => {
      await expect(
        runWithAiUsageScope(scope(ORG, true), () => assertAiCallAllowed('llm')),
      ).rejects.toMatchObject({ name: 'EntitlementError', feature: 'ai', reason: 'not_in_plan' });
      expect(h.capture).toHaveBeenCalledOnce();
    });

    it('allows a Premium org', async () => {
      premium();
      await expect(
        runWithAiUsageScope(scope(ORG, true), () => assertAiCallAllowed('llm')),
      ).resolves.toBeUndefined();
    });

    it('denies a signed-in request with no org', async () => {
      await expect(
        runWithAiUsageScope(scope(null, true), () => assertAiCallAllowed('llm')),
      ).rejects.toBeInstanceOf(EntitlementError);
      expect(h.execute).not.toHaveBeenCalled();
    });

    it('allows and logs a call with no scope (scripts) or an unauthenticated scope with no org', async () => {
      await expect(assertAiCallAllowed('llm')).resolves.toBeUndefined();
      await expect(
        runWithAiUsageScope(scope(null, false), () => assertAiCallAllowed('embeddings')),
      ).resolves.toBeUndefined();
      expect(console.info).toHaveBeenCalledTimes(2);
    });

    it('fails closed on a lookup error', async () => {
      h.cacheFail = true;
      premium();
      await expect(
        runWithAiUsageScope(scope(ORG, true), () => assertAiCallAllowed('llm')),
      ).rejects.toMatchObject({ reason: 'lookup_error' });
    });

    it('a tick org scope (unauthenticated) is denied without a PostHog event', async () => {
      await expect(
        runWithAiUsageScope(scope(null, false), () =>
          withAiUsageOrg(ORG, 'crm.relationship', () => assertAiCallAllowed('llm')),
        ),
      ).rejects.toBeInstanceOf(EntitlementError);
      expect(h.capture).not.toHaveBeenCalled();
    });

    it('child scopes keep the signed-in mark', async () => {
      await expect(
        runWithAiUsageScope(scope(null, true), () =>
          withAiUsageOrg(null, 'x', () => assertAiCallAllowed('llm')),
        ),
      ).rejects.toMatchObject({ reason: 'no_org' });
    });
  });
});

describe('llm usage middleware', () => {
  const call = () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 500 }));
    h.env.OPENROUTER_API_KEY = 'fixture-key';
    const model = getOpenRouterModel('openai/gpt-4o-mini', {
      mode: 'pulse-digest-v1',
      fetch: fetcher as unknown as typeof fetch,
    });
    const params = { prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] };
    return { fetcher, model, params: params as unknown as Parameters<typeof model.doGenerate>[0] };
  };

  it('refuses before the provider is called when enforced and the org lacks ai', async () => {
    const { fetcher, model, params } = call();
    h.env.ENTITLEMENTS_ENFORCED = 'true';
    await runWithAiUsageScope(scope(ORG, true), async () => {
      await expect(model.doGenerate(params)).rejects.toBeInstanceOf(EntitlementError);
      await expect(model.doStream(params)).rejects.toBeInstanceOf(EntitlementError);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reaches the provider when not enforced', async () => {
    const { fetcher, model, params } = call();
    await runWithAiUsageScope(scope(ORG, true), async () => {
      await Promise.resolve(model.doGenerate(params)).catch(() => {});
    });
    expect(fetcher).toHaveBeenCalled();
  });
});
