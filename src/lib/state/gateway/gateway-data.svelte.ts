import type { Agent, Session, PresenceEntry, HelloOk } from '@minion-stack/shared';
import { page } from '$app/state';
import { userState } from '$lib/state/features/user.svelte';
import { filterAgentsByOrg, type OrgRef } from './agent-org';

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
  channels: null as {
    active?: number;
    ts?: number;
    channelOrder?: string[];
    channelLabels?: Record<string, string>;
    channelDetailLabels?: Record<string, string>;
    channelAccounts?: Record<
      string,
      {
        accountId: string;
        name?: string | null;
        enabled?: boolean | null;
        configured?: boolean | null;
        running?: boolean | null;
        connected?: boolean | null;
        reconnectAttempts?: number | null;
        lastError?: string | null;
      }[]
    >;
  } | null,
  cronJobs: [] as unknown[],
  lastSeq: null as number | null,
  // Channel ids (gw:<type>:<accountId>) in an active QR-pairing window. Set on
  // channels.whatsapp.qr, cleared on paired/pairFailed. Lets the pill show
  // "Pairing" during the scan, when the gateway has stopped the provider
  // (gwRunning=false) and the snapshot alone would derive a misleading "Starting".
  pairingChannelIds: [] as string[],
});

/**
 * Agents visible in the current context, after two layers of scoping:
 *   1. Org scope — agents are partitioned between the FACES SCULPTORS and MINION
 *      orgs by the name rule (see `agent-org.ts`); only those belonging to the
 *      active org are shown. Applies to everyone, admins included.
 *   2. User scope — non-admins are further limited to their `allowedAgentIds`.
 *      Admins (allowedAgentIds === null) see everything in the active org.
 */
// Memoized via $derived so it recomputes only when its real inputs change
// (gw.agents, page.data org scope, userState.allowedAgentIds) — NOT on every
// gw.lastSeq/health/presence bump. Svelte 5 tracks per-property, so reading
// `gw.agents` here does not subscribe to other `gw` fields. Exposed through the
// existing `.value` getter so all consumers keep working (you can't export a
// bare $derived).
const _visibleAgents = $derived.by((): Agent[] => {
  const orgs = ((page.data as { organizations?: OrgRef[] })?.organizations ?? []) as OrgRef[];
  const activeOrgId = (page.data as { activeOrgId?: string | null })?.activeOrgId ?? null;
  const brainAgentIds = ((page.data as { brainAgentIds?: string[] })?.brainAgentIds ?? []) as string[];
  const scoped = filterAgentsByOrg(gw.agents, activeOrgId, orgs, brainAgentIds);

  const allowed = userState.allowedAgentIds;
  if (allowed === null) return scoped;
  return scoped.filter((a) => allowed.has(a.id));
});

export const visibleAgents = {
  get value(): Agent[] {
    return _visibleAgents;
  },
};

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
