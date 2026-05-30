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

/** One origin/model combo from the server-side usage aggregate (reliability.usage). */
export interface UsageBucket {
  model: string;
  provider: string;
  channel: string;
  source: string;
  agentId: string;
  input: number;
  output: number;
  cacheRead: number;
  total: number;
  calls: number;
  /** Cost in integer micro-USD (USD × 1,000,000). */
  costMicroUsd: number;
}

export interface UsageTimelinePoint {
  t: number;
  input: number;
  output: number;
  cacheRead: number;
  total: number;
  costMicroUsd: number;
}

export interface UsageAggregate {
  buckets: UsageBucket[];
  timeline: UsageTimelinePoint[];
  total: {
    input: number;
    output: number;
    cacheRead: number;
    total: number;
    calls: number;
    costMicroUsd: number;
  };
  eventCount: number;
  generatedAt: number;
}

export const reliability = $state({
  /** Recent events from the live WS stream */
  recentEvents: [] as ReliabilityEvent[],
  /** Summary from gateway */
  summary: null as ReliabilitySummary | null,
  /** Events from gateway query */
  events: [] as ReliabilityEvent[],
  /** Server-aggregated stacked timeline (reliability.timeline RPC). null → fall
   *  back to client-side bucketing of `events` (older gateways). */
  timeline: null as {
    buckets: { bucket: number; category: string; count: number }[];
    bucketMs: number;
  } | null,
  /** Server-side LLM usage aggregate (reliability.usage RPC). null → fall back to
   *  client-side derivation over the (capped) loaded events on older gateways. */
  usage: null as UsageAggregate | null,
  loading: false,
  dateRange: {
    from: Date.now() - 86400000,
    to: Date.now(),
  },
});

/**
 * Fetch the server-aggregated stacked timeline so the whole date range
 * populates cheaply (instead of bucketing a capped raw-event dump). Falls back
 * to null (→ client bucketing) when the gateway predates reliability.timeline.
 */
export async function loadReliabilityTimeline(from: number, to: number) {
  try {
    const data = (await sendRequest('reliability.timeline', {
      since: from,
      until: to,
    })) as {
      buckets?: { bucket: number; category: string; count: number }[];
      bucketMs?: number;
    } | null;
    reliability.timeline =
      data?.buckets && data.buckets.length && data.bucketMs
        ? { buckets: data.buckets, bucketMs: data.bucketMs }
        : null;
  } catch {
    reliability.timeline = null;
  }
}

/**
 * Fetch the full-coverage LLM usage aggregate (by model/provider/channel/source/
 * agent) over the range. This bypasses the 2,000-event raw cap, so cost/origin
 * charts see every channel regardless of total event volume, and cost is
 * computed server-side (micro-USD). Sets `usage = null` on older gateways that
 * lack the RPC → the UI falls back to client-side derivation over loaded events.
 */
export async function loadReliabilityUsage(from: number, to: number) {
  try {
    const data = (await sendRequest('reliability.usage', {
      since: from,
      until: to,
    })) as UsageAggregate | null;
    reliability.usage =
      data && Array.isArray(data.buckets) && data.total ? data : null;
  } catch {
    // Method not supported (older gateway) or not connected — fall back to events.
    reliability.usage = null;
  }
}

/**
 * Push a live reliability event received from the gateway WebSocket.
 * Keeps the last 200 in memory for the live feed, and also appends to
 * the displayed events array if it falls within the active date range.
 */
export function pushReliabilityEvent(event: ReliabilityEvent) {
  const normalized: ReliabilityEvent = {
    ...event,
    timestamp: event.timestamp ?? (event as any).occurredAt,
  };
  reliability.recentEvents = [...reliability.recentEvents.slice(-199), normalized];

  // Also inject into displayed events so panels update live
  const { from, to } = reliability.dateRange;
  if (normalized.timestamp >= from && normalized.timestamp <= to) {
    reliability.events = [...reliability.events, normalized];
    // Keep the server-derived aggregates live too: increment total + the
    // category/severity buckets so the count badge, overview stat cells and
    // severity donut tick up in real time instead of waiting for the next
    // snapshot RPC (reliability.summary). This is what makes the page "catch
    // live changes" without a cache layer — the gateway already streams every
    // event, so we fold it into the existing summary rather than re-fetching.
    const s = reliability.summary;
    if (s) {
      reliability.summary = {
        ...s,
        total: s.total + 1,
        byCategory: {
          ...s.byCategory,
          [normalized.category]: (s.byCategory[normalized.category] ?? 0) + 1,
        },
        bySeverity: {
          ...s.bySeverity,
          [normalized.severity]: (s.bySeverity[normalized.severity] ?? 0) + 1,
        },
      };
    }
  }
}

/**
 * Max events to request per page.  Keeps WS frames under ~1MB.
 */
const PAGE_SIZE = 2000;

/**
 * Load reliability summary from the gateway via WebSocket request.
 * The summary is computed server-side via SQL aggregation — lightweight
 * regardless of how many events exist.
 */
export async function loadReliabilitySummary(_serverId: string, from?: number, _to?: number) {
  reliability.loading = true;
  try {
    const params: Record<string, unknown> = {};
    if (from) params.since = from;

    const data = (await sendRequest('reliability.summary', params)) as ReliabilitySummary | null;
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
 * Fetches in pages of PAGE_SIZE to keep WS frames small.
 */
export async function loadReliabilityEvents(
  _serverId: string,
  opts?: { category?: string; from?: number; to?: number; limit?: number },
) {
  reliability.loading = true;
  try {
    const params: Record<string, unknown> = { limit: PAGE_SIZE };
    if (opts?.category) params.category = opts.category;
    if (opts?.from) params.since = opts.from;

    const data = (await sendRequest('reliability.events', params)) as {
      events?: ReliabilityEvent[];
      total?: number;
      limit?: number;
    } | null;

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
