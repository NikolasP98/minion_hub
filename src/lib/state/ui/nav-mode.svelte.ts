/**
 * Sidebar navigation mode: the full section list ("full") vs. a single
 * business module ("module", ERPNext-style module switcher).
 *
 * Default is role-derived — owner/admin/manager keep the platform-wide view,
 * everyone else lands scoped to one module so the sidebar isn't a wall of
 * every tab. An explicit pick wins over the role default and is remembered
 * per browser (localStorage, same as the collapse preference).
 */
import { page } from '$app/state';
import { resolveModuleForNav, visibleModules, type ModuleNavData } from '$lib/nav/modules';
import { canViewPath } from '$lib/access/can.svelte';
import { pluginNavState } from '$lib/state/plugin-nav.svelte';
import { isChannelPlugin } from '$lib/components/layout/sections';

export type NavMode = 'full' | 'module';

const MODE_KEY = 'hub-nav-mode';
const MODULE_KEY = 'hub-nav-module';

/** Org roles that see the full sidebar by default. */
const FULL_NAV_ROLES = new Set(['owner', 'admin', 'manager']);

let modeOverride = $state<NavMode | null>(null);
let pickedModuleId = $state<string | null>(null);

export function navModuleData(): ModuleNavData {
  const data = page.data as {
    schedulingEnabled?: boolean;
    activeOrgKind?: 'business' | 'personal';
  };
  return {
    schedulingEnabled: data?.schedulingEnabled,
    orgKind: data?.activeOrgKind,
    // Channel plugins are reached through /channels, not their own module.
    plugins: pluginNavState.controlCenters.filter(
      (e) => pluginNavState.enabledByPluginId[e.pluginId] !== false && !isChannelPlugin(e),
    ),
  };
}

function navData(): ModuleNavData & { roles?: string[]; platformRole?: string } {
  const data = page.data as {
    permissions?: { roles?: string[] };
    user?: { role?: string };
  };
  return {
    ...navModuleData(),
    roles: data?.permissions?.roles,
    platformRole: data?.user?.role,
  };
}

/**
 * Role-derived default, used until the user picks a mode explicitly. Unknown
 * roles fall back to the full nav — never hide surfaces on a guess.
 */
export function defaultNavMode(roles: string[] | undefined, platformRole?: string): NavMode {
  if (platformRole === 'admin') return 'full';
  if (!roles || roles.length === 0) return 'full';
  return roles.some((r) => FULL_NAV_ROLES.has(r)) ? 'full' : 'module';
}

function roleDefault(): NavMode {
  const { roles, platformRole } = navData();
  return defaultNavMode(roles, platformRole);
}

export const navMode = {
  get mode(): NavMode {
    return modeOverride ?? roleDefault();
  },
  get isModule(): boolean {
    return this.mode === 'module' && this.activeModule !== null;
  },
  /**
   * The module the sidebar is scoped to: whatever the current route belongs
   * to, else the last explicit pick, else the first module available. Only
   * modules the user can actually open count — with none, `isModule` is false
   * and the sidebar keeps the full nav instead of rendering an empty rail.
   */
  get activeModule() {
    const data = navData();
    const mods = visibleModules(data, canViewPath);
    const fromPath = resolveModuleForNav(page.url.pathname, data);
    const onPath = fromPath ? mods.find((mod) => mod.id === fromPath.id) : undefined;
    return onPath ?? mods.find((mod) => mod.id === pickedModuleId) ?? mods[0] ?? null;
  },
  setMode(next: NavMode) {
    modeOverride = next;
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* private mode / storage disabled — session-only is fine */
    }
  },
  pickModule(id: string) {
    pickedModuleId = id;
    try {
      localStorage.setItem(MODULE_KEY, id);
    } catch {
      /* ignore */
    }
    this.setMode('module');
  },
  /** Read the stored preference. Call once from onMount (browser-only). */
  hydrate() {
    try {
      const stored = localStorage.getItem(MODE_KEY);
      if (stored === 'full' || stored === 'module') modeOverride = stored;
      pickedModuleId = localStorage.getItem(MODULE_KEY);
    } catch {
      /* ignore */
    }
  },
};
