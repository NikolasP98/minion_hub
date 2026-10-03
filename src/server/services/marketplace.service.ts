import { eq, and, sql } from 'drizzle-orm';
import { marketplaceAgents, marketplaceInstalls } from '@minion-stack/db/pg';
import { newId } from '$server/db/utils';
import { withOrgCore } from '$server/db/with-org-core';
import { resolveGatewayId } from '$server/services/gateway.pg.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { CatalogDb } from './marketplace/types';

// Compatibility facade: reads, provider transport and leased workers are separated.
export type { MarketplaceAgentRecord, MarketplaceAgentUpsert } from './marketplace/types';
export type { MarketplaceFilters } from '$lib/marketplace/catalog';
export { listMarketplaceAgents, listMarketplacePage } from './marketplace/catalog-query';
export { syncMarketplaceAgents } from './marketplace/sync';
export { populateAgentFiles, getAgentWithFiles } from './marketplace/files';

export async function getMarketplaceAgent(db: CatalogDb, id: string) {
  const [agent] = await db
    .select()
    .from(marketplaceAgents)
    .where(eq(marketplaceAgents.id, id))
    .limit(1);
  return agent ?? null;
}

// ─── Install tracking ─────────────────────────────────────────────────────────

/**
 * Records a marketplace install. `serverId` is the legacy Turso server id; it's
 * bridged to the Supabase `gateway.id` via `resolveGatewayId`. If no gateway
 * bridges that serverId (e.g. a server not yet migrated to pg), the install-count
 * tracking is skipped — the user-facing install still succeeds — and null is
 * returned.
 */
export async function recordInstall(
  ctx: CoreCtx,
  agentId: string,
  serverId: string,
): Promise<string | null> {
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return null;

  const id = newId();

  // marketplace_installs is RLS-enforced + org-scoped → run under withOrgCore so
  // the `app_ledger` role + org GUC enforce isolation server-side.
  await withOrgCore(ctx, (tx) =>
    tx.insert(marketplaceInstalls).values({
      id,
      tenantId: ctx.tenantId,
      agentId,
      gatewayId,
    }),
  );

  // Increment install count on the GLOBAL catalog (marketplace_agents has no
  // tenant_id / `*_org_guc` policy) — must stay on ctx.db; under app_ledger the
  // catalog would be invisible and this update would silently affect zero rows.
  await ctx.db
    .update(marketplaceAgents)
    .set({ installCount: sql`${marketplaceAgents.installCount} + 1` })
    .where(eq(marketplaceAgents.id, agentId));

  // installCount feeds the listing's ordering, but sort-by-installCount tolerates
  // the cache's 10m staleness; busting the global catalog on every install is
  // self-defeating (each install evicts the whole catalog). The sync path
  // (syncMarketplaceAgents) still busts the tag, so the catalog refreshes there.

  return id;
}

export async function getInstallCountForTenant(ctx: CoreCtx, agentId: string) {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ id: marketplaceInstalls.id })
      .from(marketplaceInstalls)
      .where(
        and(
          eq(marketplaceInstalls.tenantId, ctx.tenantId),
          eq(marketplaceInstalls.agentId, agentId),
        ),
      ),
  );
  return rows.length;
}
