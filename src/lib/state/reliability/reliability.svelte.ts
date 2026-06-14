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

/** Full-coverage agent-activity aggregate (reliability.activity RPC). */
export interface ActivityAggregate {
  memory: {
    created: number;
    updated: number;
    deleted: number;
    /** memory.recall events — reads/retrievals (distinguishes "no writes" from "no memory activity"). */
    reads?: number;
    total: number;
    byType: { key: string; value: number }[];
    lastTs: number;
  };
  heartbeat: {
    ok: number;
    failed: number;
    skipped: number;
    sent: number;
    total: number;
    lastTs: number;
    lastStatus: string;
  };
  tools: { ok: number; err: number; total: number; top: { key: string; value: number }[] };
  proactivity: {
    proactive: number;
    reactive: number;
    interAgent: number;
    other: number;
    total: number;
  };
  generatedAt: number;
}

/** One gateway perf snapshot (parsed from a gateway.perf_snapshot event). */
export interface PerfSnapshot {
  ts: number;
  windowMs: number;
  requests: number;
  throughputPerSec: number;
  errorRate: number;
  latencyMs: { p50: number; p95: number; p99: number; max: number };
  slowestMethods: {
    method: string;
    count: number;
    errors: number;
    p50: number;
    p95: number;
    max: number;
  }[];
  eventLoopDelayMs: { mean: number; p50: number; p99: number; max: number };
}

/** Gateway perf time series (reliability.perf RPC). */
export interface PerfSeries {
  snapshots: PerfSnapshot[];
  latest: PerfSnapshot | null;
}

