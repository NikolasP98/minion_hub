import { isModuleVisibleForKind, type OrgKind } from '$lib/org-kind';

/**
 * Module availability manifest — characterization of CURRENT hub behavior
 * only (no-behavior-change step, see
 * specs/2026-07-22-hub-routing-simplification-spec.md S1). Availability-only
 * per the v2 spec's R1: no `permission` field (RBAC stays in
 * `$lib/routes/route-access-registry`), no nav metadata (labels/icons/order
 * stay in `sections.ts`). This file is NOT wired into any route/hook yet —
 * that's a later step (S2).
 *
 * `kinds` mirrors `$lib/org-kind.ts` ORG_KIND_POLICY (business hides pulse;
 * personal hides pos/stock/workforce/support/memberships/sales/ads/team) — it
 * is NOT a new policy, just the same facts in per-module shape so a single
 * resolver can eventually replace both the nav-side `isModuleVisibleForKind`
 * calls and the route-side kind checks.
 *
 * S3/WP1 (specs/2026-07-22-personal-org-differentiation-spec.md R1): the
 * five additions (support/memberships/sales/ads/team) are a DELIBERATE
 * behavior change, not a characterization of pre-existing hiding — they were
 * previously visible to personal orgs at the route level (nav-hidden at
 * most). The route-guard hook (route-guard.ts, wired in hooks.server.ts)
 * enforces this as a 404, same mechanism as pos/stock/workforce.
 * `toggleId` is set only where a current route load actually calls
 * `isModuleEnabled`/`bothEnabled` for that id — see the per-entry notes below
 * for the (known, pre-existing) gaps where that's inconsistent with the
 * `settings/modules` toggle UI or with nav-hiding.
 */
export type ModuleAvailability = {
  /** Canonical (locale-stripped) app path prefixes that belong to this module. */
  appPrefixes: readonly string[];
  /** `app_modules` toggle id this module reads via modules.service. Absent = never gated by a toggle today. */
  toggleId?: string;
  /** Org kinds this module is available for. Absent = both kinds. */
  kinds?: readonly OrgKind[];
  /** Other module ids that must ALSO be available (composite gates, e.g. /pos/appointments). */
  requires?: readonly string[];
};

export const MODULE_MANIFEST = {
  crm: {
    appPrefixes: ['/crm'],
    // settings/modules exposes a toggle for 'crm', but NO current (app)/crm
    // route calls isModuleEnabled('crm') — pre-existing nav-hidden-but-
    // route-open gap (same class the routing-simplification spec calls out
    // for pos/stock/workforce). toggleId reflects intent/DB row identity,
    // not current route enforcement.
    toggleId: 'crm',
  },
  finances: {
    appPrefixes: ['/finances'],
    toggleId: 'finances',
  },
  // /socials is the route; the toggle/module id is 'ads' (sections.ts:161
  // moduleId override, socials/+page.server.ts:38 isModuleEnabled('ads')).
  // Legacy /ads/* 301-redirects to /socials/* (ads/+page.server.ts) and is
  // deliberately NOT an appPrefix here — R6 keeps redirect handling separate
  // from module-availability resolution.
  ads: {
    appPrefixes: ['/socials'],
    toggleId: 'ads',
    kinds: ['business'],
  },
  sales: {
    appPrefixes: ['/sales'],
    toggleId: 'sales',
    kinds: ['business'],
  },
  support: {
    appPrefixes: ['/support'],
    toggleId: 'support',
    kinds: ['business'],
  },
  scheduling: {
    appPrefixes: ['/scheduling'],
    toggleId: 'scheduling',
  },
  // No settings/modules toggle UI and no route-level isModuleEnabled call
  // found for 'memberships' today — always available (toggleId absent).
  memberships: {
    appPrefixes: ['/memberships'],
    kinds: ['business'],
  },
  // Core organization nav (route-access-registry gated, not module-toggle
  // gated) — was CORE_UNMANAGED until the S3/WP1 kind-matrix expansion added
  // team to personal.hiddenModules (org-kind.ts). /settings/team included so
  // the settings-side tab 404s too (longest-prefix, mirrors pulse's pattern).
  team: {
    appPrefixes: ['/team', '/settings/team'],
    kinds: ['business'],
  },
  // /settings/pulse must win over any (currently nonexistent) /settings
  // manifest entry via longest-prefix match. No toggleId: pulse has no
  // isModuleEnabled call, only the per-route `tenant.kind === 'business'`
  // 404 (pulse/+page.server.ts:18, settings/pulse/+page.server.ts:18).
  pulse: {
    appPrefixes: ['/pulse', '/settings/pulse'],
    kinds: ['personal'],
  },
  // pos/stock/workforce: org-kind.ts hides these for personal orgs, but
  // (per the routing-simplification spec's problem statement) that's
  // ENFORCED ONLY VIA NAV for pos/stock/workforce today — no route-level
  // kind check exists yet (unlike pulse). `kinds` here characterizes the
  // POLICY as it exists in org-kind.ts, not today's route enforcement gap.
  pos: {
    appPrefixes: ['/pos'],
    toggleId: 'pos',
    kinds: ['business'],
  },
  stock: {
    appPrefixes: ['/stock'],
    toggleId: 'stock',
    kinds: ['business'],
  },
  // No isModuleEnabled('workforce') call anywhere — /workforce/+layout.server.ts
  // only gates on org provisioning (ensureWorkforceCompany), not a toggle.
  // The nested /workforce/projects subpage gates on a DIFFERENT id,
  // 'projects' (workforce/projects/+page.server.ts:37) — that's a distinct
  // module identity from the top-level 'workforce' nav item and is left
  // unmapped here (ambiguity noted in the S1 report, not resolved by this
  // characterization step).
  workforce: {
    appPrefixes: ['/workforce'],
    kinds: ['business'],
  },
  // Composite: /pos/appointments needs BOTH pos and scheduling enabled
  // (pos/appointments/+page.server.ts:17, bothEnabled(ctx,'pos','scheduling')).
  // No own toggleId/kinds — isModuleAvailable composes them from `requires`.
  posAppointments: {
    appPrefixes: ['/pos/appointments'],
    requires: ['pos', 'scheduling'],
  },
} as const satisfies Record<string, ModuleAvailability>;

