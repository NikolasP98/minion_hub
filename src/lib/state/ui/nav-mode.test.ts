import { describe, it, expect, vi } from 'vitest';

// A getter-backed mock (not a static object) so `page.data`/`page.url` can be
// reassigned per test and `nav-mode.svelte.ts` — which re-reads `page` on
// every `navMode.*` access — sees the update.
const mockPage: { data: Record<string, unknown>; url: URL } = {
  data: {},
  url: new URL('http://localhost/'),
};
vi.mock('$app/state', () => ({
  get page() {
    return mockPage;
  },
}));
import { defaultNavMode, navMode, navModuleData } from './nav-mode.svelte';
import { resolveModuleForNav, getModules, visibleModules } from '$lib/nav/modules';
import { canViewPath } from '$lib/access/can.svelte';

describe('defaultNavMode', () => {
  it('gives owners/admins/managers the full sidebar', () => {
    expect(defaultNavMode(['owner'])).toBe('full');
    expect(defaultNavMode(['manager'])).toBe('full');
    expect(defaultNavMode([], 'admin')).toBe('full');
  });

  it('scopes staff/viewer to a single module', () => {
    expect(defaultNavMode(['staff'])).toBe('module');
    expect(defaultNavMode(['viewer', 'staff'])).toBe('module');
  });

  it('falls back to the full nav when roles are unknown', () => {
    expect(defaultNavMode(undefined)).toBe('full');
    expect(defaultNavMode([])).toBe('full');
  });
});

describe('resolveModuleForNav', () => {
  it('routes each module its own subtree', () => {
    expect(resolveModuleForNav('/pos/sell')?.id).toBe('pos');
    expect(resolveModuleForNav('/pos/catalog?tab=x')?.id).toBe('pos');
    expect(resolveModuleForNav('/crm/customers')?.id).toBe('marketing');
    expect(resolveModuleForNav('/socials/posts')?.id).toBe('marketing');
    expect(resolveModuleForNav('/brains')?.id).toBe('agents');
    expect(resolveModuleForNav('/scheduling/calendar')?.id).toBe('scheduling');
    expect(resolveModuleForNav('/stock/items')?.id).toBe('stock');
    expect(resolveModuleForNav('/settings')?.id).toBe('platform');
    expect(resolveModuleForNav('/onboarding')).toBeNull();
  });

  it('covers every nav surface', () => {
    const paths = [
      '/home',
      '/overview',
      '/team',
      '/pos/sell',
      '/crm',
      '/socials',
      '/agents',
      '/capabilities',
      '/brains',
      '/scheduling',
      '/stock',
      '/finances',
      '/sales',
      '/memberships',
      '/work',
      '/pulse',
      '/workforce',
      '/support',
      '/channels',
      '/reliability',
      '/marketplace',
      '/cloud',
      '/killswitches',
      '/settings',
    ];
    for (const path of paths) {
      expect(resolveModuleForNav(path), path).not.toBeNull();
    }
  });

  it('surfaces installed plugin control centers as the Tools module', () => {
    expect(getModules().some((mod) => mod.id === 'tools')).toBe(false);
    const withPlugins = getModules({ plugins: [{ pluginId: 'studio', title: 'Studio' }] });
    const tools = withPlugins.find((mod) => mod.id === 'tools');
    expect(tools?.items.map((i) => i.href)).toEqual(['/plugins/studio']);
  });

  it('drops modules whose every page is denied and re-points the landing href', () => {
    const canView = (href: string) => href.startsWith('/stock') && href !== '/stock';
    const mods = visibleModules({}, canView);
    expect(mods.map((mod) => mod.id)).toEqual(['stock']);
    expect(mods[0].href).toBe('/stock/items');
  });

  it('gives every path at most one module', () => {
    const paths = [
      '/pos/sell',
      '/crm',
      '/socials',
      '/agents',
      '/capabilities',
      '/scheduling',
      '/stock',
    ];
    for (const path of paths) {
      expect(getModules().filter((mod) => mod.matcher(path))).toHaveLength(1);
    }
  });

  it('marks exactly one item active per page', () => {
    const active = (moduleId: string, path: string) =>
      getModules()
        .find((mod) => mod.id === moduleId)!
        .items.filter((i) => (i.activeWhen ? false : i.matcher(path)))
        .map((i) => i.id);
    expect(active('marketing', '/crm')).toEqual(['CRM:dashboard']);
    expect(active('marketing', '/crm/abc123')).toEqual(['CRM:customers']);
    expect(active('marketing', '/socials/campaigns')).toEqual(['Socials:campaigns']);
    expect(active('stock', '/stock')).toEqual(['overview']);
    expect(active('stock', '/stock/items/42')).toEqual(['items']);
  });

  it('groups the marketing module by area', () => {
    const groups = [
      ...new Set(
        getModules()
          .find((mod) => mod.id === 'marketing')!
          .items.map((i) => i.group),
      ),
    ];
    expect(groups).toEqual(['CRM', 'Socials']);
  });

  it('hides appointments until scheduling is enabled', () => {
    const ids = (data: { schedulingEnabled?: boolean }) =>
      getModules(data)[0].items.map((i) => i.id);
    expect(ids({})).not.toContain('appointments');
    expect(ids({ schedulingEnabled: true })).toContain('appointments');
  });
});

