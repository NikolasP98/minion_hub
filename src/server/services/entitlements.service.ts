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
import { EntitlementError } from '$server/entitlements/errors';
import { currentAiUsageScope } from '$server/ai-usage';
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

/** The last successful lookup per org on this instance, for config paths (see orgAllowsForConfig). */
const lastAnswer = new Map<string, PlanLookup>();

/** The cached plan lookup; null on any DB or cache error (logged as lookup_error). */
async function lookupPlan(orgId: string): Promise<PlanLookup | null> {
  try {
    const lookup = await cached(
      keys.hub('entitlements', { t: orgId }),
      { ttl: '5m', swr: '1m', tags: entitlementTags(orgId) },
      () => loadPlan(orgId),
    );
    lastAnswer.set(orgId, lookup);
    return lookup;
  } catch (err) {
    console.error('[entitlements] lookup_error', { orgId, err });
    return null;
  }
}

export async function resolveEntitlements(orgId: string): Promise<ResolvedEntitlements> {
  const enforced = isEnforced();
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
    // Flag off: full catalog on every surface.
    features: enforced ? expandFeatures(lookup) : [...ALL_FEATURE_KEYS],
    enforced,
    lookupError: false,
  };
}

type DenyReason = 'not_in_plan' | 'rule_false' | 'lookup_error';

/** Why `orgId` may not use `feature`, or null when it may. A lookup error never grants. */
async function denyReason(
  orgId: string,
  feature: string,
): Promise<{ reason: DenyReason | null; plan: PlanKey | undefined }> {
  const lookup = await lookupPlan(orgId);
  if (!lookup) return { reason: 'lookup_error', plan: undefined };
  const verdict = isEntitled(lookup, feature);
  return {
    reason: verdict.allowed ? null : (verdict.reason as 'not_in_plan' | 'rule_false'),
    plan: lookup.plan,
  };
}

function captureDenial(
  orgId: string,
  feature: string,
  reason: string,
  surface: string,
  actorId?: string,
) {
  captureServerEvent({
    event: 'entitlement_denied',
    distinctId: `org:${orgId}`,
    properties: {
      org_id: orgId,
      actor_id: actorId,
      entitlement_feature: feature,
      entitlement_reason: reason,
      entitlement_surface: surface,
    },
  });
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
  if (!enforced) {
    // Shadow log only: a request never waits on the plan lookup while the flag is off.
    void denyReason(orgId, feature).then(({ reason, plan }) => {
      if (reason)
        console.warn(
          'entitlement.would_deny',
          JSON.stringify({ feature, orgId, plan, reason, surface }),
        );
    });
    return;
  }
  const { reason, plan } = await denyReason(orgId, feature);
  if (!reason) return;
  console.warn('entitlement.denied', JSON.stringify({ feature, orgId, plan, reason, surface }));
  captureDenial(orgId, feature, reason, surface, locals?.user?.id);
  if (reason === 'lookup_error') {
    throw error(503, { message: 'Plan lookup unavailable', code: 'entitlements_unavailable' });
  }
  throw error(403, {
    message: 'This feature needs the Premium plan',
    code: 'premium_required',
    feature,
  });
}

/**
 * Background check for ticks, jobs and the gateway mirrors: true when `orgId` may use `feature`.
 * Flag off → true with no lookup. A lookup error denies. Logs the skip; never sends PostHog.
 */
export async function orgAllows(orgId: string, feature: string, surface: string): Promise<boolean> {
  return !(await orgFeatureCheck(orgId, feature, surface));
}

/** `orgAllows` with the reason, so a job can tell a transient `lookup_error` from a real denial. */
export async function orgFeatureCheck(
  orgId: string,
  feature: string,
  surface: string,
): Promise<DenyReason | null> {
  if (!isEnforced()) return null;
  const { reason, plan } = await denyReason(orgId, feature);
  if (reason)
    console.warn('entitlement.skipped', JSON.stringify({ feature, orgId, plan, reason, surface }));
  return reason;
}

/**
 * Config paths (the gateway channel mirror): like `orgAllows`, but a lookup error never demotes a
 * paying org (resolution decision 1). It answers from this instance's last answer, else `true`.
 */
export async function orgAllowsForConfig(
  orgId: string,
  feature: string,
  surface: string,
): Promise<boolean> {
  const reason = await orgFeatureCheck(orgId, feature, surface);
  if (reason !== 'lookup_error') return !reason;
  const last = lastAnswer.get(orgId);
  console.warn(
    'entitlement.lookup_error',
    JSON.stringify({ feature, orgId, surface, fallback: last ? 'last_answer' : 'allow' }),
  );
  return last ? isEntitled(last, feature).allowed : true;
}

/** `{skippedByEntitlement}` only when something was skipped, so flag-off tick responses keep their shape. */
export function skippedField(count: number): { skippedByEntitlement?: number } {
  return count ? { skippedByEntitlement: count } : {};
}

/**
 * The model-call backstop (`llm.ts` usage middleware, embeddings, assistant router). Flag off → no-op.
 * Org in the AI usage scope without `ai`, or a lookup error → `EntitlementError`. A signed-in scope
 * with no org → denied. No scope, or an unauthenticated scope with no org (scripts, platform jobs)
 * → allowed and logged.
 */
export async function assertAiCallAllowed(surface: string): Promise<void> {
  if (!isEnforced()) return;
  const scope = currentAiUsageScope();
  const orgId = scope?.orgId ?? null;
  if (!orgId) {
    const log = { feature: 'ai', surface, route: scope?.route ?? null };
    if (scope?.authenticated) {
      console.warn('entitlement.denied', JSON.stringify({ ...log, reason: 'no_org' }));
      throw new EntitlementError('ai', 'no_org');
    }
    console.info('entitlement.unscoped_model_call', JSON.stringify(log));
    return;
  }
  const { reason, plan } = await denyReason(orgId, 'ai');
  if (!reason) return;
  console.warn(
    'entitlement.denied',
    JSON.stringify({ feature: 'ai', orgId, plan, reason, surface }),
  );
  // PostHog only for request denials; ticks and jobs run unauthenticated scopes.
  if (scope?.authenticated) captureDenial(orgId, 'ai', reason, surface);
  throw new EntitlementError('ai', reason);
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
