import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCREEN_DESIGN_MANIFEST } from './route-design-manifest';

function routeSource(relativePath: string): string {
  return readFileSync(new URL(`../../routes/(app)/${relativePath}`, import.meta.url), 'utf8');
}

const RESIDUAL_SCREENS = [
  { route: '/account', source: 'account/+page.svelte', marker: 'archetype="form"' },
  {
    route: '/account/connections',
    source: 'account/connections/+page.svelte',
    marker: 'archetype="form"',
  },
  {
    route: '/account/security',
    source: 'account/security/+page.svelte',
    marker: 'archetype="form"',
  },
  { route: '/orgs', source: 'orgs/+page.svelte', marker: 'archetype="collection"' },
  { route: '/team', source: 'team/+page.svelte', marker: 'archetype="collection"' },
  { route: '/users', source: 'users/+page.svelte', marker: 'archetype="collection"' },
  {
    route: '/users/join-requests',
    source: 'users/join-requests/+page.svelte',
    marker: 'archetype="collection"',
  },
  {
    route: '/killswitches',
    source: 'killswitches/+page.svelte',
    marker: 'archetype="collection"',
  },
  {
    route: '/notifications',
    source: 'notifications/+page.svelte',
    marker: 'archetype="collection"',
  },
  { route: '/overview', source: 'overview/+page.svelte', marker: 'archetype="canvas"' },
] as const;

describe('Wave A residual route composition contract', () => {
  it('enumerates exactly the ten residual renderable screens', () => {
    expect(RESIDUAL_SCREENS.map(({ route }) => route)).toEqual([
      '/account',
      '/account/connections',
      '/account/security',
      '/orgs',
      '/team',
      '/users',
      '/users/join-requests',
      '/killswitches',
      '/notifications',
      '/overview',
    ]);
  });

  it.each(RESIDUAL_SCREENS)('$route declares its canonical page shell', ({ source, marker }) => {
    const code = routeSource(source);
    expect(code).toContain('<PageShell');
    expect(code).toContain('<PageBody');
    expect(code).toContain(marker);
  });

  it('keeps route metadata and the residual implementation wave aligned', () => {
    const metadata = RESIDUAL_SCREENS.map(({ route }) =>
      SCREEN_DESIGN_MANIFEST.find((entry) => entry.pattern === route),
    );
    expect(metadata.every((entry) => entry?.migrationWave === 'A')).toBe(true);
    expect(metadata.map((entry) => entry?.archetype)).toEqual([
      'form-settings',
      'form-settings',
      'form-settings',
      'collection',
      'collection',
      'collection',
      'collection',
      'collection',
      'collection',
      'canvas-kanban',
    ]);
  });

  it('uses responsive section, tab, and sheet transformations', () => {
    expect(routeSource('account/+layout.svelte')).toContain('<SectionShell');
    expect(routeSource('users/+page.svelte')).toContain('<Tabs');
    expect(routeSource('users/join-requests/+page.svelte')).toContain(
      '@media (max-width: 767.98px)',
    );
    expect(routeSource('notifications/+page.svelte')).toContain('@media (max-width: 767.98px)');
    expect(routeSource('killswitches/+page.svelte')).toContain('@media (max-width: 767.98px)');
    expect(routeSource('overview/+page.svelte')).toContain('<Sheet');
    expect(routeSource('overview/+page.svelte')).toContain('inspectorAsSheet');
  });

  it('distinguishes the applicable empty, loading, unavailable, and error states', () => {
    expect(routeSource('orgs/+page.svelte')).toContain("kind: 'empty'");
    expect(routeSource('users/join-requests/+page.svelte')).toContain("kind: 'empty'");
    expect(routeSource('notifications/+page.svelte')).toContain("kind: 'empty'");
    const killswitches = routeSource('killswitches/+page.svelte');
    expect(killswitches).toContain("kind: 'loading'");
    expect(killswitches).toContain("kind: 'unavailable'");
    expect(killswitches).toContain("kind: 'error'");
    expect(routeSource('overview/+page.svelte')).toContain("kind: 'empty'");
    expect(routeSource('overview/+page.svelte')).toContain('role="alert"');
  });

  it('uses shared form and action primitives on the mutating route surfaces', () => {
    const joinRequests = routeSource('users/join-requests/+page.svelte');
    expect(joinRequests).toContain('<Button');
    expect(joinRequests).toContain('<Select');
    expect(joinRequests).toContain('<FormFieldset');

    const overview = routeSource('overview/+page.svelte');
    expect(overview).toContain('<Button');
    expect(overview).toContain('<Input');
    expect(overview).toContain('<FormFieldset');

    const powerSwitch = routeSource('killswitches/PowerSwitch.svelte');
    expect(powerSwitch).toContain('<Button');
    expect(powerSwitch).toContain('role="switch"');
  });
});
