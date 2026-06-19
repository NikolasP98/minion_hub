import { describe, it, expect, beforeEach } from 'vitest';
import { agentWindows } from './agent-windows.svelte';
import type { ArtifactDescriptor } from '$lib/agents/artifacts';

const desc: ArtifactDescriptor = { id: 'overview', agentId: 'a1', slot: 'detail', title: 'Overview', description: 'd', icon: 'LayoutDashboard', kind: 'static', entrypoint: 'index.html' };

beforeEach(() => { for (const w of [...agentWindows.windows]) agentWindows.close(w.id); });

describe('agentWindows', () => {
  it('opens an artifact window', () => {
    agentWindows.openArtifact(desc);
    expect(agentWindows.windows).toHaveLength(1);
    expect(agentWindows.windows[0]).toMatchObject({ kind: 'artifact', id: 'artifact:a1:overview', title: 'Overview', fullscreen: false });
  });
  it('opening the same window focuses (no duplicate) and bumps z above others', () => {
    agentWindows.openArtifact(desc);
    agentWindows.openFlow('agent-reminders', 'Reminders');
    const firstZ = agentWindows.windows.find((w) => w.id === 'artifact:a1:overview')!.z;
    agentWindows.openArtifact(desc); // re-open → focus
    expect(agentWindows.windows).toHaveLength(2);
    const w = agentWindows.windows.find((x) => x.id === 'artifact:a1:overview')!;
    expect(w.z).toBeGreaterThan(firstZ);
    expect(w.z).toBeGreaterThan(agentWindows.windows.find((x) => x.kind === 'flow')!.z);
  });
  it('opens a flow window', () => {
    agentWindows.openFlow('agent-reminders', 'Reminders');
    expect(agentWindows.windows[0]).toMatchObject({ kind: 'flow', id: 'flow:agent-reminders', flowId: 'agent-reminders', title: 'Reminders' });
  });
  it('toggleFullscreen flips the flag; close removes; setPosition updates', () => {
    agentWindows.openFlow('f1', 'F1');
    const id = 'flow:f1';
    agentWindows.toggleFullscreen(id);
    expect(agentWindows.windows[0].fullscreen).toBe(true);
    agentWindows.setPosition(id, 42, 24);
    expect(agentWindows.windows[0]).toMatchObject({ x: 42, y: 24 });
    agentWindows.close(id);
    expect(agentWindows.windows).toHaveLength(0);
  });
});
