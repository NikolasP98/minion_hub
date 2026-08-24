import type { Handle } from '@sveltejs/kit';

interface ServerTimingDeps {
  /** 0..1 — share of requests whose duration is captured as an analytics event.
   *  The Server-Timing response header is set on EVERY request regardless. */
  sampleRate: number;
  capture: (event: string, properties: Record<string, unknown>) => void;
  random?: () => number;
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
  const { sampleRate, capture, random = Math.random } = deps;
  return async ({ event, resolve }) => {
    // The PostHog ingest proxy is high-volume telemetry traffic, not app
    // latency — measuring it would drown the signal.
    if (event.url.pathname.startsWith('/ingest')) return resolve(event);

    const startedAt = performance.now();
    const response = await resolve(event);
    const durationMs = Math.round(performance.now() - startedAt);

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

    if (random() < sampleRate) {
      capture('server_timing', {
        route: event.route.id,
        path: event.url.pathname,
        method: event.request.method,
        duration_ms: durationMs,
        status: response.status,
      });
    }
    return response;
  };
}
