// src/lib/workshop/agent-queue.ts

export type AgentAction =
  | { type: 'readElement';   elementId: string; priority: 'high' | 'normal' }
  | { type: 'approachAgent'; targetInstanceId: string }
  | { type: 'compactContext' }
  | { type: 'seekInfo';      elementId: string };

const QUEUE_MAX = 5;

// Priority order: lower = higher priority
const PRIORITY_ORDER: Record<AgentAction['type'], number> = {
  compactContext: 0,
  readElement:    1, // refined by action.priority below
  seekInfo:       3,
  approachAgent:  4,
};

function actionPriority(a: AgentAction): number {
  if (a.type === 'readElement') return a.priority === 'high' ? 1 : 2;
  return PRIORITY_ORDER[a.type];
}

/** Active queues keyed by agent instanceId */
const queues = new Map<string, AgentAction[]>();

/** Return the queue for an agent (creates if absent). */
function getQueue(instanceId: string): AgentAction[] {
  if (!queues.has(instanceId)) queues.set(instanceId, []);
  return queues.get(instanceId)!;
}

/**
 * Enqueue an action for an agent.
 * - `compactContext` always fits (bypasses cap).
 * - Deduplicates: won't add two identical { type, elementId/targetInstanceId } entries.
 * - Drops the oldest non-compactContext action when at cap.
 */
export function enqueue(instanceId: string, action: AgentAction): void {
  const q = getQueue(instanceId);

  // Dedup check
  const isDup = q.some((a) => {
    if (a.type !== action.type) return false;
    if (a.type === 'readElement' && action.type === 'readElement')
      return a.elementId === action.elementId;
    if (a.type === 'seekInfo' && action.type === 'seekInfo')
      return a.elementId === action.elementId;
    if (a.type === 'approachAgent' && action.type === 'approachAgent')
      return a.targetInstanceId === action.targetInstanceId;
    if (a.type === 'compactContext' && action.type === 'compactContext') return true;
    return false;
  });
  if (isDup) return;

  // Cap check (compactContext bypasses)
  if (action.type !== 'compactContext' && q.filter((a) => a.type !== 'compactContext').length >= QUEUE_MAX) {
    // Drop lowest-priority non-compact action
    let worstIdx = -1;
    let worstPri = -1;
    for (let i = 0; i < q.length; i++) {
      if (q[i].type === 'compactContext') continue;
      const pri = actionPriority(q[i]);
      if (pri > worstPri) { worstPri = pri; worstIdx = i; }
    }
    if (worstIdx >= 0) q.splice(worstIdx, 1);
  }

  q.push(action);
  q.sort((a, b) => actionPriority(a) - actionPriority(b));
}

/** Peek at the highest-priority pending action without removing it. */
export function peek(instanceId: string): AgentAction | undefined {
  return getQueue(instanceId)[0];
}

/** Remove and return the highest-priority action. */
export function dequeue(instanceId: string): AgentAction | undefined {
  return getQueue(instanceId).shift();
}

/** Get a snapshot of all queued actions (read-only). */
export function getQueue_readonly(instanceId: string): readonly AgentAction[] {
  return getQueue(instanceId);
}

/** Clear all actions for an agent (e.g. on scene reset). */
export function clearQueue(instanceId: string): void {
  queues.delete(instanceId);
}

/** Clear all queues. */
export function clearAllQueues(): void {
  queues.clear();
}
