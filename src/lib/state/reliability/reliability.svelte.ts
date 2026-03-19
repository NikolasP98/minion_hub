import { sendRequest } from '$lib/services/gateway.svelte';

export interface ReliabilityEvent {
  id?: number;
  category: string;
  severity: string;
  event: string;
  message: string;
  agentId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface ReliabilitySummary {
  total: number;
  uptimeSinceMs?: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
}

export const reliability = $state({
  /** Recent events from the live WS stream */
  recentEvents: [] as ReliabilityEvent[],
  /** Summary from gateway */
  summary: null as ReliabilitySummary | null,
  /** Events from gateway query */
  events: [] as ReliabilityEvent[],
  loading: false,
  dateRange: {
    from: Date.now() - 86400000,
    to: Date.now(),
  },
});

/**
 * Push a live reliability event received from the gateway WebSocket.
 * No persistence — just keeps the last 200 in memory for the live feed.
 */
export function pushReliabilityEvent(event: ReliabilityEvent) {
  reliability.recentEvents = [...reliability.recentEvents.slice(-199), event];
}

/**
 * Load reliability summary from the gateway via WebSocket request.
 */
export async function loadReliabilitySummary(_serverId: string, from?: number, _to?: number) {
  reliability.loading = true;
  try {
    const params: Record<string, unknown> = {};
    if (from) params.since = from;

    const data = await sendRequest('reliability.summary', params) as ReliabilitySummary | null;
    if (data) {
      reliability.summary = {
        total: data.total ?? 0,
        uptimeSinceMs: data.uptimeSinceMs,
        byCategory: data.byCategory ?? {},
        bySeverity: data.bySeverity ?? {},
      };
    }
  } catch {
    // Gateway not connected or method not supported — non-critical
  } finally {
    reliability.loading = false;
  }
}

/**
 * Load reliability events from the gateway via WebSocket request.
 */
export async function loadReliabilityEvents(
  _serverId: string,
  opts?: { category?: string; from?: number; to?: number; limit?: number },
) {
  reliability.loading = true;
  try {
    const params: Record<string, unknown> = {};
    if (opts?.category) params.category = opts.category;
    if (opts?.from) params.since = opts.from;
    if (opts?.limit) params.limit = opts.limit;

    const data = await sendRequest('reliability.events', params) as { events?: ReliabilityEvent[] } | null;
    reliability.events = (data?.events ?? []).map((ev) => ({
      ...ev,
      timestamp: ev.timestamp ?? (ev as any).occurredAt,
    }));
  } catch {
    // Gateway not connected or method not supported — non-critical
  } finally {
    reliability.loading = false;
  }
}
