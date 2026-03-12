export interface ReliabilityEvent {
  category: 'cron' | 'browser' | 'timezone' | 'general' | 'auth' | 'skill' | 'agent' | 'gateway';
  severity: 'critical' | 'high' | 'medium' | 'low';
  event: string;
  message: string;
  agentId?: string;
  sessionKey?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface ReliabilitySummary {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  topEvents: Array<{ event: string; count: number }>;
  timeseries: Array<{ bucket: number; category: string; count: number }>;
  bucketMs: number;
}

export const reliability = $state({
  /** Recent events from the live WS stream (not persisted) */
  recentEvents: [] as ReliabilityEvent[],
  /** Persisted summary from API */
  summary: null as ReliabilitySummary | null,
  /** Persisted events from API */
  events: [] as ReliabilityEvent[],
  loading: false,
  dateRange: {
    from: Date.now() - 86400000,
    to: Date.now(),
  },
});

// ── Batching ──────────────────────────────────────────────────────────────────

let pendingBatch: ReliabilityEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let serverId: string | null = null;

export function setReliabilityServerId(id: string | null) {
  serverId = id;
}

export function pushReliabilityEvent(event: ReliabilityEvent) {
  // Keep last 200 in live state
  reliability.recentEvents = [...reliability.recentEvents.slice(-199), event];
  pendingBatch.push(event);

  if (!flushTimer) {
    flushTimer = setTimeout(flushBatch, 2000);
  }
}

async function flushBatch() {
  flushTimer = null;
  if (pendingBatch.length === 0 || !serverId) return;

  const batch = pendingBatch;
  pendingBatch = [];

  try {
    await fetch('/api/reliability/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: batch.map((ev) => ({
          serverId,
          agentId: ev.agentId,
          category: ev.category,
          severity: ev.severity,
          event: ev.event,
          message: ev.message,
          metadata: ev.metadata ? JSON.stringify(ev.metadata) : undefined,
          occurredAt: ev.timestamp,
        })),
      }),
    });
  } catch {
    // Non-critical — events may be lost, don't retry
  }
}

export async function loadReliabilitySummary(sid: string, from?: number, to?: number) {
  reliability.loading = true;
  try {
    const params = new URLSearchParams({ serverId: sid });
    if (from) params.set('from', String(from));
    if (to) params.set('to', String(to));
    const res = await fetch(`/api/reliability/summary?${params}`);
    if (res.ok) {
      const data = await res.json();
      // SQLite returns computed values as strings — coerce to numbers
      if (data.timeseries) {
        data.timeseries = data.timeseries.map((p: any) => ({
          ...p,
          bucket: Number(p.bucket),
          count: Number(p.count),
        }));
      }
      if (data.topEvents) {
        data.topEvents = data.topEvents.map((e: any) => ({
          ...e,
          count: Number(e.count),
        }));
      }
      data.bucketMs = Number(data.bucketMs);
      for (const key in data.byCategory) data.byCategory[key] = Number(data.byCategory[key]);
      for (const key in data.bySeverity) data.bySeverity[key] = Number(data.bySeverity[key]);
      data.total = Number(data.total);
      reliability.summary = data;
    }
  } catch {
    // non-critical
  } finally {
    reliability.loading = false;
  }
}

export async function loadReliabilityEvents(
  sid: string,
  opts?: { category?: string; from?: number; to?: number; limit?: number },
) {
  reliability.loading = true;
  try {
    const params = new URLSearchParams({ serverId: sid });
    if (opts?.category) params.set('category', opts.category);
    if (opts?.from) params.set('from', String(opts.from));
    if (opts?.to) params.set('to', String(opts.to));
    if (opts?.limit) params.set('limit', String(opts.limit));
    const res = await fetch(`/api/reliability/events?${params}`);
    if (res.ok) {
      const data = await res.json();
      reliability.events = (data.events ?? []).map((ev: Record<string, unknown>) => ({
        ...ev,
        timestamp: ev.occurredAt ?? ev.timestamp,
      }));
    }
  } catch {
    // non-critical
  } finally {
    reliability.loading = false;
  }
}
