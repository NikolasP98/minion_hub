import { eq } from 'drizzle-orm';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { withOrgCore, withOrgCoreTransaction } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { appNavConfig } from '$server/db/pg-schema/nav-config';
import { normalizeNavConfig, navPageKeys, type NavConfig } from '$lib/nav/custom-sections';
import { lockNavigationPolicy } from './nav-policy-lock';

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

/** Replace and prune atomically under the same lock as contextual/legacy policy writes. */
export async function writeNavConfig(ctx: CoreCtx, config: NavConfig): Promise<NavConfig> {
  await ctx.db.transaction(async (tx) => {
    await lockNavigationPolicy(tx, ctx.tenantId);
    // Preserve non-bypass RLS on the navigation document while the privileged
    // outer transaction serializes catalog/policy administration. Both phases
    // commit together; nested scope restoration is owned by the shared helper.
    await withOrgCoreTransaction(ctx, tx, async (scoped) => {
      await scoped
        .insert(appNavConfig)
        .values({ orgId: ctx.tenantId, value: config })
        .onConflictDoUpdate({
          target: appNavConfig.orgId,
          set: { value: config, updatedAt: new Date() },
        });
    });
    const { pruneRemovedNavigationPolicies } = await import('./section-access.service');
    await pruneRemovedNavigationPolicies(tx, ctx, [
      ...navPageKeys(config).map((page) => page.key),
      ...config.sections.map((section) => `section:${section.id}`),
    ]);
  });
  // The document and policy cleanup have committed. Failure to invalidate is a
  // read-repair problem; never encourage resubmitting a durable whole-nav save.
  try {
    await invalidateTags(tags.tenantDomain(ctx.tenantId, 'settings'));
  } catch {
    console.warn('[nav-config] committed; navigation refresh required');
  }
  return config;
}
