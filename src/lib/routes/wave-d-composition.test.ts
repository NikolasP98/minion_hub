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

  it('keeps the implementation archetypes aligned with route metadata', () => {
    expect(SCREEN_DESIGN_MANIFEST.find((route) => route.pattern === '/home')?.archetype).toBe(
      'dashboard',
    );
    expect(
      SCREEN_DESIGN_MANIFEST.find((route) => route.pattern === '/agents/workshop/[id]')?.archetype,
    ).toBe('canvas-kanban');
  });
});
