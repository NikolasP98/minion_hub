/**
 * Sidebar navigation mode: the full section list ("full") vs. a single
 * business module ("module", ERPNext-style module switcher).
 *
 * Default is role-derived — owner/admin/manager keep the platform-wide view,
 * everyone else lands scoped to one module so the sidebar isn't a wall of
 * every tab. An explicit pick wins over the role default and is remembered
 * per actor and organization in browser storage.
 */
import { preferenceOwner, preferenceKey } from './scoped-preference.svelte';
import { canonicalPath } from '$lib/canonical-path';
import { canUseFullNavigation } from '$lib/nav/personal-navigation';
import { page } from '$app/state';
import { resolveModuleForNav, visibleModules, type ModuleNavData } from '$lib/nav/modules';
import { canViewPath } from '$lib/access/can.svelte';
import { pluginNavState } from '$lib/state/plugin-nav.svelte';
import { isChannelPlugin } from '$lib/components/layout/sections';
import { posPendingWork } from '$lib/nav/pos-pending';
import { navConfig } from '$lib/nav/nav-config.svelte';

export type NavMode = 'full' | 'module' | 'personal';

type Selection = { mode: NavMode | null; module: string | null };
let selected = $state.raw<Selection & { owner: string | null }>({
  owner: null,
  mode: null,
  module: null,
});
function readSelection(): Selection {
  const owner = preferenceOwner();
  if (owner === selected.owner) return selected;
  try {
    const key = preferenceKey('navigation', owner);
    const raw = key && typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object') {
      const candidate = value as Record<string, unknown>;
      return {
        mode:
          candidate.mode === 'full' || candidate.mode === 'module' || candidate.mode === 'personal'
            ? candidate.mode
            : null,
        module: typeof candidate.module === 'string' ? candidate.module : null,
      };
    }
  } catch {
    /* unavailable storage: use the role default */
  }
  return { mode: null, module: null };
}
function writeSelection(value: Selection) {
  const owner = preferenceOwner();
  selected = { ...value, owner };
  try {
    const key = preferenceKey('navigation', owner);
    if (key) localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* session-only when storage is unavailable */
  }
}

export function navModuleData(): ModuleNavData {
  const data = page.data as {
    schedulingEnabled?: boolean;
    activeOrgKind?: 'business' | 'personal';
    posPendingWork?: number;
  };
  return {
    schedulingEnabled: data?.schedulingEnabled,
    posPendingWork: posPendingWork(),
    orgKind: data?.activeOrgKind,
    navConfig: navConfig(),
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
 * roles use module mode; the full development navigation needs an explicit role.
 */
export function defaultNavMode(roles: string[] | undefined, platformRole?: string): NavMode {
  return canUseFullNavigation(roles, platformRole) ? 'full' : 'module';
}

function roleDefault(): NavMode {
  const { roles, platformRole } = navData();
  return defaultNavMode(roles, platformRole);
}

export const navMode = {
  get canUseFull(): boolean {
    const { roles, platformRole } = navData();
    return canUseFullNavigation(roles, platformRole);
  },
  get mode(): NavMode {
    if (
      canonicalPath(page.url.pathname) === '/account/home' &&
      !page.url.searchParams.has('section') &&
      readSelection().mode !== 'full'
    )
      return 'personal';
    const requested = readSelection().mode ?? roleDefault();
    return requested === 'full' && !this.canUseFull ? 'personal' : requested;
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
    const section =
      canonicalPath(page.url.pathname) === '/account/home'
        ? page.url.searchParams.get('section')
        : null;
    const selected = section ? mods.find((mod) => mod.id === section) : undefined;
    if (selected) return selected;
    const fromPath = resolveModuleForNav(page.url.pathname, data);
    const onPath = fromPath ? mods.find((mod) => mod.id === fromPath.id) : undefined;
    return onPath ?? mods.find((mod) => mod.id === readSelection().module) ?? mods[0] ?? null;
  },
  setMode(next: NavMode) {
    writeSelection({
      ...readSelection(),
      mode: next === 'full' && !this.canUseFull ? 'personal' : next,
    });
  },
  pickModule(id: string) {
    writeSelection({ mode: 'module', module: id });
  },
  /** Scoped preferences load lazily. Legacy browser-global mode keys are not imported. */
  hydrate() {},
};
