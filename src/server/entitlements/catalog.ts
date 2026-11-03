/** Plan and feature catalog (spec 043). A typed table in code, like RBAC. */
import type { OrgKind } from '$lib/org-kind';

export const PLANS = {
  base: { label: 'Base', description: 'Platform and business modules, no AI.' },
  premium: { label: 'Premium', description: 'Everything in Base plus AI and the marketplace.' },
} as const;
export type PlanKey = keyof typeof PLANS;

export interface EntitlementSnapshot {
  plan: PlanKey;
  kind: OrgKind;
}
export interface RuleCtx {
  plan: PlanKey;
  kind: OrgKind;
  /** Reads only keys earlier in FEATURES order, so rules cannot loop. */
  has: (featureKey: string) => boolean;
}
export type Rule = (ctx: RuleCtx) => boolean;

export const all =
  (...rules: Rule[]): Rule =>
  (c) =>
    rules.every((r) => r(c));
export const any =
  (...rules: Rule[]): Rule =>
  (c) =>
    rules.some((r) => r(c));
export const not =
  (rule: Rule): Rule =>
  (c) =>
    !rule(c);
export const plan =
  (...keys: PlanKey[]): Rule =>
  (c) =>
    keys.includes(c.plan);
export const kind =
  (...kinds: OrgKind[]): Rule =>
  (c) =>
    kinds.includes(c.kind);
export const has =
  (featureKey: string): Rule =>
  (c) =>
    c.has(featureKey);

export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  rule?: Rule;
}

/** Ordered: a parent precedes its children. No feature has a rule at launch. */
export const FEATURES: readonly FeatureDef[] = [
  { key: 'ai', label: 'AI', description: 'Agents, chat, brains and every model call.' },
  { key: 'ai.chat', label: 'AI chat', description: 'The assistant chat.' },
  {
    key: 'ai.proactive',
    label: 'Proactive AI',
    description: 'Pulse, digests and background AI jobs.',
  },
  { key: 'marketplace', label: 'Marketplace', description: 'Agent marketplace.' },
];

/** The reviewed mapping. Child keys inherit from their parent, so only top-level keys are listed. */
export const PLAN_DEFAULTS: Record<PlanKey, readonly string[]> = {
  premium: ['ai', 'marketplace'],
  base: [],
};
