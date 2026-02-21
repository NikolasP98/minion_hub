import { workshopState } from '$lib/state/workshop.svelte';

export interface ProximityPair {
  instanceIdA: string;
  instanceIdB: string;
  distance: number;
}

/**
 * Returns the Euclidean distance between two agent instances,
 * or null if either instance doesn't exist.
 */
export function distanceBetween(instanceIdA: string, instanceIdB: string): number | null {
  const a = workshopState.agents[instanceIdA];
  const b = workshopState.agents[instanceIdB];
  if (!a || !b) return null;

  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Returns instance IDs of agents within the given radius of the specified agent.
 * Defaults to workshopState.settings.proximityRadius.
 */
export function findNearbyAgents(instanceId: string, radius?: number): string[] {
  const r = radius ?? workshopState.settings.proximityRadius;
  const origin = workshopState.agents[instanceId];
  if (!origin) return [];

  const nearby: string[] = [];

  for (const id of Object.keys(workshopState.agents)) {
    if (id === instanceId) continue;
    const dist = distanceBetween(instanceId, id);
    if (dist !== null && dist <= r) {
      nearby.push(id);
    }
  }

  return nearby;
}

/**
 * Returns all pairs of agents within range. Uses a double-loop
 * (i, j where j > i) to avoid duplicate pairs.
 * Defaults to workshopState.settings.proximityRadius.
 */
export function getProximityPairs(radius?: number): ProximityPair[] {
  const r = radius ?? workshopState.settings.proximityRadius;
  const ids = Object.keys(workshopState.agents);
  const pairs: ProximityPair[] = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const dist = distanceBetween(ids[i], ids[j]);
      if (dist !== null && dist <= r) {
        pairs.push({
          instanceIdA: ids[i],
          instanceIdB: ids[j],
          distance: dist,
        });
      }
    }
  }

  return pairs;
}
