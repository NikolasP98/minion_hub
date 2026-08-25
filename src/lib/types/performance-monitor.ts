export type CachePerformanceStatus = 'none' | 'hit' | 'stale' | 'miss' | 'error';

export interface CachePerformanceSnapshot {
  status: CachePerformanceStatus;
  hits: number;
  staleHits: number;
  misses: number;
  errors: number;
  lookupMs: number;
}

export interface DatabasePerformanceSnapshot {
  transactions: number;
  acquireMs: number;
  setupMs: number;
  queryMs: number;
  totalMs: number;
}

/** One sampled server request. Route ids are templates (for example
 * `/(app)/crm/[id]`), never raw URLs or record identifiers. */
export interface PerformanceSample {
  timestamp: number;
  route: string;
  method: string;
  status: number;
  durationMs: number;
  isolateCold: boolean;
  requestOrdinal: number;
  instanceAgeMs: number;
  cache: CachePerformanceSnapshot;
  database: DatabasePerformanceSnapshot;
  region: string | null;
  deploymentId: string | null;
  commitSha: string | null;
}

export interface PerformanceRouteSummary {
  route: string;
  samples: number;
  coldSamples: number;
  isolateColdSamples: number;
  cacheMissSamples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  coldP95Ms: number;
  dbP95Ms: number;
  cacheP95Ms: number;
  slowRate: number;
  cacheMissRate: number;
  lastSeenAt: number;
}

export interface PerformanceTimelinePoint {
  timestamp: number;
  samples: number;
  coldSamples: number;
  p50Ms: number;
  p95Ms: number;
  coldP95Ms: number;
}

export interface PerformanceMonitorSnapshot {
  available: boolean;
  generatedAt: number;
  range: { from: number; to: number };
  truncated: boolean;
  effectiveRange: { from: number; to: number };
  summary: {
    totalSamples: number;
    coldSamples: number;
    isolateColdSamples: number;
    cacheMissSamples: number;
    slowSamples: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    coldP95Ms: number;
    dbP95Ms: number;
  };
  cache: {
    hits: number;
    staleHits: number;
    misses: number;
    errors: number;
    hitRate: number;
    lookupP50Ms: number;
    lookupP95Ms: number;
    totalLookupMs: number;
  };
  routes: PerformanceRouteSummary[];
  timeline: PerformanceTimelinePoint[];
  recentSlow: PerformanceSample[];
}