/**
 * Topbar's mobile sheet ALWAYS reads `navMode.activeModule.items` — the exact
 * same getter Sidebar.svelte's module view reads — regardless of
 * `navMode.isModule` (which only gates the DESKTOP Sidebar's full-vs-module
 * choice). The reported bug: opening the hamburger inside /stock as an OWNER
 * (a full-nav role) showed every module, not just Stock, because Topbar used
 * to render the unscoped `getNavSections()` list whenever `isModule` was
 * false. Mobile no longer branches on `isModule` at all, so a full-nav role
 * (owner) and a module-mode role (staff) on the same route get the identical
 * one-module list — pinned here for both.
 */
describe('navMode — mobile sheet is always module-scoped, for every role', () => {
  const STOCK_VIEW_PERMISSIONS = [
    'stock:view',
    'stock.items:view',
    'stock.warehouses:view',
    'stock.entries:view',
    'stock.commitments:view',
  ];
  // Same registry call Sidebar/Topbar both make (navModuleData() feeds it);
  // a permissive canView isolates the assertion to "same module, same items".
  const stockFromRegistry = visibleModules({}, () => true).find((mod) => mod.id === 'stock')!;

  it('scopes a module-mode role (staff) on /stock to Stock only', () => {
    mockPage.data = {
      user: { role: 'user' },
      // `roles` drives navMode's own default (module vs full); `permissions`
      // is the capability set `canViewPath` (used inside `activeModule`) reads.
      permissions: { roles: ['staff'], permissions: STOCK_VIEW_PERMISSIONS },
      activeOrgKind: 'business',
    };
    mockPage.url = new URL('http://localhost/stock');

    expect(navMode.isModule).toBe(true);
    expect(navMode.activeModule?.id).toBe('stock');
    expect(navMode.activeModule?.items.map((it) => it.href)).toEqual(
      stockFromRegistry.items.map((it) => it.href),
    );
  });

  it('scopes a full-nav role (owner) on /stock to Stock only too — mobile never falls back to all sections', () => {
    mockPage.data = {
      user: { role: 'user' },
      permissions: { roles: ['owner'], permissions: STOCK_VIEW_PERMISSIONS },
      activeOrgKind: 'business',
    };
    mockPage.url = new URL('http://localhost/stock');

    // Desktop Sidebar would show the FULL nav for this role (`isModule` is
    // false); the mobile sheet ignores that flag and still scopes to Stock,
    // matching what a module-mode role sees on the same route.
    expect(navMode.isModule).toBe(false);
    expect(navMode.activeModule?.id).toBe('stock');
    expect(navMode.activeModule?.items.map((it) => it.href)).toEqual(
      stockFromRegistry.items.map((it) => it.href),
    );
  });

  it('falls back to the first visible module on a route no module claims, never null', () => {
    mockPage.data = {
      user: { role: 'user' },
      permissions: { roles: ['owner'], permissions: [] },
      activeOrgKind: 'business',
    };
    // /notifications belongs to no module's matcher (verify: not in the
    // "covers every nav surface" path list above) — activeModule must still
    // resolve to something so the mobile sheet never renders empty. The
    // reference is computed through the same canViewPath the sheet itself
    // reads, not a permissive stub — the fallback is "first module this role
    // can actually see", and an empty permission set makes most modules
    // invisible.
    mockPage.url = new URL('http://localhost/notifications');
    expect(resolveModuleForNav('/notifications')).toBeNull();
    const mods = visibleModules(navModuleData(), canViewPath);
    expect(navMode.activeModule?.id).toBe(mods[0]?.id);
    expect(navMode.activeModule?.id).toBeTruthy();
  });
});