export type ModuleId = keyof typeof MODULE_MANIFEST;

/** Longest-prefix match of a canonical path against every manifest entry's `appPrefixes`. */
export function resolveModuleForPath(
  canonicalPath: string,
): { moduleId: ModuleId; entry: ModuleAvailability } | null {
  let best: { moduleId: ModuleId; entry: ModuleAvailability; prefix: string } | null = null;
  for (const [moduleId, entry] of Object.entries(MODULE_MANIFEST) as [ModuleId, ModuleAvailability][]) {
    for (const prefix of entry.appPrefixes) {
      const matches = canonicalPath === prefix || canonicalPath.startsWith(`${prefix}/`);
      if (matches && (!best || prefix.length > best.prefix.length)) {
        best = { moduleId, entry, prefix };
      }
    }
  }
  return best ? { moduleId: best.moduleId, entry: best.entry } : null;
}

/** Per-org module toggle map, matching listModuleStates()'s shape (modules.service.ts:26) — absent id = enabled. */
export type ModuleStates = Record<string, boolean>;

export type ModuleAvailabilityContext = {
  kind: OrgKind | undefined | null;
  moduleStates: ModuleStates;
};

// Local normalizer for MODULE_MANIFEST's `entry.kinds` membership check below
// (distinct from `isModuleVisibleForKind`, now imported for
// `effectiveModuleEnabled` — that one resolves against ORG_KIND_POLICY
// directly and doesn't need a manifest entry at all).
function resolvedKind(kind: OrgKind | undefined | null): OrgKind {
  return kind === 'personal' ? 'personal' : 'business';
}

/** Pure predicate: is `moduleId` available given the org's kind and module-toggle snapshot? Unknown ids are unmanaged → always available. */
export function isModuleAvailable(moduleId: string, ctx: ModuleAvailabilityContext): boolean {
  const entry = MODULE_MANIFEST[moduleId as ModuleId] as ModuleAvailability | undefined;
  if (!entry) return true;
  if (entry.kinds && !(entry.kinds as readonly OrgKind[]).includes(resolvedKind(ctx.kind))) return false;
  if (entry.toggleId && ctx.moduleStates[entry.toggleId] === false) return false;
  if (entry.requires) {
    for (const dep of entry.requires) {
      if (!isModuleAvailable(dep, ctx)) return false;
    }
  }
  return true;
}

/**
 * S3/WP1 R6 (specs/2026-07-22-personal-org-differentiation-spec.md): the one
 * helper cross-module services/UI should call to decide "is this feature
 * usable right now", composing BOTH gates the individual pieces already knew
 * about separately (kind-hidden ≠ module-disabled today —
 * `isModuleEnabled`/`modules.service.ts:26` treats an absent row as enabled
 * and never consulted kind at all). Unlike `isModuleAvailable`, this does NOT
 * require a `MODULE_MANIFEST` entry — `featureId` is looked up directly
 * against `ORG_KIND_POLICY` (via `isModuleVisibleForKind`) and `moduleStates`,
 * so it works for feature ids that aren't top-level routed modules too (e.g.
 * a Connections panel group key).
 */
export function effectiveModuleEnabled(
  kind: OrgKind | undefined | null,
  moduleStates: ModuleStates,
  featureId: string,
): boolean {
  return isModuleVisibleForKind(featureId, kind) && moduleStates[featureId] !== false;
}
