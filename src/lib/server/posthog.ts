import { building } from '$app/environment';
import { env } from '$env/dynamic/public';

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
