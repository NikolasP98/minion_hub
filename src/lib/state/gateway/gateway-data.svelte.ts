import type { Agent, Session, PresenceEntry, HelloOk } from '$lib/types/gateway';

/**
 * Non-reactive index for O(1) session lookup by sessionKey.
 * Kept in sync with gw.sessions — used only in upsertSession hot path.
 */
const sessionIndex = new Map<string, number>(); // sessionKey → array index

export const gw = $state({
  hello: null as HelloOk | null,
  agents: [] as Agent[],
  defaultAgentId: null as string | null,
  sessions: [] as Session[],
  presence: [] as PresenceEntry[],
  health: null as unknown,
  channels: null as unknown,
  cronJobs: [] as unknown[],
  lastSeq: null as number | null,
});

const MAX_SESSIONS = 1000;

/** O(1) upsert: find by sessionKey via index map, merge non-null fields or append. */
export function upsertSession(incoming: Partial<Session> & { sessionKey: string }) {
  const idx = sessionIndex.get(incoming.sessionKey);
  if (idx !== undefined) {
    const existing = gw.sessions[idx];
    for (const [k, v] of Object.entries(incoming)) {
      if (v != null) (existing as unknown as Record<string, unknown>)[k] = v;
    }
  } else {
    gw.sessions.push(incoming as Session);
    sessionIndex.set(incoming.sessionKey, gw.sessions.length - 1);
    // Evict oldest if we've exceeded the cap
    if (gw.sessions.length > MAX_SESSIONS) evictOldestSessions(MAX_SESSIONS);
  }
}

/** Merge incoming array; preserves locally-discovered sessions not in the array. */
export function mergeSessions(incoming: Session[]) {
  for (const s of incoming) upsertSession(s);
}

/** Clear all sessions (on disconnect). */
export function clearSessions() {
  gw.sessions = [];
  sessionIndex.clear();
}

/**
 * Evict oldest sessions when array exceeds maxSize (by updatedAt).
 * Rebuilds the index map after eviction.
 */
export function evictOldestSessions(maxSize: number) {
  if (gw.sessions.length <= maxSize) return;
  const sorted = [...gw.sessions].sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
  const toEvict = new Set(sorted.slice(0, gw.sessions.length - maxSize).map((s) => s.sessionKey));
  gw.sessions = gw.sessions.filter((s) => !toEvict.has(s.sessionKey));
  // Rebuild index after filter (array indices changed)
  sessionIndex.clear();
  for (let i = 0; i < gw.sessions.length; i++) {
    sessionIndex.set(gw.sessions[i].sessionKey, i);
  }
}
