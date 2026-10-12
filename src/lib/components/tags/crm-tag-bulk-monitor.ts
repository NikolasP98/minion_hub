/** Identity-free diagnostics through the existing client, bounded to one report per minute. */
let lastCapture = -Infinity;
export function reportCrmTagBulkFailure(
  outcome: 'failed' | 'partial' | 'unknown' | 'committed-refresh-failed',
): void {
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
    // Never include IDs, tag names, exception text, requests, or response content.
    posthog.capture('crm_bulk_tag_failure', { outcome, schema_version: 1 });
  } catch {
    // A telemetry failure must never change the acknowledged write outcome.
  }
}
