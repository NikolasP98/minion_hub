import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { supabaseBrowser } from '$lib/supabase/client';

export const MESSAGE_COMMITTED_EVENT = 'message.committed' as const;

export type MessageCommittedEvent = {
  version: 1;
  id: string;
  clientId: string;
  channel: string;
  accountId: string | null;
  chatId: string | null;
  direction: 'inbound' | 'outbound';
  occurredAt: string;
};

export type OrgRealtimeStatus =
  'CONNECTING' | 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

type EventHandler = (payload: unknown) => void;
type StatusHandler = (status: OrgRealtimeStatus, error?: Error) => void;

type BroadcastEnvelope = {
  event?: unknown;
  payload?: unknown;
};

type OrgChannelEntry = {
  client: SupabaseClient;
  channel: RealtimeChannel;
  handlers: Map<string, Set<EventHandler>>;
  statusHandlers: Set<StatusHandler>;
  status: OrgRealtimeStatus;
  closed: boolean;
};

const orgChannels = new Map<string, OrgChannelEntry>();

export function orgRealtimeTopic(orgId: string): string {
  return `org:${orgId}:events`;
}

function dispatch(entry: OrgChannelEntry, envelope: BroadcastEnvelope): void {
  if (typeof envelope.event !== 'string') return;
  const handlers = entry.handlers.get(envelope.event);
  if (!handlers) return;
  for (const handler of handlers) handler(envelope.payload);
}

function setStatus(entry: OrgChannelEntry, status: OrgRealtimeStatus, error?: Error): void {
  entry.status = status;
  for (const handler of entry.statusHandlers) handler(status, error);
}

function createOrgChannel(orgId: string): OrgChannelEntry {
  const client = supabaseBrowser() as SupabaseClient;
  const channel = client.channel(orgRealtimeTopic(orgId), {
    config: { private: true },
  });
  const entry: OrgChannelEntry = {
    client,
    channel,
    handlers: new Map(),
    statusHandlers: new Set(),
    status: 'CONNECTING',
    closed: false,
  };

  channel.on('broadcast', { event: '*' }, (envelope) => dispatch(entry, envelope));

  // Supabase-js keeps this token updated after auth refreshes. Calling setAuth
  // before the first private-channel join also covers a session restored from
  // the SSR cookie on initial hydration.
  void client.realtime
    .setAuth()
    .then(() => {
      if (entry.closed) return;
      channel.subscribe((status, error) => {
        if (entry.closed) return;
        setStatus(entry, status as OrgRealtimeStatus, error);
      });
    })
    .catch((error: unknown) => {
      if (entry.closed) return;
      setStatus(entry, 'CHANNEL_ERROR', error instanceof Error ? error : new Error(String(error)));
    });

  return entry;
}

function ensureOrgChannel(orgId: string): OrgChannelEntry {
  const existing = orgChannels.get(orgId);
  if (existing) return existing;
  const entry = createOrgChannel(orgId);
  orgChannels.set(orgId, entry);
  return entry;
}

function releaseOrgChannel(orgId: string, entry: OrgChannelEntry): void {
  const hasHandlers = [...entry.handlers.values()].some((handlers) => handlers.size > 0);
  if (hasHandlers || entry.statusHandlers.size > 0) return;
  if (orgChannels.get(orgId) !== entry) return;
  entry.closed = true;
  orgChannels.delete(orgId);
  void entry.client.removeChannel(entry.channel);
}

/**
 * Subscribe to one event on the org's shared private channel.
 *
 * Components in the same tab/org share one channel and one authorization join.
 * The event is a change signal; callers still fetch canonical data through the
 * existing SvelteKit/API path, preserving RBAC and field masking.
 */
export function subscribeOrgBroadcast(
  orgId: string,
  event: string,
  handler: EventHandler,
  onStatus?: StatusHandler,
): () => void {
  if (!orgId || !event) return () => {};
  const entry = ensureOrgChannel(orgId);
  const handlers = entry.handlers.get(event) ?? new Set<EventHandler>();
  handlers.add(handler);
  entry.handlers.set(event, handlers);
  if (onStatus) {
    entry.statusHandlers.add(onStatus);
    onStatus(entry.status);
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    handlers.delete(handler);
    if (handlers.size === 0) entry.handlers.delete(event);
    if (onStatus) entry.statusHandlers.delete(onStatus);
    releaseOrgChannel(orgId, entry);
  };
}

export function isMessageCommittedEvent(payload: unknown): payload is MessageCommittedEvent {
  if (!payload || typeof payload !== 'object') return false;
  const event = payload as Partial<MessageCommittedEvent>;
  return (
    event.version === 1 &&
    typeof event.id === 'string' &&
    typeof event.clientId === 'string' &&
    typeof event.channel === 'string' &&
    (event.chatId === null || typeof event.chatId === 'string') &&
    (event.direction === 'inbound' || event.direction === 'outbound') &&
    typeof event.occurredAt === 'string'
  );
}

export function subscribeMessageCommitted(
  orgId: string,
  handler: (payload: MessageCommittedEvent) => void,
  onStatus?: StatusHandler,
): () => void {
  return subscribeOrgBroadcast(
    orgId,
    MESSAGE_COMMITTED_EVENT,
    (payload) => {
      if (isMessageCommittedEvent(payload)) handler(payload);
    },
    onStatus,
  );
}

/** Disconnect all org channels, primarily for logout/test cleanup. */
export function disconnectOrgRealtime(): void {
  for (const [orgId, entry] of orgChannels) {
    entry.handlers.clear();
    entry.statusHandlers.clear();
    releaseOrgChannel(orgId, entry);
  }
}
