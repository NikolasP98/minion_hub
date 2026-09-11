import { building } from '$app/environment';
import { env } from '$env/dynamic/public';
import type { PostHog } from 'posthog-node';
import { isServerEvent, sanitizeEventProperties } from './observability-context';

let clientPromise: Promise<PostHog> | null = null;

// Private: every server producer must use the bounded capture boundary below.
function getPostHogClient(): Promise<PostHog | null> {
  if (building || !env.PUBLIC_POSTHOG_KEY) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('posthog-node')
      .then(({ PostHog }) => {
        const client = new PostHog(env.PUBLIC_POSTHOG_KEY!, {
          host: env.PUBLIC_POSTHOG_HOST,
          flushAt: 20,
          flushInterval: 10_000,
          requestTimeout: 3000,
          fetchRetryCount: 0,
          fetchRetryDelay: 0,
        });
        client.on('error', () => {});
        return client;
      })
      .catch((error: unknown) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}

/** Fixed server events only. Telemetry never throws into, or waits on, business
 * operations. Error-path flushes are observed without changing SDK batching. */
export function captureServerEvent(params: {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  flush?: boolean;
}): void {
  try {
    const descriptor = (key: keyof typeof params) => Object.getOwnPropertyDescriptor(params, key);
    const event: unknown = descriptor('event')?.value;
    const distinctId: unknown = descriptor('distinctId')?.value;
    if (
      !isServerEvent(event) ||
      typeof distinctId !== 'string' ||
      !/^(?:server|(?:org|user):[A-Za-z0-9_.:-]{1,128})$/.test(distinctId)
    )
      return;
    const properties = sanitizeEventProperties(descriptor('properties')?.value, event);
    const flush = descriptor('flush')?.value === true;
    void getPostHogClient()
      .then(async (client) => {
        if (!client) return;
        client.capture({ distinctId, event, properties });
        // TODO(handoff): qualify error-storm flush fan-out and serverless delivery;
        // promise containment alone does not prove either. See meta-repo
        // proposals/2026-09-11-hub-telemetry-boundary-followups.md.
        if (flush) await client.flush();
      })
      .catch(() => {});
  } catch {
    // Includes hostile top-level proxies and SDK/configuration access failures.
  }
}