export const reliability = $state({
  /** Recent events from the live WS stream */
  recentEvents: [] as ReliabilityEvent[],
  /** Filter-aware summary (counts for the active severity/category/mode) → KPIs. */
  summary: null as ReliabilitySummary | null,
  /** UNFILTERED (date-only) summary → drives the filter dropdown facet counts, so
   *  every severity/category shows its true total regardless of what's selected. */
  summaryAll: null as ReliabilitySummary | null,
  /** Mode→category→severity flow breakdown (reliability.flow RPC) — server-
   *  aggregated over the FULL filtered population so the Event Flow sankey isn't
   *  truncated by the raw-event row cap. null → fall back to client events. */
  flow: null as { event: string; category: string; severity: string; count: number }[] | null,
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
  /** Server-side agent-activity aggregate (reliability.activity RPC). null → fall
   *  back to client-side derivation over the (capped) loaded events. */
  activity: null as ActivityAggregate | null,
  /** Gateway request-handler perf series (reliability.perf RPC). null → older
   *  gateway without the RPC, or not connected → latency panel hidden. */
  perf: null as PerfSeries | null,
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
export async function loadReliabilityTimeline(
  from: number,
  to: number,
  filters?: { severities?: string[]; categories?: string[]; eventModes?: string[] },
) {
  try {
    const params: Record<string, unknown> = { since: from, until: to };
    if (filters?.severities && filters.severities.length) params.severities = filters.severities;
    if (filters?.categories && filters.categories.length) params.categories = filters.categories;
    if (filters?.eventModes && filters.eventModes.length) params.eventModes = filters.eventModes;
    const data = (await sendRequest('reliability.timeline', params)) as {
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
 * Fetch the full-coverage agent-activity aggregate (memory/heartbeat/tools/
 * proactivity) over the range — bypasses the 2,000-event cap so the Agent
 * Activity panel shows fleet-wide totals. Sets `activity = null` on older
 * gateways → UI falls back to client-side derivation over loaded events.
 */
export async function loadReliabilityActivity(from: number, to: number) {
  try {
    const data = (await sendRequest('reliability.activity', {
      since: from,
      until: to,
    })) as ActivityAggregate | null;
    reliability.activity = data && data.memory && data.heartbeat ? data : null;
  } catch {
    reliability.activity = null;
  }
}

/**
 * Fetch the gateway perf time series (per-method latency p50/p95/p99/max,
 * throughput, error rate, slowest methods, event-loop delay) parsed from the
 * `gateway.perf_snapshot` events the gateway emits every 60s. Sets `perf = null`
 * on older gateways that lack the RPC → the latency panel hides itself.
 */
export async function loadReliabilityPerf(from: number, to: number) {
  try {
    const data = (await sendRequest('reliability.perf', {
      since: from,
      until: to,
    })) as PerfSeries | null;
    reliability.perf =
      data && Array.isArray(data.snapshots) && data.snapshots.length > 0 ? data : null;
  } catch {
    reliability.perf = null;
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
export async function loadReliabilitySummary(
  _serverId: string,
  from?: number,
  to?: number,
  filters?: { severities?: string[]; categories?: string[]; eventModes?: string[] },
) {
  reliability.loading = true;
  try {
    const params: Record<string, unknown> = {};
    if (from) params.since = from;
    if (to) params.until = to;
    // Filter-aware counts so the KPI numbers stay correct under any filter combo
    // (the raw-event sample is row-capped and biased toward high-volume severities).
    if (filters?.severities && filters.severities.length) params.severities = filters.severities;
    if (filters?.categories && filters.categories.length) params.categories = filters.categories;
    if (filters?.eventModes && filters.eventModes.length) params.eventModes = filters.eventModes;

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
 * Load the UNFILTERED (date-only) summary used for the filter-dropdown facet
 * counts — so every severity/category shows its true total regardless of which
 * filters are applied. Separate from the filter-aware `summary` (which drives the
 * KPI numbers).
 */
export async function loadReliabilitySummaryAll(_serverId: string, from?: number, to?: number) {
  try {
    const params: Record<string, unknown> = {};
    if (from) params.since = from;
    if (to) params.until = to;
    const data = (await sendRequest('reliability.summary', params)) as ReliabilitySummary | null;
    if (data) {
      reliability.summaryAll = {
        total: data.total ?? 0,
        uptimeSinceMs: data.uptimeSinceMs,
        byCategory: data.byCategory ?? {},
        bySeverity: data.bySeverity ?? {},
      };
    }
  } catch {
    // non-critical
  }
}

/**
 * Load the server-aggregated mode→category→severity flow breakdown (filter-aware)
 * so the Event Flow sankey reflects the FULL filtered population instead of the
 * row-capped raw-event sample. Sets `flow = null` on older gateways → the UI falls
 * back to deriving the sankey from the (capped) loaded events.
 */
export async function loadReliabilityFlow(
  from: number,
  to: number,
  filters?: { severities?: string[]; categories?: string[]; eventModes?: string[] },
) {
  try {
    const params: Record<string, unknown> = { since: from, until: to };
    if (filters?.severities && filters.severities.length) params.severities = filters.severities;
    if (filters?.categories && filters.categories.length) params.categories = filters.categories;
    if (filters?.eventModes && filters.eventModes.length) params.eventModes = filters.eventModes;
    const data = (await sendRequest('reliability.flow', params)) as {
      rows?: { event: string; category: string; severity: string; count: number }[];
    } | null;
    reliability.flow = Array.isArray(data?.rows) ? data.rows : null;
  } catch {
    reliability.flow = null;
  }
}

/**
 * Load reliability events from the gateway via WebSocket request.
 * Fetches in pages of PAGE_SIZE to keep WS frames small.
 */
export async function loadReliabilityEvents(
  _serverId: string,
  opts?: {
    category?: string;
    from?: number;
    to?: number;
    limit?: number;
    /** Server-side multi-select filters so rare-severity/mode events surface
     *  past the per-request row cap (instead of filtering a recent sample). */
    severities?: string[];
    categories?: string[];
    eventModes?: string[];
  },
) {
  reliability.loading = true;
  try {
    const params: Record<string, unknown> = { limit: PAGE_SIZE };
    if (opts?.category) params.category = opts.category;
    if (opts?.severities && opts.severities.length) params.severities = opts.severities;
    if (opts?.categories && opts.categories.length) params.categories = opts.categories;
    if (opts?.eventModes && opts.eventModes.length) params.eventModes = opts.eventModes;
    if (opts?.from) params.since = opts.from;
    if (opts?.to) params.until = opts.to;

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
