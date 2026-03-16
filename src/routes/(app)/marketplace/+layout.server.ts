import type { LayoutServerLoad } from './$types';
import { getDb } from '$server/db/client';
import { isCatalogStale, syncMarketplaceAgents } from '$server/services/marketplace.service';

export const load: LayoutServerLoad = async () => {
  const db = getDb();

  // Fire-and-forget background sync if catalog is stale (> 1 hour old).
  // We don't await so the page doesn't block on GitHub API calls.
  isCatalogStale(db).then((stale) => {
    if (stale) {
      syncMarketplaceAgents(db).catch((err) => {
        console.warn('[marketplace] auto-sync failed:', err.message);
      });
    }
  }).catch(() => {
    // Non-critical — ignore staleness check failures
  });

  return {};
};
