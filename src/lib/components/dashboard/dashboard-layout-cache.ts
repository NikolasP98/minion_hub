import type { GridLayout } from './editable-grid';

type FetchLayout = (input: string) => Promise<Pick<Response, 'ok' | 'json'>>;
type CacheEntry = { expiresAt: number; value: Promise<GridLayout | null> };

const FIVE_MINUTES_MS = 5 * 60_000;
const layouts = new Map<string, CacheEntry>();
const cacheKey = (orgId: string, dashboardId: string) => `${orgId}:${dashboardId}`;

/** Org-aware, in-flight-coalescing cache for defaults reused across dashboard
 * navigation. The server has its own cache; this layer also removes the fetch. */
export function loadDashboardLayout(
  orgId: string,
  dashboardId: string,
  fetchLayout: FetchLayout = fetch,
  now = Date.now(),
): Promise<GridLayout | null> {
  const key = cacheKey(orgId, dashboardId);
  const existing = layouts.get(key);
  if (existing && existing.expiresAt > now) return existing.value;

  const value = fetchLayout(`/api/dashboard-layouts/${encodeURIComponent(dashboardId)}`)
    .then(async (response) => {
      if (!response.ok) return null;
      const body = (await response.json()) as { layout?: GridLayout | null };
      return body.layout?.order ? body.layout : null;
    })
    .catch((cause) => {
      layouts.delete(key);
      throw cause;
    });
  layouts.set(key, { expiresAt: now + FIVE_MINUTES_MS, value });
  return value;
}

export function primeDashboardLayout(orgId: string, dashboardId: string, layout: GridLayout): void {
  layouts.set(cacheKey(orgId, dashboardId), {
    expiresAt: Date.now() + FIVE_MINUTES_MS,
    value: Promise.resolve(layout),
  });
}

export function clearDashboardLayoutCache(): void {
  layouts.clear();
}
