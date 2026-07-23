import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCREEN_DESIGN_MANIFEST } from './route-design-manifest';

function routeSource(relativePath: string): string {
  return readFileSync(new URL(`../../routes/(app)/${relativePath}`, import.meta.url), 'utf8');
}

function componentSource(relativePath: string): string {
  return readFileSync(new URL(`../components/${relativePath}`, import.meta.url), 'utf8');
}

describe('Wave D route composition contract', () => {
  const screens = [
    ['agents/autonomous/+page.svelte', 'archetype="collection"'],
    ['agents/autonomous/[id]/+page.svelte', 'archetype="record-detail"'],
    ['agents/workshop/+page.svelte', 'archetype="collection"'],
    ['agents/workshop/[id]/+page.svelte', 'archetype="canvas"'],
    ['agents/workshop/compare/+page.svelte', 'archetype="workspace"'],
    ['agents/workshop/groupchat/+page.svelte', 'archetype="workspace"'],
    ['agents/workshop/leaderboard/+page.svelte', 'archetype="collection"'],
    ['home/+page.svelte', 'archetype="dashboard"'],
    ['home/settings/+page.svelte', 'archetype="form"'],
    ['marketplace/+page.svelte', 'archetype="dashboard"'],
    ['marketplace/agents/+page.svelte', 'archetype="collection"'],
    ['marketplace/agents/[slug]/+page.svelte', 'archetype="record-detail"'],
    ['marketplace/hooks/+page.svelte', 'archetype="collection"'],
    ['marketplace/mcp-servers/+page.svelte', 'archetype="collection"'],
    ['marketplace/plugins/+page.svelte', 'archetype="collection"'],
    ['marketplace/tools/+page.svelte', 'archetype="collection"'],
  ] as const;

  it.each(screens)('%s declares its canonical page archetype', (path, marker) => {
    expect(routeSource(path)).toContain('<PageShell');
    expect(routeSource(path)).toContain(marker);
  });

  it('keeps the plugin record detail inside the shared workspace shell', () => {
    expect(routeSource('plugins/[id]/+page.svelte')).toContain('<PluginControlCenter');
    expect(componentSource('../plugins/PluginControlCenter.svelte')).toContain('<PageShell');
    expect(componentSource('../plugins/PluginControlCenter.svelte')).toContain(
      'archetype="workspace"',
    );
  });

  it('uses responsive section shells for Workshop and Marketplace navigation', () => {
    expect(routeSource('agents/workshop/+layout.svelte')).toContain('<SectionShell');
    expect(routeSource('marketplace/+layout.svelte')).toContain('<SectionShell');
  });

  it('keeps immersive workspaces explicit about internal scroll ownership', () => {
    expect(routeSource('agents/workshop/[id]/+page.svelte')).toContain('scroll="none"');
    expect(routeSource('home/+page.svelte')).toContain('@container agentcol');
    expect(routeSource('marketplace/plugins/+page.svelte')).toContain('scroll="region"');
  });

  it('docks Notes and Todos on the trailing edge of the Home workspace', () => {
    const home = routeSource('home/+page.svelte');
    // The dock carries section toggles (notes/omnichat) + a context menu now,
    // so assert its class bindings rather than one literal opening tag.
    expect(home).toContain('class="notes-dock"');
    expect(home).toContain('class:collapsed={!notesState.open}');
    expect(home).toContain('direction="row"');
    expect(home).toMatch(/\.column\s*\{[\s\S]*?order:\s*1;/);
    expect(home).toMatch(/\.notes-dock\s*\{[\s\S]*?order:\s*2;/);
    expect(home).toMatch(
      /@media \(max-width:\s*768px\)[\s\S]*?\.notes-dock\s*\{[\s\S]*?position:\s*absolute;/,
    );
    expect(home).toMatch(/\.notes-dock\.collapsed\s*\{[\s\S]*?width:\s*46px;/);
  });

  it('keeps the implementation archetypes aligned with route metadata', () => {
    expect(SCREEN_DESIGN_MANIFEST.find((route) => route.pattern === '/home')?.archetype).toBe(
      'dashboard',
    );
    expect(
      SCREEN_DESIGN_MANIFEST.find((route) => route.pattern === '/agents/workshop/[id]')?.archetype,
    ).toBe('canvas-kanban');
  });
});
