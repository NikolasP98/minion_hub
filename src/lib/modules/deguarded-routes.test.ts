import { describe, it, expect } from 'vitest';
import { resolveModuleForPath, MODULE_MANIFEST, type ModuleId } from './availability';

/**
 * Coverage pin for the routing-simplification refactor (S2/R2).
 *
 * This refactor DELETED an inline `isModuleEnabled(...)` 404 from every route
 * below and moved the decision into the `(app)` hook guard. That guard is
 * fail-OPEN for unmapped paths (`isAppRouteBlocked` returns false when
 * `resolveModuleForPath` finds nothing), so a manifest prefix that is dropped
 * or renamed does not fail loudly — it silently un-gates the route.
 *
 * Each entry is the route whose inline gate was removed, paired with the
 * module that gate required. The route must resolve to a manifest entry that
 * requires it, directly or through the `requires` chain.
 */
const DEGUARDED_ROUTES: ReadonlyArray<readonly [path: string, requiredModule: string]> = [
  ['/finances', 'finances'],
  ['/finances/invoices', 'finances'],
  ['/finances/invoices/abc', 'finances'],
  ['/finances/settings', 'finances'],
  ['/pos', 'pos'],
  ['/pos/sell', 'pos'],
  // Composite gate: the inline check was bothEnabled('pos', 'scheduling').
  ['/pos/appointments', 'pos'],
  ['/pos/appointments', 'scheduling'],
  ['/sales', 'sales'],
  ['/sales/abc', 'sales'],
  ['/scheduling', 'scheduling'],
  ['/scheduling/bookings', 'scheduling'],
  ['/scheduling/calendar', 'scheduling'],
  ['/scheduling/event-types', 'scheduling'],
  ['/scheduling/links', 'scheduling'],
  ['/scheduling/reminders', 'scheduling'],
  ['/scheduling/resources', 'scheduling'],
  ['/socials', 'ads'],
  ['/socials/campaigns', 'ads'],
  ['/socials/campaigns/abc', 'ads'],
  ['/socials/posts', 'ads'],
  ['/socials/posts/abc', 'ads'],
  ['/socials/settings', 'ads'],
  ['/stock', 'stock'],
  ['/stock/commitments', 'stock'],
  ['/stock/entries', 'stock'],
  ['/stock/entries/abc', 'stock'],
  ['/stock/entries/new', 'stock'],
  ['/stock/items', 'stock'],
  ['/stock/items/abc', 'stock'],
  ['/stock/warehouses', 'stock'],
  ['/support', 'support'],
  ['/support/abc', 'support'],
];

/** `moduleId` itself, plus everything it transitively `requires`. */
function requirementChain(moduleId: string, seen = new Set<string>()): Set<string> {
  if (seen.has(moduleId)) return seen;
  seen.add(moduleId);
  // Manifest entries are a heterogeneous const union — only some declare
  // `requires`, so read it through a widened view rather than off the union.
  const entry = MODULE_MANIFEST[moduleId as ModuleId] as
    { requires?: readonly string[] } | undefined;
  for (const dep of entry?.requires ?? []) requirementChain(dep, seen);
  return seen;
}

describe('routes that lost their inline module guard', () => {
  it.each(DEGUARDED_ROUTES)('%s is still gated on %s by the central map', (path, required) => {
    const match = resolveModuleForPath(path);
    // A null match means the hook guard lets this route through for every org.
    expect(match, `${path} resolves to no module — the central guard fails open`).not.toBeNull();
    expect(
      requirementChain(match!.moduleId),
      `${path} → ${match!.moduleId}, which does not require ${required}`,
    ).toContain(required);
  });
});
