import { env } from '$env/dynamic/private';

/**
 * Server-only URL config. Values are all env-overridable with the current
 * production literal as the fallback — do not import into client code.
 */

const DEFAULT_HUB_BASE_URL = 'https://hub.minion-ai.org';

/** Public base URL of this hub instance (OpenRouter HTTP-Referer, email links, …). */
export function hubBaseUrl(): string {
  return env.HUB_BASE_URL || env.PUBLIC_APP_URL || DEFAULT_HUB_BASE_URL;
}
