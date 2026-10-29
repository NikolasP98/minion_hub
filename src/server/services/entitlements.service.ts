/**
 * Org entitlements (spec 043): which features an org's plan grants. Inert until
 * ENTITLEMENTS_ENFORCED=true; with it off every org gets the full catalog and
 * `requireFeature` only logs `entitlement.would_deny`.
 */
import { error } from '@sveltejs/kit';
import { eq, desc, sql } from 'drizzle-orm';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { orgPlans, orgPlanEvents } from '$server/db/pg-schema/entitlements';
import { requireAdmin } from '$server/auth/authorize';
import { captureServerEvent } from '$lib/server/posthog';
import type { OrgKind } from '$lib/org-kind';
import { PLANS, type PlanKey } from '$server/entitlements/catalog';
import {
  ALL_FEATURE_KEYS,
  expandFeatures,
  isEntitled,
  normalizePlan,
} from '$server/entitlements/evaluate';

export interface ResolvedEntitlements {
  plan: PlanKey;
  planSource: 'row' | 'default';
  features: string[];
  enforced: boolean;
  /** True when the lookup failed; callers apply the per-surface failure policy. */
  lookupError: boolean;
}

interface PlanLookup {
  plan: PlanKey;
  planSource: 'row' | 'default';
  kind: OrgKind;
}

export function isEnforced(): boolean {
  return env.ENTITLEMENTS_ENFORCED === 'true';
}

const entitlementTags = (orgId: string) => tags.tenantDomain(orgId, 'entitlements');

async function loadPlan(orgId: string): Promise<PlanLookup> {
  const rows = (await getCoreDb().execute(
    sql`select o.kind, p.plan_key from organizations o
        left join org_plans p on p.org_id = o.id where o.id = ${orgId}::uuid limit 1`,
  )) as unknown as Array<{ kind: string | null; plan_key: string | null }>;
  const row = rows[0];
  if (row?.plan_key && !Object.hasOwn(PLANS, row.plan_key)) {
    console.warn(
      `[entitlements] unknown plan key "${row.plan_key}" for ${orgId}; treating as base`,
    );
  }
  return {
    plan: normalizePlan(row?.plan_key),
    planSource: row?.plan_key ? 'row' : 'default',
    kind: row?.kind === 'personal' ? 'personal' : 'business',
  };
}

/** The cached plan lookup; null on any DB or cache error (logged as lookup_error). */
async function lookupPlan(orgId: string): Promise<PlanLookup | null> {
  try {
    return await cached(
      keys.hub('entitlements', { t: orgId }),
      { ttl: '5m', swr: '1m', tags: entitlementTags(orgId) },
      () => loadPlan(orgId),
    );
  } catch (err) {
    console.error('[entitlements] lookup_error', { orgId, err });
    return null;
  }
}

export async function resolveEntitlements(orgId: string): Promise<ResolvedEntitlements> {
  const enforced = isEnforced();
  // Flag off: full catalog with zero I/O (the hook calls this on every app page load; prod cache is noop).
  // `plan` is then not looked up and reads 'base'; nothing acts on it while unenforced.
  if (!enforced) {
    return {
      plan: 'base',
      planSource: 'default',
      features: [...ALL_FEATURE_KEYS],
      enforced,
      lookupError: false,
    };
  }
  const lookup = await lookupPlan(orgId);
  if (!lookup) {
    // A paying org is never demoted by an outage in the UI path; request gates check lookupError.
    return {
      plan: 'base',
      planSource: 'default',
      features: [...ALL_FEATURE_KEYS],
      enforced,
      lookupError: true,
    };
  }
  return {
    plan: lookup.plan,
    planSource: lookup.planSource,
    features: expandFeatures(lookup),
    enforced,
    lookupError: false,
  };
}

