import { canonicalPath, localizePath } from '$lib/canonical-path';
import { availableLanguageTags } from '$lib/paraglide/runtime';
import { SCREEN_DESIGN_MANIFEST } from '$lib/routes/route-design-manifest';
import {
  decideRouteAccess,
  patternMatches,
  routeAccessPolicyIdForPath,
} from '$lib/routes/route-access-policies';
import {
  floorApplies,
  moduleViewFloor,
  resolveNavInstance,
  type NavPage,
  type NavSection,
  type NavConfig,
} from '$lib/nav/custom-sections';
import { getModules } from '$lib/nav/modules';
import { personalNavigation, orderPersonalSections } from '$lib/nav/personal-navigation';
import { isAppRouteBlocked, type RouteGuardContext } from '$lib/modules/route-guard';
import { capsToLegacyPermissions } from './permissions.service';
import type { Capabilities } from './rbac.service';

const staticScreens = new Map(
  SCREEN_DESIGN_MANIFEST.filter((row) => !row.pattern.includes('[')).map((row) => [
    row.pattern,
    row,
  ]),
);
const permissionSets = new WeakMap<Capabilities, Set<string>>();
function permissionSet(caps: Capabilities) {
  let value = permissionSets.get(caps);
  if (!value) {
    value = new Set(capsToLegacyPermissions(caps));
    permissionSets.set(caps, value);
  }
  return value;
}
/** Accept only local paths; URL parsing canonicalizes traversal before policy evaluation. */
export function safeSimulationReturn(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u0020]/.test(value) ||
    /%(?:2f|5c|00|0a|0d)/i.test(value)
  )
    return null;
  try {
    const parsed = new URL(value, 'https://local.invalid');
    return parsed.origin === 'https://local.invalid'
      ? parsed.pathname + parsed.search + parsed.hash
      : null;
  } catch {
    return null;
  }
}
export interface SimulationNavigationContext {
  nav: NavConfig;
  capabilities: Capabilities;
  platformRole?: string;
  availability?: RouteGuardContext;
}
const targetDecisions = new WeakMap<Capabilities, Map<string, boolean>>();
const floors = new Map<string, string | null>();
function evaluateTarget(
  target: string,
  explicit: boolean | undefined,
  ctx: SimulationNavigationContext,
): boolean {
  if (!ctx.capabilities.roles.length && ctx.platformRole !== 'admin') return false;
  if (ctx.availability && isAppRouteBlocked(target, ctx.availability)) return false;
  const decide = () =>
    explicit ??
    decideRouteAccess(target, {
      authenticated: true,
      role: ctx.platformRole ?? 'user',
      permissions: permissionSet(ctx.capabilities),
      orgCapabilities: permissionSet(ctx.capabilities),
    }).allowed;
  if (ctx.availability) return decide();
  let cache = targetDecisions.get(ctx.capabilities);
  if (!cache) {
    cache = new Map();
    targetDecisions.set(ctx.capabilities, cache);
  }
  const key = `${ctx.platformRole ?? 'user'}:${String(explicit)}:${target}`;
  if (!cache.has(key)) cache.set(key, decide());
  return cache.get(key)!;
}
/** One canonical alias decision without resolving a serialized path for every role. */
export function simulationPageAllowed(
  page: NavPage,
  section: NavSection | undefined,
  ctx: SimulationNavigationContext,
): boolean {
  if (page.hidden || section?.hidden) return false;
  const explicit =
    ctx.platformRole === 'admin'
      ? true
      : (ctx.capabilities.explicitView(`page:${page.id}`) ??
        (section ? ctx.capabilities.explicitView(`section:${section.id}`) : undefined));
  if (!evaluateTarget(page.target, explicit, ctx)) return false;
  if (!floors.has(page.target))
    floors.set(page.target, floorApplies(page.target) ? moduleViewFloor(page.target) : null);
  const floor = floors.get(page.target);
  return ctx.platformRole === 'admin' || !floor || permissionSet(ctx.capabilities).has(floor);
}
/** Shared by containment and fallback: mirrors hook page/section/target precedence. */
export function simulationRouteAllowed(value: string, ctx: SimulationNavigationContext): boolean {
  const safe = safeSimulationReturn(value);
  if (!safe) return false;
  const path = canonicalPath(new URL(safe, 'https://local.invalid').pathname);
  const caps = ctx.capabilities;
  if (!caps.roles.length && ctx.platformRole !== 'admin') return false;
  const hit = resolveNavInstance(ctx.nav, path);
  if (hit) {
    const section = hit.sectionId
      ? ctx.nav.sections.find((s) => s.id === hit.sectionId)
      : undefined;
    if (!simulationPageAllowed(hit.page, section, ctx)) return false;
    return !hit.rest ||
      routeAccessPolicyIdForPath(hit.target + hit.rest) === routeAccessPolicyIdForPath(hit.target)
      ? true
      : evaluateTarget(hit.target + hit.rest, undefined, ctx);
  }
  const screen =
    staticScreens.get(path) ??
    SCREEN_DESIGN_MANIFEST.find((row) => patternMatches(row.pattern, path));
  if (!screen || /^(?:\/api|\/login|\/auth|\/onboarding|\/join|\/invite|\/book)(?:\/|$)/.test(path))
    return false;
  if (ctx.nav.builtin[screen.pattern]?.hidden) return false;
  const explicit =
    !screen.pattern.includes('[') && ctx.platformRole !== 'admin'
      ? caps.explicitView(`page:${screen.pattern}`)
      : undefined;
  return evaluateTarget(path, explicit, ctx);
}
/** Bounded and deduplicated: no speculative dynamic IDs, external URLs or redirect roots. */
export function simulationDestination(input: {
  current: string;
  ctx: SimulationNavigationContext;
  orgId: string;
  preferences?: Record<string, unknown>;
  original?: string | null;
}): string {
  const current = safeSimulationReturn(input.original ?? input.current);
  const currentPath = current ? new URL(current, 'https://local.invalid').pathname : '/';
  const lang = currentPath.split('/')[1];
  const locale = (availableLanguageTags as readonly string[]).includes(lang) ? lang : 'en';
  const can = (href: string) => simulationRouteAllowed(href, input.ctx);
  if (canonicalPath(currentPath) === '/account/home') return localizePath('/account/home', locale);
  const preferences = input.preferences ?? {};
  const modules = getModules({
    orgKind: input.ctx.availability?.kind ?? undefined,
    schedulingEnabled: input.ctx.availability?.moduleStates.scheduling,
    navConfig: input.ctx.nav,
  });
  const personal = personalNavigation(
    preferences[`personalNavigation:${input.orgId}`],
    input.orgId,
  );
  const ordered = orderPersonalSections(modules, personal).filter(
    (m) => !personal.hidden.includes(m.id),
  );
  const section = modules.find((m) => m.matcher(canonicalPath(currentPath)));
  const candidates = [
    current,
    ...(section?.items.map((i) => i.href) ?? []),
    safeSimulationReturn(preferences.landingPage),
    ...ordered.flatMap((m) => [m.href, ...m.items.map((i) => i.href)]),
  ];
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (!raw) continue;
    const safe = safeSimulationReturn(raw);
    if (!safe) continue;
    const path = canonicalPath(new URL(safe, 'https://local.invalid').pathname);
    if (
      seen.has(path) ||
      path === '/' ||
      path === '/account/home' ||
      (path === '/home' && raw !== current) ||
      path.includes('[')
    )
      continue;
    seen.add(path);
    if (!can(safe)) continue;
    // A different destination starts clean; query/hash belong only to the kept route.
    return (
      localizePath(path, locale) +
      (raw === current
        ? new URL(safe, 'https://local.invalid').search +
          new URL(safe, 'https://local.invalid').hash
        : '')
    );
  }
  return localizePath('/account/home', locale);
}
