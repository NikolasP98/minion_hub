import { FEATURES, PLAN_DEFAULTS, PLANS, type EntitlementSnapshot, type PlanKey } from './catalog';

export type EntitlementReason = 'ok' | 'not_in_plan' | 'rule_false';
export interface EntitlementResult {
  allowed: boolean;
  reason: EntitlementReason;
}

/** An unknown plan key resolves as Base. */
export function normalizePlan(key: string | null | undefined): PlanKey {
  return key && Object.hasOwn(PLANS, key) ? (key as PlanKey) : 'base';
}

/** Evaluate every feature in catalog order (parents first). */
export function evaluateAll(snapshot: EntitlementSnapshot): Map<string, EntitlementResult> {
  const results = new Map<string, EntitlementResult>();
  const granted = PLAN_DEFAULTS[snapshot.plan] ?? [];
  for (const f of FEATURES) {
    const dot = f.key.lastIndexOf('.');
    const parent = dot === -1 ? null : f.key.slice(0, dot);
    const inPlan =
      parent === null ? granted.includes(f.key) : results.get(parent)?.allowed === true;
    let result: EntitlementResult = inPlan
      ? { allowed: true, reason: 'ok' }
      : { allowed: false, reason: 'not_in_plan' };
    if (result.allowed && f.rule) {
      const ctx = {
        plan: snapshot.plan,
        kind: snapshot.kind,
        has: (k: string) => results.get(k)?.allowed === true, // later keys are absent
      };
      if (!f.rule(ctx)) result = { allowed: false, reason: 'rule_false' };
    }
    results.set(f.key, result);
  }
  return results;
}

export function isEntitled(snapshot: EntitlementSnapshot, feature: string): EntitlementResult {
  const hit = evaluateAll(snapshot).get(feature);
  if (hit) return hit;
  console.warn(`[entitlements] unknown feature key "${feature}"`);
  return { allowed: false, reason: 'not_in_plan' };
}

/** Every allowed key, in catalog order. This list is what the UI and the JWT carry. */
export function expandFeatures(snapshot: EntitlementSnapshot): string[] {
  return [...evaluateAll(snapshot)].filter(([, r]) => r.allowed).map(([k]) => k);
}

export const ALL_FEATURE_KEYS: string[] = FEATURES.map((f) => f.key);
