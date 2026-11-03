import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  execute: vi.fn(),
  existing: [] as Array<{ planKey: string }>,
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  invalidateTags: vi.fn(async () => {}),
  capture: vi.fn(),
  cacheFail: false,
}));

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('@minion-stack/cache', () => ({
  cached: async (_k: unknown, _o: unknown, loader: () => Promise<unknown>) => {
    if (h.cacheFail) throw new Error('cache down');
    return loader();
  },
  invalidateTags: h.invalidateTags,
  keys: { hub: (d: string, p: Record<string, string>) => `hub:${d}:${p.t}` },
  tags: { tenantDomain: (t: string, d: string) => [`tenant:${t}:${d}`] },
}));
vi.mock('$lib/server/posthog', () => ({ captureServerEvent: h.capture }));
vi.mock('$server/auth/authorize', () => ({
  requireAdmin: (l: App.Locals) => {
    if (l.user?.role !== 'admin') throw Object.assign(new Error('forbidden'), { status: 403 });
    return l.user;
  },
}));
vi.mock('$server/db/pg-client', () => {
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => h.existing }) }) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        h.inserts.push({ table, values });
        return { onConflictDoUpdate: async () => {} };
      },
    }),
  };
  return {
    getCoreDb: () => ({
      execute: h.execute,
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    }),
  };
});

import {
  orgAllows,
  orgAllowsForConfig,
  orgFeatureCheck,
  requireFeature,
  requireOrgFeature,
  resolveEntitlements,
  setOrgPlan,
  skippedField,
} from './entitlements.service';
import { orgPlans, orgPlanEvents } from '$server/db/pg-schema/entitlements';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const admin = (supabaseId?: string) =>
  ({ user: { id: 'u1', supabaseId, role: 'admin' }, tenantCtx: { tenantId: OTHER } }) as App.Locals;
const member = () =>
  ({ user: { id: 'u2', role: 'user' }, tenantCtx: { tenantId: ORG } }) as App.Locals;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.existing = [];
  h.inserts = [];
  h.cacheFail = false;
  h.execute.mockResolvedValue([]); // no org_plans row => Base
});

describe('flag off', () => {
  it('returns the full catalog for an org with no row, and requireFeature only logs', async () => {
    const r = await resolveEntitlements(ORG);
    expect(r.features).toEqual(['ai', 'ai.chat', 'ai.proactive', 'marketplace']);
    expect(r.enforced).toBe(false);
    await expect(requireFeature(member(), 'ai')).resolves.toBeUndefined();
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        'entitlement.would_deny',
        expect.stringContaining('"feature":"ai"'),
      ),
    );
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('a request never waits on the shadow lookup (a hung DB does not hang the route)', async () => {
    h.execute.mockImplementation(() => new Promise(() => {}));
    await expect(requireFeature(member(), 'ai')).resolves.toBeUndefined();
    await expect(requireOrgFeature(ORG, 'ai')).resolves.toBeUndefined();
  });
});

describe('flag on', () => {
  beforeEach(() => {
    h.env.ENTITLEMENTS_ENFORCED = 'true';
  });

  it('Base org: 403 premium_required and a PostHog denial', async () => {
    await expect(requireFeature(member(), 'ai', 'test')).rejects.toMatchObject({
      status: 403,
      body: { code: 'premium_required', feature: 'ai' },
    });
    expect(h.capture).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'entitlement_denied', distinctId: `org:${ORG}` }),
    );
  });

  it('Premium org passes', async () => {
    h.execute.mockResolvedValue([{ kind: 'business', plan_key: 'premium' }]);
    await expect(requireOrgFeature(ORG, 'ai.chat')).resolves.toBeUndefined();
    expect((await resolveEntitlements(ORG)).planSource).toBe('row');
  });

  it('no tenant => 401', async () => {
    await expect(requireFeature({} as App.Locals, 'ai')).rejects.toMatchObject({ status: 401 });
  });

  it('lookup error: UI path gets the full catalog, request gate fails closed', async () => {
    h.execute.mockRejectedValue(Object.assign(new Error('relation missing'), { code: '42P01' }));
    const r = await resolveEntitlements(ORG);
    expect(r.lookupError).toBe(true);
    expect(r.features).toContain('ai');
    await expect(requireFeature(member(), 'ai')).rejects.toMatchObject({ status: 503 });
  });

  it('a tick-style resolve never sends a PostHog event, even on lookup error', async () => {
    h.cacheFail = true;
    await resolveEntitlements(ORG);
    expect(h.capture).not.toHaveBeenCalled();
  });
});

