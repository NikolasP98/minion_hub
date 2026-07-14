import type { PageScrollMode, RouteArchetype } from '$lib/components/ui/foundations';

export interface BusinessRouteShell {
  archetype: RouteArchetype;
  scroll: PageScrollMode;
  landmark: boolean;
}

function shell(archetype: RouteArchetype, landmark = true): BusinessRouteShell {
  if (archetype === 'canvas' || archetype === 'terminal') {
    return { archetype, scroll: 'none', landmark };
  }
  if (archetype === 'collection' || archetype === 'workspace') {
    return { archetype, scroll: 'region', landmark };
  }
  return { archetype, scroll: 'page', landmark };
}

function normalized(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
}

export function socialsRouteShell(pathname: string): BusinessRouteShell {
  const path = normalized(pathname);
  if (path === '/socials') return shell('dashboard');
  if (path === '/socials/settings') return shell('form');
  if (path.startsWith('/socials/campaigns/') || path.startsWith('/socials/posts/')) {
    return shell('record-detail');
  }
  return shell('collection');
}

export function stockRouteShell(pathname: string): BusinessRouteShell {
  const path = normalized(pathname);
  if (path === '/stock') return shell('dashboard');
  if (path === '/stock/consume' || path === '/stock/entries/new') return shell('form');
  if (path.startsWith('/stock/entries/') || path.startsWith('/stock/items/')) {
    return shell('record-detail');
  }
  return shell('collection');
}

export function workforceRouteShell(pathname: string): BusinessRouteShell {
  const path = normalized(pathname);
  const leafOwnsMain = new Set([
    '/workforce/activity',
    '/workforce/approvals',
    '/workforce/costs',
    '/workforce/goals',
    '/workforce/issues',
    '/workforce/reliability',
  ]).has(path);
  if (path === '/workforce' || path === '/workforce/costs' || path === '/workforce/reliability') {
    return shell('dashboard', !leafOwnsMain);
  }
  if (path === '/workforce/org') return shell('canvas');
  if (path.endsWith('/pipelines')) return shell('workspace');
  if (path === '/workforce/settings' || path.startsWith('/workforce/settings/')) {
    return shell('form');
  }
  if (path === '/workforce/welcome') return shell('public');
  if (
    path.startsWith('/workforce/agents/') ||
    path.startsWith('/workforce/issues/') ||
    path.startsWith('/workforce/portfolios/') ||
    path.startsWith('/workforce/projects/')
  ) {
    return shell('record-detail');
  }
  return shell('collection', !leafOwnsMain);
}
