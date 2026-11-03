import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  setOrgPlan: vi.fn(async () => ({ changed: true })),
  sets: [] as unknown[],
}));
vi.mock('$server/services/organizations.service', () => ({
  listAllOrganizationsWithMemberCounts: async () => [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Acme', slug: 'acme', members: 3 },
  ],
}));
vi.mock('$server/services/entitlements.service', () => ({
  listOrgPlans: async () => [
    {
      orgId: '11111111-1111-1111-1111-111111111111',
      kind: 'business',
      planKey: 'premium',
      setAt: null,
      setNote: null,
    },
  ],
  listPlanEvents: async () => [],
  setOrgPlan: h.setOrgPlan,
}));

import { actions, load } from './+page.server';

const ORG = '11111111-1111-1111-1111-111111111111';
const locals = (role: 'admin' | 'user') => ({ user: { id: 'u', role } }) as App.Locals;
const req = (fields: Record<string, string>) =>
  ({ formData: async () => new URLSearchParams(fields) }) as unknown as Request;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (fn: any, args: object) => fn(args);

beforeEach(() => vi.clearAllMocks());

describe('/orgs/plans', () => {
  it('load: a non-admin gets 403', async () => {
    await expect(call(load, { locals: locals('user') })).rejects.toMatchObject({ status: 403 });
  });

  it('load: an admin sees plan, source and effective features', async () => {
    const data = await call(load, { locals: locals('admin') });
    expect(data.orgs[0]).toMatchObject({ plan: 'premium', planSource: 'row' });
    expect(data.orgs[0].effective.every((f: { allowed: boolean }) => f.allowed)).toBe(true);
  });

  it('setPlan: a non-admin gets 403 and nothing is written', async () => {
    await expect(
      call(actions.setPlan, {
        locals: locals('user'),
        request: req({ orgId: ORG, planKey: 'base' }),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.setOrgPlan).not.toHaveBeenCalled();
  });

  it('setPlan: an admin change goes through setOrgPlan (plan row + audit row)', async () => {
    const admin = locals('admin');
    const res = await call(actions.setPlan, {
      locals: admin,
      request: req({ orgId: ORG, planKey: 'base', note: 'trial over' }),
    });
    expect(res).toEqual({ ok: true });
    expect(h.setOrgPlan).toHaveBeenCalledWith(admin, ORG, 'base', 'trial over');
  });

  it('setPlan: rejects a malformed org id or unknown plan', async () => {
    const bad = await call(actions.setPlan, {
      locals: locals('admin'),
      request: req({ orgId: 'x', planKey: 'gold' }),
    });
    expect(bad.status).toBe(400);
    expect(h.setOrgPlan).not.toHaveBeenCalled();
  });
});
