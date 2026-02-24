// src/lib/workshop/element-watcher.ts
//
// Detects changes to workshop element content and enqueues agent actions.
// Designed to run as a Svelte $effect inside WorkshopCanvas.

import { workshopState } from '$lib/state/workshop.svelte';
import { agentMemory } from '$lib/state/workshop.svelte';
import { enqueue } from './agent-queue';

interface ElementSnapshot {
  messageBoardContent?: string;
  pinboardCount: number;
  inboxCount: number;
  rulebookContent?: string;
}

const snapshots = new Map<string, ElementSnapshot>();

function snap(el: (typeof workshopState.elements)[string]): ElementSnapshot {
  return {
    messageBoardContent: el.messageBoardContent,
    pinboardCount: el.pinboardItems?.length ?? 0,
    inboxCount: el.inboxItems?.length ?? 0,
    rulebookContent: el.rulebookContent,
  };
}

/**
 * Call this function inside a Svelte $effect in WorkshopCanvas.
 * It compares element state against snapshots and enqueues agent actions.
 */
export function checkElementChanges(): void {
  const agents = Object.keys(workshopState.agents);

  for (const [elementId, el] of Object.entries(workshopState.elements)) {
    const prev = snapshots.get(elementId);
    const curr = snap(el);

    if (!prev) {
      snapshots.set(elementId, curr);
      continue;
    }

    // Rulebook changed → high priority readElement for all agents + clear context summaries
    if (prev.rulebookContent !== curr.rulebookContent) {
      for (const instanceId of agents) {
        enqueue(instanceId, { type: 'readElement', elementId, priority: 'high' });
        if (agentMemory[instanceId]) agentMemory[instanceId].contextSummary = '';
      }
    }
    // Messageboard changed
    else if (prev.messageBoardContent !== curr.messageBoardContent) {
      for (const instanceId of agents) {
        enqueue(instanceId, { type: 'readElement', elementId, priority: 'high' });
      }
    }
    // Pinboard got new items
    else if (curr.pinboardCount > prev.pinboardCount) {
      for (const instanceId of agents) {
        enqueue(instanceId, { type: 'readElement', elementId, priority: 'normal' });
      }
    }
    // Inbox got new items (only target agent)
    else if (curr.inboxCount > prev.inboxCount && el.inboxAgentId) {
      const targetAgent = Object.values(workshopState.agents)
        .find((a) => a.agentId === el.inboxAgentId);
      if (targetAgent) {
        enqueue(targetAgent.instanceId, { type: 'readElement', elementId, priority: 'high' });
      }
    }

    snapshots.set(elementId, curr);
  }

  // Remove snapshots for deleted elements
  for (const id of snapshots.keys()) {
    if (!workshopState.elements[id]) snapshots.delete(id);
  }
}

/** Reset all snapshots (call on scene rebuild). */
export function resetWatcher(): void {
  snapshots.clear();
}
