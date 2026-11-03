import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { listAllOrganizationsWithMemberCounts } from '$server/services/organizations.service';
import { listOrgPlans, listPlanEvents, setOrgPlan } from '$server/services/entitlements.service';
import { PLANS, FEATURES } from '$server/entitlements/catalog';
import { evaluateAll, normalizePlan } from '$server/entitlements/evaluate';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('orgs.all', locals.user)) throw error(403, 'Admin access required');
  const [orgs, plans, events] = await Promise.all([
    listAllOrganizationsWithMemberCounts(),
    listOrgPlans(),
    listPlanEvents(50),
  ]);
  const byOrg = new Map(plans.map((p) => [p.orgId, p]));
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return {
    plans: Object.entries(PLANS).map(([key, p]) => ({ key, label: p.label })),
    orgs: orgs.map((o) => {
      const row = byOrg.get(o.id);
      const plan = normalizePlan(row?.planKey);
      const kind = row?.kind ?? 'business';
      // What the plan grants, computed by the pure evaluator, so it is accurate while the flag is off.
      const effective = [...evaluateAll({ plan, kind })].map(([key, r]) => ({
        key,
        label: FEATURES.find((f) => f.key === key)?.label ?? key,
        allowed: r.allowed,
        reason: r.reason,
      }));
      return {
        ...o,
        kind,
        plan,
        planSource: row?.planKey ? ('row' as const) : ('default' as const),
        effective,
      };
    }),
    events: events.map((e) => ({
      id: e.id,
      orgName: names.get(e.orgId) ?? e.orgId,
      fromPlan: e.fromPlan,
      toPlan: e.toPlan,
      note: e.note,
      byUser: e.actorProfileId !== null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
};

export const actions: Actions = {
  setPlan: async ({ request, locals }) => {
    if (!can('orgs.all', locals.user)) throw error(403, 'Admin access required');
    const form = await request.formData();
    const orgId = String(form.get('orgId') ?? '');
    const planKey = String(form.get('planKey') ?? '');
    const note = String(form.get('note') ?? '');
    if (!UUID_RE.test(orgId) || !Object.hasOwn(PLANS, planKey))
      return fail(400, { message: 'Invalid plan change' });
    await setOrgPlan(locals, orgId, planKey, note);
    return { ok: true };
  },
};
