import type { Handle } from '@sveltejs/kit';
import type { PerformanceSample } from '$lib/types/performance-monitor';
import {
  createPerformanceContext,
  currentPerformanceSnapshot,
  runWithPerformanceContext,
} from './performance-context';

const INSTANCE_STARTED_AT = Date.now();
let instanceRequestOrdinal = 0;

interface ServerTimingDeps {
  /** 0..1 — share of requests whose duration is captured as an analytics event.
   *  The Server-Timing response header is set on EVERY request regardless. */
  sampleRate: number;
  capture: (event: string, properties: Record<string, unknown>) => void;
  persist?: (orgId: string, sample: PerformanceSample) => void;
  random?: () => number;
  now?: () => number;
  wallClock?: () => number;
  nextOrdinal?: () => number;
  instanceStartedAt?: number;
}

/** Request-local stage recorder for expensive server loads and API handlers. */
export class ServerTiming {
  private readonly entries: string[] = [];

  constructor(private readonly now: () => number = () => performance.now()) {}

  async measure<T>(name: string, work: () => Promise<T>): Promise<T> {
    const startedAt = this.now();
    try {
      return await work();
    } finally {
      const durationMs = Math.max(0, Math.round(this.now() - startedAt));
      this.entries.push(`${name};dur=${durationMs}`);
    }
  }

  headerValue(): string {
    return this.entries.join(', ');
  }
}

/**
 * Route-level server timing. The hub had zero request-layer latency signal in
 * prod (the only instrumentation was a >3s console.warn that died in stdout);
 * this handle is the server half of the perf RUM contract
 * (specs/2026-08-22-hub-load-nav-performance-spec.md S2): every response gets a
 * `Server-Timing: app;dur=<ms>` header (visible in browser devtools + Vercel
 * logs), and a sampled `server_timing` analytics event records route id,
 * duration, and status.
 */
export function createServerTimingHandle(deps: ServerTimingDeps): Handle {
  const {
    sampleRate,
    capture,
    persist,
    random = Math.random,
    now = () => performance.now(),
    wallClock = Date.now,
    nextOrdinal = () => ++instanceRequestOrdinal,
    instanceStartedAt = INSTANCE_STARTED_AT,
  } = deps;
  return async ({ event, resolve }) => {
    // The PostHog ingest proxy is high-volume telemetry traffic, not app
    // latency — measuring it would drown the signal.
    if (event.url.pathname.startsWith('/ingest')) return resolve(event);

    const ordinal = nextOrdinal();
    const isolateCold = ordinal === 1;
    const startedAt = now();
    const timestamp = wallClock();

    return runWithPerformanceContext(createPerformanceContext(), async () => {
      const response = await resolve(event);
      const durationMs = Math.max(0, Math.round(now() - startedAt));

      try {
        const routeTiming = response.headers.get('Server-Timing');
        response.headers.set(
          'Server-Timing',
          routeTiming ? `${routeTiming}, app;dur=${durationMs}` : `app;dur=${durationMs}`,
        );
      } catch {
        // Some responses (e.g. redirects created with immutable headers) refuse
        // mutation — the sampled event below still records the duration.
      }

      const measured = currentPerformanceSnapshot();
      const cacheCold = measured.cache.status === 'miss' || measured.cache.status === 'error';
      const slow = durationMs >= 3_000;
      const sampleReason =
        isolateCold && cacheCold
          ? 'isolate+cache-miss'
          : isolateCold
            ? 'isolate-cold'
            : cacheCold
              ? 'cache-miss'
              : slow
                ? 'slow'
                : 'sampled-warm';
      const shouldSample = isolateCold || cacheCold || slow || random() < sampleRate;

      if (shouldSample) {
        const sample: PerformanceSample = {
          timestamp,
          route: event.route.id ?? '[unmatched]',
          method: event.request.method,
          status: response.status,
          durationMs,
          isolateCold,
          requestOrdinal: ordinal,
          instanceAgeMs: Math.max(0, timestamp - instanceStartedAt),
          cache: measured.cache,
          database: measured.database,
          region: process.env.VERCEL_REGION ?? null,
          deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
          commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        };
        try {
          capture('server_timing', {
            route: event.route.id,
            path: event.url.pathname,
            method: event.request.method,
            duration_ms: durationMs,
            status: response.status,
            sample_reason: sampleReason,
            isolate_cold: isolateCold,
            request_ordinal: ordinal,
            instance_age_ms: sample.instanceAgeMs,
            cache_status: measured.cache.status,
            cache_hits: measured.cache.hits,
            cache_stale_hits: measured.cache.staleHits,
            cache_misses: measured.cache.misses,
            cache_errors: measured.cache.errors,
            db_transactions: measured.database.transactions,
            db_acquire_ms: measured.database.acquireMs,
            db_setup_ms: measured.database.setupMs,
            db_query_ms: measured.database.queryMs,
            db_total_ms: measured.database.totalMs,
            region: sample.region,
            deployment_id: sample.deploymentId,
            commit_sha: sample.commitSha,
          });
        } catch {
          // Analytics is independent from the durable org monitor.
        }
        try {
          const orgId = event.locals.orgId ?? event.locals.tenantCtx?.tenantId;
          if (orgId && event.route.id !== '/api/reliability/performance') persist?.(orgId, sample);
        } catch {
          // Performance instrumentation must never fail the measured request.
        }
      }
      return response;
    });
  };
}