describe('setOrgPlan', () => {
  it('invalidates the TARGET org tag, not the caller tenant, with no other side effects', async () => {
    const r = await setOrgPlan(
      admin('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
      ORG,
      'premium',
      ' trial ',
    );
    expect(r.changed).toBe(true);
    expect(h.invalidateTags).toHaveBeenCalledTimes(1);
    expect(h.invalidateTags).toHaveBeenCalledWith([`tenant:${ORG}:entitlements`]);
  });

  it('writes the plan row and an audit row with actor, from/to and note', async () => {
    h.existing = [{ planKey: 'premium' }];
    await setOrgPlan(admin('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), ORG, 'base', 'downgrade');
    const event = h.inserts.find((i) => i.table === orgPlanEvents)!.values;
    expect(event).toMatchObject({
      orgId: ORG,
      fromPlan: 'premium',
      toPlan: 'base',
      actorProfileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      note: 'downgrade',
    });
    expect(h.inserts.find((i) => i.table === orgPlans)!.values).toMatchObject({
      orgId: ORG,
      planKey: 'base',
    });
  });

  it('a system write has a null actor plus a note', async () => {
    await setOrgPlan(admin(undefined), ORG, 'premium', 'launch-backfill');
    expect(h.inserts.find((i) => i.table === orgPlanEvents)!.values).toMatchObject({
      fromPlan: null,
      actorProfileId: null,
      note: 'launch-backfill',
    });
  });

  it('is a no-op (no rows, no invalidation) when the plan is unchanged', async () => {
    const r = await setOrgPlan(admin(), ORG, 'base');
    expect(r.changed).toBe(false);
    expect(h.inserts).toHaveLength(0);
    expect(h.invalidateTags).not.toHaveBeenCalled();
  });

  it('rejects non-admins and unknown plans', async () => {
    await expect(setOrgPlan(member(), ORG, 'premium')).rejects.toMatchObject({ status: 403 });
    await expect(setOrgPlan(admin(), ORG, 'gold')).rejects.toMatchObject({ status: 400 });
    expect(h.inserts).toHaveLength(0);
  });
});

describe('orgAllows (ticks, jobs, gateway mirrors)', () => {
  it('flag off: true with no lookup', async () => {
    expect(await orgAllows(ORG, 'ai.proactive', 'tick:x')).toBe(true);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('enforced: Base false, Premium true, lookup error false; never a PostHog event', async () => {
    h.env.ENTITLEMENTS_ENFORCED = 'true';
    expect(await orgAllows(ORG, 'ai.proactive', 'tick:x')).toBe(false);
    h.execute.mockResolvedValue([{ kind: 'business', plan_key: 'premium' }]);
    expect(await orgAllows(ORG, 'ai.proactive', 'tick:x')).toBe(true);
    h.cacheFail = true;
    expect(await orgAllows(ORG, 'ai.proactive', 'tick:x')).toBe(false);
    expect(h.capture).not.toHaveBeenCalled();
  });
  it('orgFeatureCheck names a lookup error so jobs can retry instead of finishing', async () => {
    expect(await orgFeatureCheck(ORG, 'ai', 'job:x')).toBeNull();
    h.env.ENTITLEMENTS_ENFORCED = 'true';
    expect(await orgFeatureCheck(ORG, 'ai', 'job:x')).toBe('not_in_plan');
    h.cacheFail = true;
    expect(await orgFeatureCheck(ORG, 'ai', 'job:x')).toBe('lookup_error');
  });
  it('skippedField only adds the key when something was skipped', () => {
    expect(skippedField(0)).toEqual({});
    expect(skippedField(2)).toEqual({ skippedByEntitlement: 2 });
  });
});

describe('orgAllowsForConfig (gateway channel mirror: an outage never demotes a paying org)', () => {
  const org = (n: number) => `33333333-3333-3333-3333-33333333333${n}`;
  beforeEach(() => {
    h.env.ENTITLEMENTS_ENFORCED = 'true';
  });
  it('flag off: true with no lookup', async () => {
    delete h.env.ENTITLEMENTS_ENFORCED;
    expect(await orgAllowsForConfig(org(1), 'ai', 'channels.resolved')).toBe(true);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('enforced: Base false, Premium true', async () => {
    expect(await orgAllowsForConfig(org(2), 'ai', 'channels.resolved')).toBe(false);
    h.execute.mockResolvedValue([{ kind: 'business', plan_key: 'premium' }]);
    expect(await orgAllowsForConfig(org(3), 'ai', 'channels.resolved')).toBe(true);
  });
  it('lookup error with no earlier answer: true, logged as lookup_error', async () => {
    h.cacheFail = true;
    expect(await orgAllowsForConfig(org(4), 'ai', 'channels.resolved')).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      'entitlement.lookup_error',
      expect.stringContaining('"fallback":"allow"'),
    );
  });
  it('lookup error after an answer: the last answer (Base stays false, Premium stays true)', async () => {
    expect(await orgAllowsForConfig(org(5), 'ai', 'channels.resolved')).toBe(false);
    h.execute.mockResolvedValue([{ kind: 'business', plan_key: 'premium' }]);
    expect(await orgAllowsForConfig(org(6), 'ai', 'channels.resolved')).toBe(true);
    h.cacheFail = true;
    expect(await orgAllowsForConfig(org(5), 'ai', 'channels.resolved')).toBe(false);
    expect(await orgAllowsForConfig(org(6), 'ai', 'channels.resolved')).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      'entitlement.lookup_error',
      expect.stringContaining('"fallback":"last_answer"'),
    );
  });
});
