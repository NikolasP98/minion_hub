import { eq } from 'drizzle-orm';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { appNavConfig } from '$server/db/pg-schema/nav-config';
import { supabaseAdmin } from '$server/supabase';
import { normalizeNavConfig, type NavConfig } from '$lib/nav/custom-sections';

/**
 * The org's custom-navigation document (see `$lib/nav/custom-sections.ts`).
 * Read on every app-layout load, so it is cached under the org's `settings`
 * domain tag; a missing row is `EMPTY_NAV_CONFIG`. Never load-bearing: callers
 * fail soft to the empty config.
 *
 * Opens its OWN withOrgCore transaction — never call from inside another one
 * (single-connection RLS pool, see crm-settings.service.ts).
 */
export async function readNavConfig(ctx: CoreCtx): Promise<NavConfig> {
  return cached(
    keys.hub('nav-config', { t: ctx.tenantId }),
    { ttl: '30m', swr: '5m', tags: tags.tenantDomain(ctx.tenantId, 'settings') },
    async () =>
      withOrgCore(ctx, async (tx) => {
        const [row] = await tx
          .select({ value: appNavConfig.value })
          .from(appNavConfig)
          .where(eq(appNavConfig.orgId, ctx.tenantId))
          .limit(1);
        return normalizeNavConfig(row?.value);
      }),
  );
}

/** Replace the whole document (already validated by the caller) and persist it. */
export async function writeNavConfig(ctx: CoreCtx, config: NavConfig): Promise<NavConfig> {
  await withOrgCore(ctx, async (tx) => {
    await tx
      .insert(appNavConfig)
      .values({ orgId: ctx.tenantId, value: config })
      .onConflictDoUpdate({
        target: appNavConfig.orgId,
        set: { value: config, updatedAt: new Date() },
      });
  });
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'settings'));
  return config;
}

/**
 * Delete this org's page/section view rules (`page:<id>`, `section:<id>`) whose
 * key is no longer in the document. Built-in rows (`page:/pattern`) are never
 * touched. `keep` = every live `page:<id>` / `section:<id>` key.
 * TODO(handoff): runs after (not inside) the document write — a failure here leaves
 * harmless orphan rows that the next PUT prunes; wrap both in one txn if rules ever matter on read.
 */
export async function deleteOrphanPageRules(orgId: string, keep: readonly string[]): Promise<void> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from('permission_rules').select('module').eq('org_id', orgId);
  if (error) throw error;
  const live = new Set(keep);
  const orphans = [...new Set((data ?? []).map((r: { module: string }) => r.module))].filter(
    (m) => /^(page:[a-z0-9]{6}|section:[a-z0-9]{6})$/.test(m) && !live.has(m),
  );
  if (orphans.length === 0) return;
  const { error: delError } = await admin
    .from('permission_rules')
    .delete()
    .eq('org_id', orgId)
    .in('module', orphans);
  if (delError) throw delError;
}
