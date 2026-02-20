import type { Agent, Session, PresenceEntry, HelloOk } from '$lib/types/gateway';

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

/** Find by sessionKey; merge non-null fields if exists, append if new. */
export function upsertSession(incoming: Partial<Session> & { sessionKey: string }) {
  const idx = gw.sessions.findIndex((s) => s.sessionKey === incoming.sessionKey);
  if (idx >= 0) {
    const existing = gw.sessions[idx];
    for (const [k, v] of Object.entries(incoming)) {
      if (v != null) (existing as unknown as Record<string, unknown>)[k] = v;
    }
  } else {
    gw.sessions.push(incoming as Session);
  }
}

/** Merge incoming array; preserves locally-discovered sessions not in the array. */
export function mergeSessions(incoming: Session[]) {
  for (const s of incoming) upsertSession(s);
}
