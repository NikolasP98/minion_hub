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
  /** Per-tool outcome breakdown by classified status (ok/error/timeout/auth_error). */
  toolOutcomes?: {
    ok: number;
    error: number;
    timeout: number;
    authError: number;
    total: number;
    byTool: { tool: string; ok: number; error: number; timeout: number; authError: number }[];
  };
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
