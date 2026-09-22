import { eq } from 'drizzle-orm';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { appTableConfig } from '$server/db/pg-schema/table-config';
import { applyTablePatch, type TableConfig } from '$lib/tables/registry';
import { TABLE_REGISTRY } from '$lib/tables/defs';

/**
 * The org's table-config document (see `$lib/tables/registry.ts`). Read on
 * every app-layout load, so it is cached under the org's `settings` domain
 * tag; a missing row is `{}`. Never load-bearing: callers fail soft to `{}`.
 *
 * Opens its OWN withOrgCore transaction — never call from inside another one
 * (single-connection RLS pool, see crm-settings.service.ts).
 */
export async function readTableConfig(ctx: CoreCtx): Promise<TableConfig> {
  return cached(
    keys.hub('table-config', { t: ctx.tenantId }),
    { ttl: '30m', swr: '5m', tags: tags.tenantDomain(ctx.tenantId, 'settings') },
    async () =>
      withOrgCore(ctx, async (tx) => {
        const [row] = await tx
          .select({ value: appTableConfig.value })
          .from(appTableConfig)
          .where(eq(appTableConfig.orgId, ctx.tenantId))
          .limit(1);
        return (row?.value ?? {}) as TableConfig;
      }),
  );
}

/** Merge a patch (table id → overrides) into the document and persist it. */
export async function updateTableConfig(ctx: CoreCtx, patch: TableConfig): Promise<TableConfig> {
  const next = await withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ value: appTableConfig.value })
      .from(appTableConfig)
      .where(eq(appTableConfig.orgId, ctx.tenantId))
      .limit(1);
    const merged = applyTablePatch((row?.value ?? {}) as TableConfig, TABLE_REGISTRY, patch);
    await tx
      .insert(appTableConfig)
      .values({ orgId: ctx.tenantId, value: merged })
      .onConflictDoUpdate({
        target: appTableConfig.orgId,
        set: { value: merged, updatedAt: new Date() },
      });
    return merged;
  });
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'settings'));
  return next;
}
