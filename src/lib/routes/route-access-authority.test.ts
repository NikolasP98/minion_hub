import { describe, expect, it } from 'vitest';
import { BUILTIN_PLUGIN_ITEMS, getSections } from '$lib/components/layout/sections';
import { palettePageRoutes, ROUTES } from '$lib/nav/routes';
import { PERMISSIONS } from '$lib/permissions';
import {
  decideRouteAccess,
  getRouteAccessPolicy,
  resolveRouteAccess,
  routeAccessPolicyIdForPath,
} from './route-access-policies';
import { ROUTE_DESIGN_MANIFEST, SCREEN_DESIGN_MANIFEST } from './route-design-manifest';

const authenticated = {
  authenticated: true,
  role: 'user' as const,
  permissions: new Set<string>(),
};

describe('route access authority', () => {
  it('preserves exact, prefix, dynamic, and redirect policy semantics', () => {
    expect(routeAccessPolicyIdForPath('/agents/builder')).toBe('permission:agents:view');
    expect(routeAccessPolicyIdForPath('/agents/builder/draft-1?tab=tools')).toBe(
      'permission:agents:view',
    );
    expect(routeAccessPolicyIdForPath('/crm/insights')).toBe('permission:crm.insights:view');
    expect(routeAccessPolicyIdForPath('/cloud')).toBe('org-capability:workspace:view');
    expect(routeAccessPolicyIdForPath('/cloud/gui')).toBe('org-capability:workspace:edit');
    expect(routeAccessPolicyIdForPath('/cloud/settings')).toBe('org-capability:workspace:manage');
    expect(routeAccessPolicyIdForPath('/team')).toBe('capability:users.manage');
    expect(routeAccessPolicyIdForPath('/book/public-link')).toBe('public');
    expect(routeAccessPolicyIdForPath('/terminal')).toBe('authenticated');
    expect(resolveRouteAccess('/settings/gateways').deniedStatus).toBe(404);
  });

  it('evaluates action-strength route policies fail-closed', () => {
    const workspaceViewer = {
      ...authenticated,
      permissions: new Set(['workspace:view']),
    };
    expect(decideRouteAccess('/cloud', workspaceViewer).allowed).toBe(true);
    expect(decideRouteAccess('/cloud/gui', workspaceViewer).allowed).toBe(false);
    expect(decideRouteAccess('/cloud/settings', workspaceViewer).allowed).toBe(false);

    const workspaceEditor = {
      ...authenticated,
      permissions: new Set(['workspace:view', 'workspace:edit']),
    };
    expect(decideRouteAccess('/cloud/gui', workspaceEditor).allowed).toBe(true);
    expect(decideRouteAccess('/team', workspaceEditor).allowed).toBe(false);

    const teamManager = {
      ...authenticated,
      permissions: new Set(['users:manage']),
    };
    expect(decideRouteAccess('/team', teamManager).allowed).toBe(true);
    expect(decideRouteAccess('/notifications', teamManager).allowed).toBe(false);
  });

  it('resolves every protected renderable route through its manifest policy', () => {
    for (const route of SCREEN_DESIGN_MANIFEST) {
      const resolved = resolveRouteAccess(route.pattern);
      expect(resolved.policyId, route.pattern).toBe(route.accessPolicyId);
      expect(() => getRouteAccessPolicy(resolved.policyId), route.pattern).not.toThrow();
      if (route.accessPolicyId !== 'public') {
        expect(
          decideRouteAccess(route.pattern, { authenticated: false }).allowed,
          route.pattern,
        ).toBe(false);
      }
    }
  });

  it('keeps every global-nav and palette destination on the manifest policy', () => {
    const sectionPaths = getSections().flatMap((section) => [
      ...section.items.map((item) => item.href),
      ...(section.subsections ?? []).flatMap((subsection) =>
        subsection.items.map((item) => item.href),
      ),
    ]);
    const paths = new Set([
      ...ROUTES.filter((route) => route.inNav).map((route) => route.path),
      ...palettePageRoutes().map((route) => route.path),
      ...sectionPaths,
      ...BUILTIN_PLUGIN_ITEMS.map(({ item }) => item.href),
      '/cloud',
      '/reliability',
      '/marketplace',
      '/killswitches',
      '/settings',
      '/notifications',
    ]);

    for (const href of paths) {
      const pathname = href.split(/[?#]/, 1)[0];
      const manifestRoute = ROUTE_DESIGN_MANIFEST.find((route) => route.pattern === pathname);
      expect(manifestRoute, href).toBeDefined();
      expect(resolveRouteAccess(href).policyId, href).toBe(manifestRoute?.accessPolicyId);
    }
  });

  it('allows the real platform-admin permission bundle across protected nav routes', () => {
    const adminContext = {
      authenticated: true,
      role: 'admin' as const,
      permissions: new Set<string>(PERMISSIONS),
    };
    for (const route of ROUTE_DESIGN_MANIFEST) {
      if (route.accessPolicyId === 'public') continue;
      expect(decideRouteAccess(route.pattern, adminContext).allowed, route.pattern).toBe(true);
    }
  });
});
