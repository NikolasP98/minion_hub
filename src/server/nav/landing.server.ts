import { getCoreDb } from '$server/db/pg-client';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getUserPreferences } from '$server/services/user-preferences.service';
import { readNavConfig } from '$server/services/nav-config.service';
import { listModuleStates } from '$server/services/modules.service';
import {
  loadPermissionsForUser,
  type PermissionsLoadResult,
} from '$server/services/permissions.service';
import { isAppRouteBlocked } from '$lib/modules/route-guard';
import type { ModuleStates } from '$lib/modules/availability';
import { decideRouteAccess } from '$lib/routes/route-access-policies';
import {
  EMPTY_NAV_CONFIG,
  instanceAllowed,
  resolveNavInstance,
  visibleNavConfig,
  type NavConfig,
} from '$lib/nav/custom-sections';
import { getModules } from '$lib/nav/modules';
import { defaultNavMode } from '$lib/nav/nav-mode-default';
import { CHAT_PATH, effectiveLandingPage } from '$lib/nav/landing';

/** Inputs a caller already holds (the (app) layout); anything missing is read here (all cached but prefs). */
export interface LandingPrefetch {
  preferences?: Record<string, unknown>;
  /** The FULL org document (instances resolve against it, like the hook guard). */
  navConfig?: NavConfig;
  permissions?: PermissionsLoadResult;
  moduleStates?: ModuleStates;
}

/**
 * The canonical (unprefixed) landing page for the signed-in member (spec 046
 * FR-007/FR-008). Best-effort: any lookup failure lands on CHAT_PATH, so the
 * root redirect never 500s.
 */
export async function resolveLandingFor(
  locals: App.Locals,
  pre: LandingPrefetch = {},
): Promise<string> {
  const user = locals.user;
  if (!user || !locals.tenantCtx) return CHAT_PATH;
  try {
    const ctx = await getCoreCtx(locals);
    if (!ctx) return CHAT_PATH;
    const [preferences, navConfig, permissions, moduleStates] = await Promise.all([
      pre.preferences ?? (user.supabaseId ? getUserPreferences(getCoreDb(), user.supabaseId) : {}),
      pre.navConfig ?? readNavConfig(ctx).catch(() => EMPTY_NAV_CONFIG),
      pre.permissions ?? loadPermissionsForUser(locals, user.id),
      pre.moduleStates ??
        locals.moduleStates ??
        listModuleStates({ db: getCoreDb(), tenantId: ctx.tenantId, profileId: user.supabaseId }),
    ]);
    const granted = new Set(permissions.permissions);
    const kind = locals.orgKind;
    const routeOk = (p: string) =>
      !isAppRouteBlocked(p, { kind, moduleStates }) &&
      decideRouteAccess(p, {
        authenticated: true,
        role: user.role,
        permissions: granted,
        orgCapabilities: granted,
      }).allowed;
    // Same predicates as the hook's route guards (prepareRouteGuard + module + route access).
    // TODO(handoff): the hook's explicit built-in `page:<pattern>` rule (resolveCapabilities
    // explicitView) is not consulted here, so an explicitly denied screen can still be chosen
    // and then 403s; fold it in if owners start denying built-in screens (spec 046 S3).
    const canView = (raw: string): boolean => {
      const p = raw.split(/[?#]/, 1)[0] || '/';
      if (!p.split('/')[2]?.includes('~')) return routeOk(p);
      const hit = resolveNavInstance(navConfig, p);
      return (
        !!hit &&
        instanceAllowed(hit.page, granted) &&
        !isAppRouteBlocked(hit.target, { kind, moduleStates })
      );
    };
    const modules = getModules({
      orgKind: kind ?? undefined,
      schedulingEnabled: moduleStates.scheduling ?? true,
      navConfig: visibleNavConfig(navConfig, granted, granted.has('settings:manage')),
      plugins: [],
    });
    const org = modules.find((mod) => mod.id === 'organization');
    return effectiveLandingPage({
      userChoice: preferences.landingPage,
      orgChoice: navConfig.landingPage,
      canView,
      mode: defaultNavMode(permissions.roles, user.role),
      orgItems: org?.items.map((it) => it.href) ?? [],
      moduleHrefs: modules
        .filter((mod) => mod.id !== 'organization')
        .flatMap((mod) => [mod.href, ...mod.items.map((it) => it.href)]),
    });
  } catch {
    return CHAT_PATH;
  }
}
