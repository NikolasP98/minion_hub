import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCREEN_DESIGN_MANIFEST } from './route-design-manifest';

function routeSource(relativePath: string): string {
  return readFileSync(new URL(`../../routes/(app)/cloud/${relativePath}`, import.meta.url), 'utf8');
}

describe('Wave D Cloud composition contract', () => {
  const cloudScreens = [
    { pattern: '/cloud', source: '+page.svelte', archetype: 'dashboard' },
    { pattern: '/cloud/gui', source: 'gui/+page.svelte', archetype: 'terminal' },
    { pattern: '/cloud/settings', source: 'settings/+page.svelte', archetype: 'form' },
    { pattern: '/cloud/terminal', source: 'terminal/+page.svelte', archetype: 'terminal' },
  ] as const;

  it('enumerates exactly the four renderable Cloud screens', () => {
    expect(cloudScreens).toHaveLength(4);
    expect(cloudScreens.map(({ pattern }) => pattern)).toEqual([
      '/cloud',
      '/cloud/gui',
      '/cloud/settings',
      '/cloud/terminal',
    ]);
    expect(
      SCREEN_DESIGN_MANIFEST.filter(({ pattern }) => pattern.startsWith('/cloud')).map(
        ({ pattern }) => pattern,
      ),
    ).toEqual(cloudScreens.map(({ pattern }) => pattern));
  });

  it.each(cloudScreens)(
    '$pattern uses its canonical PageShell archetype',
    ({ source, archetype }) => {
      const route = routeSource(source);
      expect(route).toContain('<PageShell');
      expect(route).toContain(`archetype="${archetype}"`);
    },
  );

  it('keeps overview and settings on explicit region scroll ownership', () => {
    expect(routeSource('+page.svelte')).toContain('scroll="region"');
    expect(routeSource('settings/+page.svelte')).toContain('scroll="region"');
  });

  it('keeps both remote workspaces isolated from page scrolling', () => {
    for (const source of ['gui/+page.svelte', 'terminal/+page.svelte']) {
      const route = routeSource(source);
      expect(route).toContain('scroll="none"');
      expect(route).toContain('variant="terminal"');
    }
  });

  it('uses shared state and interaction foundations across Cloud', () => {
    for (const source of cloudScreens.map(({ source }) => source)) {
      expect(routeSource(source)).toContain('<AsyncBoundary');
    }

    const settings = routeSource('settings/+page.svelte');
    expect(settings).toContain('<ConfirmDialog');
    expect(settings).toContain('<Button');
  });
});