async function checkFeature(
  orgId: string | undefined,
  feature: string,
  surface: string,
  locals?: App.Locals,
): Promise<void> {
  const enforced = isEnforced();
  if (!orgId) {
    // Without an org we cannot know the plan. Flag off keeps today's behavior.
    if (enforced) throw error(401, 'Authentication required');
    return;
  }
  const lookup = await lookupPlan(orgId);
  let reason: 'not_in_plan' | 'rule_false' | 'lookup_error' | null = null;
  if (!lookup) {
    reason = 'lookup_error';
  } else {
    const verdict = isEntitled(lookup, feature);
    if (!verdict.allowed) reason = verdict.reason as 'not_in_plan' | 'rule_false';
  }
  if (!reason) return;
  console.warn(
    enforced ? 'entitlement.denied' : 'entitlement.would_deny',
    JSON.stringify({ feature, orgId, plan: lookup?.plan, reason, surface }),
  );
  if (!enforced) return;
  captureServerEvent({
    event: 'entitlement_denied',
    distinctId: `org:${orgId}`,
    properties: {
      org_id: orgId,
      actor_id: locals?.user?.id,
      entitlement_feature: feature,
      entitlement_reason: reason,
      entitlement_surface: surface,
    },
  });
  if (reason === 'lookup_error') {
    throw error(503, { message: 'Plan lookup unavailable', code: 'entitlements_unavailable' });
  }
  throw error(403, {
    message: 'This feature needs the Premium plan',
    code: 'premium_required',
    feature,
  });
}

/** First line of every gated route. Throws only when enforced. */
export function requireFeature(
  locals: App.Locals,
  feature: string,
  surface = 'route',
): Promise<void> {
  return checkFeature(locals.tenantCtx?.tenantId, feature, surface, locals);
}

/** Same check for routes that resolve their org another way (gateway callbacks). */
export function requireOrgFeature(orgId: string, feature: string, surface = 'route') {
  return checkFeature(orgId, feature, surface);
}

export async function setOrgPlan(
  adminLocals: App.Locals,
  orgId: string,
  planKey: string,
  note?: string,
): Promise<{ changed: boolean }> {
  const admin = requireAdmin(adminLocals);
  if (!Object.hasOwn(PLANS, planKey)) throw error(400, `Unknown plan "${planKey}"`);
  const actor = admin.supabaseId ?? null;
  const cleanNote = note?.trim() || null;
  const changed = await getCoreDb().transaction(async (tx) => {
    const [existing] = await tx
      .select({ planKey: orgPlans.planKey })
      .from(orgPlans)
      .where(eq(orgPlans.orgId, orgId))
      .for('update');
    const from = existing?.planKey ?? null;
    if ((from ?? 'base') === planKey) return false;
    await tx
      .insert(orgPlans)
      .values({ orgId, planKey, setByProfileId: actor, setNote: cleanNote })
      .onConflictDoUpdate({
        target: orgPlans.orgId,
        set: { planKey, setByProfileId: actor, setNote: cleanNote, setAt: new Date() },
      });
    await tx.insert(orgPlanEvents).values({
      orgId,
      fromPlan: from,
      toPlan: planKey,
      actorProfileId: actor,
      note: cleanNote,
    });
    return true;
  });
  // The TARGET org's tag, not the caller's tenant. No channel signal: channel AI follows the mirror tick.
  if (changed) await invalidateTags(entitlementTags(orgId));
  return { changed };
}

export interface OrgPlanListing {
  orgId: string;
  kind: OrgKind;
  planKey: string | null;
  setAt: Date | null;
  setNote: string | null;
}

/** Every org with its plan row (platform-admin callers gate access). */
export async function listOrgPlans(): Promise<OrgPlanListing[]> {
  const rows = (await getCoreDb().execute(
    sql`select o.id, o.kind, p.plan_key, p.set_at, p.set_note
        from organizations o left join org_plans p on p.org_id = o.id`,
  )) as unknown as Array<{
    id: string;
    kind: string | null;
    plan_key: string | null;
    set_at: Date | null;
    set_note: string | null;
  }>;
  return rows.map((r) => ({
    orgId: r.id,
    kind: r.kind === 'personal' ? 'personal' : 'business',
    planKey: r.plan_key,
    setAt: r.set_at,
    setNote: r.set_note,
  }));
}

export async function listPlanEvents(limit = 50) {
  return getCoreDb()
    .select()
    .from(orgPlanEvents)
    .orderBy(desc(orgPlanEvents.createdAt))
    .limit(limit);
}
