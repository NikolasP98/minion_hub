// Per-agent memory state for workshop (split from workshop.svelte.ts).
// Self-contained: own $state, own localStorage key, no cross-deps into core.

import { hostsState } from '$lib/state/features/hosts.svelte';
import type { AgentMemory } from './workshop.types';

export const agentMemory: Record<string, AgentMemory> = $state({});

function emptyMemory(): AgentMemory {
  return {
    contextSummary: '',
    workspaceNotes: [],
    recentInteractions: [],
    environmentState: {},
    activePinboardItems: [],
  };
}

export function getOrCreateMemory(instanceId: string): AgentMemory {
  if (!agentMemory[instanceId]) agentMemory[instanceId] = emptyMemory();
  return agentMemory[instanceId];
}

export function addWorkspaceNote(instanceId: string, note: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.workspaceNotes = [...mem.workspaceNotes.slice(-9), note]; // keep last 10
  saveMemory();
}

export function addRecentInteraction(instanceId: string, summary: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.recentInteractions = [...mem.recentInteractions.slice(-4), summary]; // keep last 5
  saveMemory();
}

export function updateContextSummary(instanceId: string, summary: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.contextSummary = summary;
  saveMemory();
}

export function recordElementRead(instanceId: string, elementId: string, summary: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.environmentState[elementId] = { summary, lastReadAt: Date.now() };
  saveMemory();
}

export function clearAllMemory(): void {
  for (const key of Object.keys(agentMemory)) delete agentMemory[key];
  saveMemory();
}

/** Add a pin ID to an agent's active pinboard context (max 5; drops oldest if at limit). */
export function addActivePinboardItem(instanceId: string, pinId: string): void {
  const mem = getOrCreateMemory(instanceId);
  if (mem.activePinboardItems.includes(pinId)) return;
  if (mem.activePinboardItems.length >= 5) {
    mem.activePinboardItems = mem.activePinboardItems.slice(1); // drop oldest
  }
  mem.activePinboardItems.push(pinId);
  saveMemory();
}

/** Remove a pin ID from an agent's active pinboard context. */
export function removeActivePinboardItem(instanceId: string, pinId: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.activePinboardItems = mem.activePinboardItems.filter((id) => id !== pinId);
  saveMemory();
}

function memoryKey(): string {
  return `workshop:memory:${hostsState.activeHostId ?? 'default'}`;
}

function saveMemory(): void {
  try {
    localStorage.setItem(memoryKey(), JSON.stringify($state.snapshot(agentMemory)));
  } catch {
    /* non-critical */
  }
}

export function loadMemory(): void {
  try {
    const raw = localStorage.getItem(memoryKey());
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, AgentMemory>;
    for (const [id, mem] of Object.entries(saved)) {
      // Migrate memory records that pre-date activePinboardItems
      if (!mem.activePinboardItems) mem.activePinboardItems = [];
      agentMemory[id] = mem;
    }
  } catch {
    /* non-critical */
  }
}
