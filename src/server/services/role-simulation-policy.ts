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
