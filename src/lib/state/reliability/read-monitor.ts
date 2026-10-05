export type ReliabilityResourceName =
  | 'summary'
  | 'summaryAll'
  | 'events'
  | 'timeline'
  | 'flow'
  | 'usage'
  | 'activity'
  | 'perf'
  | 'pluginHealth'
  | 'insights'
  | 'skillStats'
  | 'credentialHealth'
  | 'architecture';
type FailurePhase = 'transport' | 'decode';

/** Fixed cardinality, one report per failure episode, at most one/minute per resource. */
export function createReadFailureMonitor(resource: ReliabilityResourceName) {
  let owner: symbol | null = null;
  let failed = false;
  let lastCapture = -Infinity;
  return {
    ready() {
      failed = false;
    },
    failed(token: symbol, phase: FailurePhase) {
      if (owner !== token) {
        owner = token;
        failed = false;
      }
      if (failed) return;
      failed = true;
      if (typeof window === 'undefined') return;
      const now = window.performance?.now?.() ?? Date.now();
      if (now - lastCapture < 60_000) return;
      try {
        const posthog = (
          window as Window & {
            posthog?: { capture: (event: string, properties: Record<string, unknown>) => unknown };
          }
        ).posthog;
        if (!posthog) return;
        lastCapture = now;
        // Never send query/tenant/actor identifiers, response content or exception text.
        posthog.capture('reliability_read_failed', { resource, phase, schema_version: 1 });
      } catch {
        // Monitoring must not turn a contained read failure into a route exception.
      }
    },
  };
}
