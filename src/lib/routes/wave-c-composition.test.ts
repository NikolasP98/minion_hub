import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCREEN_DESIGN_MANIFEST } from './route-design-manifest';

function routeSource(relativePath: string): string {
  return readFileSync(new URL(`../../routes/(app)/${relativePath}`, import.meta.url), 'utf8');
}

function componentSource(relativePath: string): string {
  return readFileSync(new URL(`../components/${relativePath}`, import.meta.url), 'utf8');
}

describe('Wave C route composition contract', () => {
  const screens = [
    ['agents/+page.svelte', 'archetype="master-detail"'],
    ['agents/builder/+page.svelte', 'archetype="collection"'],
    ['agents/builder/[id]/+layout.svelte', 'archetype="workspace"'],
    ['brains/+page.svelte', 'archetype="collection"'],
    ['brains/[id]/+page.svelte', 'archetype="record-detail"'],
    ['brains/agents/+page.svelte', 'archetype="collection"'],
    ['brains/settings/+page.svelte', 'archetype="form"'],
    ['brains/template/+page.svelte', 'archetype="form"'],
    ['capabilities/+page.svelte', 'archetype="collection"'],
    ['flow-editor/+page.svelte', 'archetype="collection"'],
    ['flow-editor/[id]/+page.svelte', 'archetype="canvas"'],
    ['flow-editor/master/[id]/+page.svelte', 'archetype="canvas"'],
    ['flow-editor/skills/[id]/+page.svelte', 'archetype="workspace"'],
    ['prompt/+page.svelte', 'archetype="workspace"'],
    ['tools/[id]/+layout.svelte', 'archetype="workspace"'],
  ] as const;

  it.each(screens)('%s declares its canonical page archetype', (path, marker) => {
    expect(routeSource(path)).toContain('<PageShell');
    expect(routeSource(path)).toContain(marker);
  });

  it('uses the responsive section shell for nested Brains and Capabilities navigation', () => {
    expect(routeSource('brains/+layout.svelte')).toContain('<SectionShell>');
    expect(routeSource('capabilities/+page.svelte')).toContain('<SectionShell>');
    expect(componentSource('brains/BrainsNav.svelte')).toContain('<SectionNav');
  });

  it('keeps code and route metadata aligned for transformed master/detail and IDE screens', () => {
    expect(SCREEN_DESIGN_MANIFEST.find((route) => route.pattern === '/agents')?.archetype).toBe(
      'master-detail',
    );
    expect(SCREEN_DESIGN_MANIFEST.find((route) => route.pattern === '/tools/[id]')?.archetype).toBe(
      'workspace-editor',
    );
  });

  it('gives every editor a deliberate compact transformation', () => {
    expect(routeSource('agents/+page.svelte')).toContain('.compact-agent-workspace');
    expect(componentSource('prompt/PromptShell.svelte')).toContain('.compact-pane-switcher');
    expect(routeSource('tools/[id]/+page.svelte')).toContain('.ide-split');
    expect(routeSource('flow-editor/[id]/+page.svelte')).toContain('.mobile-editor-controls');
    expect(routeSource('flow-editor/skills/[id]/+page.svelte')).toContain('.skill-stage');
  });

  it('distinguishes loading, empty, and error states on data-backed authoring screens', () => {
    expect(routeSource('agents/builder/[id]/+page.svelte')).toContain("kind: 'error'");
    expect(routeSource('brains/+page.svelte')).toContain("kind: 'empty'");
    expect(routeSource('flow-editor/+page.svelte')).toContain("kind: 'loading'");
    expect(routeSource('tools/[id]/+page.svelte')).toContain("kind: 'empty'");
  });
});

describe('Wave C mutation integrity contract', () => {
  it('keeps a Flow Copilot proposal when the parent refuses the commit', () => {
    const copilot = componentSource('flow-editor/FlowCopilotPanel.svelte');
    const route = routeSource('flow-editor/[id]/+page.svelte');

    expect(copilot).toContain('const applied = await onapply(proposal)');
    expect(copilot).toContain('if (!applied) return');
    expect(route).toContain('return false');
    expect(route).toContain('return true');
  });

  it('does not publish a custom tool after a failed dirty save', () => {
    const tool = routeSource('tools/[id]/+page.svelte');
    expect(tool).toContain('if (dirty) await saveTool()');
    expect(tool).toContain('if (dirty) return');
  });
});
