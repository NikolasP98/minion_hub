import {
  ACTIONS,
  MODULES,
  buildCapabilities,
  type Capabilities,
  type CapabilityOverrideRow,
} from './rbac.service';
import { ALL_SUBRESOURCES } from '$lib/permissions';
import { SCREEN_DESIGN_MANIFEST } from '$lib/routes/route-design-manifest';
import { type NavConfig } from '$lib/nav/custom-sections';
import { simulationRouteAllowed, simulationPageAllowed } from './simulation-navigation';

/** A role is selectable only when its entire authority fits within the actual actor. */
export function roleFitsActualAuthority(input: {
  actual: Capabilities;
  selected: Capabilities;
  rules: CapabilityOverrideRow[];
  nav: NavConfig;
  platformAdmin: boolean;
}): boolean {
  if (input.platformAdmin) return true;
  const { actual, selected, nav } = input;
  const keys = new Set<string>([
    ...MODULES,
    ...ALL_SUBRESOURCES.map((s) => s.key),
    ...input.rules.map((r) => r.module),
  ]);
  for (const section of nav.sections) {
    if (
      actual.explicitView(`section:${section.id}`) === false &&
      selected.explicitView(`section:${section.id}`) !== false
    )
      return false;
  }
  for (const key of keys) {
    if (/^(?:page|section):/.test(key)) continue;
    if (ACTIONS.some((action) => selected.can(key, action) && !actual.can(key, action)))
      return false;
    if (
      selected.can(key, 'view') &&
      ((actual.ownerScoped(key) && !selected.ownerScoped(key)) ||
        selected.fieldLevel(key) > actual.fieldLevel(key))
    )
      return false;
  }
  const actualContext = { nav, capabilities: actual },
    selectedContext = { nav, capabilities: selected };
  if (
    !SCREEN_DESIGN_MANIFEST.filter((s) => !s.pattern.includes('[')).every(
      (s) =>
        !simulationRouteAllowed(s.pattern, selectedContext) ||
        simulationRouteAllowed(s.pattern, actualContext),
    )
  )
    return false;
  for (const section of nav.sections)
    for (const page of section.pages)
      if (
        simulationPageAllowed(page, section, selectedContext) &&
        !simulationPageAllowed(page, section, actualContext)
      )
        return false;
  for (const pages of Object.values(nav.builtinSections))
    for (const page of pages)
      if (
        simulationPageAllowed(page, undefined, selectedContext) &&
        !simulationPageAllowed(page, undefined, actualContext)
      )
        return false;
  return true;
}
export const noSimulationCapabilities = () => buildCapabilities([], []);

/** Bound only new recipient rights after role unions; retained higher permissions do not block a reduction. */
export function recipientGrantFitsActualAuthority(input: {
  before: Capabilities;
  after: Capabilities;
  actual: Capabilities;
  rules: CapabilityOverrideRow[];
  nav: NavConfig;
  platformAdmin?: boolean;
  ranks?: { before: number; after: number; actual: number };
}): boolean {
  if (input.platformAdmin) return true;
  const { before, after, actual, nav } = input;
  if (input.ranks) {
    const ranks = input.ranks;
    if (
      [ranks.before, ranks.after, ranks.actual].some(
        (rank) => !Number.isSafeInteger(rank) || rank < 0,
      )
    )
      return false;
    const management = [
      ['roles', 'create'],
      ['roles', 'edit'],
      ['roles', 'delete'],
      ['users', 'manage'],
    ] as const;
    if (
      management.some(
        ([module, action]) =>
          after.can(module, action) && (!before.can(module, action) || ranks.after > ranks.before),
      ) &&
      ranks.after > ranks.actual
    )
      return false;
  }

  const keys = new Set<string>([
    ...MODULES,
    ...ALL_SUBRESOURCES.map((row) => row.key),
    ...input.rules.map((row) => row.module),
  ]);
  for (const key of keys) {
    if (/^(?:page|section):/.test(key)) continue;
    const scopeWidened = before.ownerScoped(key) && !after.ownerScoped(key);
    const fieldsWidened = after.fieldLevel(key) > before.fieldLevel(key);
    for (const action of ACTIONS) {
      if (!after.can(key, action)) continue;
      const readLike = action === 'view' || action === 'export';
      const newlyEffective =
        !before.can(key, action) || scopeWidened || (readLike && fieldsWidened);
      if (!newlyEffective) continue;
      if (!actual.can(key, action) || (actual.ownerScoped(key) && !after.ownerScoped(key)))
        return false;
      if (readLike && after.fieldLevel(key) > actual.fieldLevel(key)) return false;
    }
  }
  for (const section of nav.sections) {
    const key = `section:${section.id}`;
    if (
      before.explicitView(key) === false &&
      after.explicitView(key) !== false &&
      actual.explicitView(key) === false
    )
      return false;
  }
  const beforeContext = { nav, capabilities: before },
    afterContext = { nav, capabilities: after },
    actualContext = { nav, capabilities: actual };
  for (const screen of SCREEN_DESIGN_MANIFEST.filter((screen) => !screen.pattern.includes('[')))
    if (
      simulationRouteAllowed(screen.pattern, afterContext) &&
      !simulationRouteAllowed(screen.pattern, beforeContext) &&
      !simulationRouteAllowed(screen.pattern, actualContext)
    )
      return false;
  for (const section of nav.sections)
    for (const page of section.pages)
      if (
        simulationPageAllowed(page, section, afterContext) &&
        !simulationPageAllowed(page, section, beforeContext) &&
        !simulationPageAllowed(page, section, actualContext)
      )
        return false;
  for (const pages of Object.values(nav.builtinSections))
    for (const page of pages)
      if (
        simulationPageAllowed(page, undefined, afterContext) &&
        !simulationPageAllowed(page, undefined, beforeContext) &&
        !simulationPageAllowed(page, undefined, actualContext)
      )
        return false;
  return true;
}
