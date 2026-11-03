import { page } from '$app/state';

/**
 * Does the org's plan grant `key` (spec 043)? Exact membership in the (app) layout's expanded
 * list. No entitlements in page.data (pages outside that layout) = entitled, as before plans
 * existed. Lives here, not in can.svelte.ts, so light modules avoid can's nav-model imports.
 */
export function hasFeature(key: string): boolean {
  const features = (page.data as { entitlements?: { features?: string[] } | null }).entitlements
    ?.features;
  return !features || features.includes(key);
}

/**
 * Spec 043: a plan-gated answer. Inline AI controls are not rendered without the feature, so only
 * a tab rendered before a downgrade sees one; its call site drops it silently as "no result".
 * Matches a gateway `FORBIDDEN` with `details.reason`, and an `ApiError` (fetchJson) whose body
 * carries `code`.
 */
export function isPremiumRequired(e: unknown): boolean {
  const details = (e as { details?: { reason?: unknown; code?: unknown } } | null)?.details;
  return details?.reason === 'premium_required' || details?.code === 'premium_required';
}

/** Same check for a raw `fetch` Response: a 403 whose JSON body has `code: 'premium_required'`. */
export async function isPremiumResponse(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown } | null;
  return body?.code === 'premium_required';
}
