import type { ArtifactDescriptor } from '$lib/agents/artifacts';

export type AgentWindowKind = 'artifact' | 'flow';

export interface AgentWindow {
  id: string;
  kind: AgentWindowKind;
  title: string;
  artifact?: ArtifactDescriptor;
  flowId?: string;
  fullscreen: boolean;
  z: number;
  x: number;
  y: number;
}

let seq = 0; // drives z-order + cascade offset; avoids Date.now()/random

function makeWindowStore() {
  const windows = $state<AgentWindow[]>([]);
  const find = (id: string) => windows.find((w) => w.id === id);

  function add(base: Omit<AgentWindow, 'fullscreen' | 'z' | 'x' | 'y'>): void {
    const existing = find(base.id);
    if (existing) {
      focus(base.id);
      return;
    }
    seq += 1;
    const offset = (windows.length % 6) * 28; // cascade
    windows.push({ ...base, fullscreen: false, z: seq, x: 80 + offset, y: 80 + offset });
  }
  function focus(id: string): void {
    const w = find(id);
    if (!w) return;
    seq += 1;
    w.z = seq;
  }
  function close(id: string): void {
    const i = windows.findIndex((w) => w.id === id);
    if (i >= 0) windows.splice(i, 1);
  }
  function toggleFullscreen(id: string): void {
    const w = find(id);
    if (w) w.fullscreen = !w.fullscreen;
    focus(id);
  }
  function setPosition(id: string, x: number, y: number): void {
    const w = find(id);
    if (w) { w.x = x; w.y = y; }
  }
  return {
    get windows() { return windows; },
    openArtifact(descriptor: ArtifactDescriptor) {
      add({ id: `artifact:${descriptor.agentId}:${descriptor.id}`, kind: 'artifact', title: descriptor.title, artifact: descriptor });
    },
    openFlow(flowId: string, title: string) {
      add({ id: `flow:${flowId}`, kind: 'flow', title, flowId });
    },
    close, focus, toggleFullscreen, setPosition,
  };
}

export const agentWindows = makeWindowStore();
