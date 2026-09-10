import { building } from '$app/environment';
import { env } from '$env/dynamic/public';
import { sanitizeEventProperties } from './observability-context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let posthogClient: any = null;

export async function getPostHogClient() {
  if (building || !env.PUBLIC_POSTHOG_KEY) return null;
  if (!posthogClient) {
    const { PostHog } = await import('posthog-node');
    posthogClient = new PostHog(env.PUBLIC_POSTHOG_KEY, {
      host: env.PUBLIC_POSTHOG_HOST,
      // M8: flushAt:1/flushInterval:0 made every capture a synchronous HTTP
      // round-trip — during an error storm that fans out one request per error.
      // Batch instead: send when 20 events queue OR every 10s, whichever first.
      // The posthog-node client flushes its queue on shutdown, so batching does
      // not drop events on a clean exit.
      flushAt: 20,
      flushInterval: 10_000,
      requestTimeout: 3000,
      fetchRetryCount: 0,
      fetchRetryDelay: 0,
    });
    posthogClient.on('error', () => {});
  }
  return posthogClient;
}

/**
 * OBS-01: the only server-side capture path. Every property bag goes through
 * `sanitizeEventProperties` here, so a caller cannot ship an unsanitized
 * payload by forgetting to call the sanitizer. Fire-and-forget by contract —
 * never awaited on a request or error path (M8: an error storm must not fan
 * out into synchronous HTTP round-trips), and never throwing, so telemetry
 * cannot mask the original failure.
 */
export function captureServerEvent(params: {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  /** Nudge the batched queue out without blocking — used on the error path. */
  flush?: boolean;
}): void {
  const properties = sanitizeEventProperties(params.properties);
  void getPostHogClient()
    .then((posthog) => {
      posthog?.capture({ distinctId: params.distinctId, event: params.event, properties });
      if (params.flush) void posthog?.flush?.();
    })
    .catch(() => {});
}
