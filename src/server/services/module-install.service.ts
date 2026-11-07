import { invalidateTags, tags } from '@minion-stack/cache';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { appModules } from '$server/db/pg-modules-schema';
import { readNavConfig, writeNavConfig } from '$server/services/nav-config.service';
import { BASE_MODULES, toggleIds } from '$lib/modules/availability';

/**
 * The org's landing page when nothing more specific applies. Spec 046
 * (meta `specs/046-hub-nav-home-landing-sections/`) owns the landing resolver
 * and the `/chat` route; this is only the value a new org starts with.
 */
export const ORG_LANDING_DEFAULT = { business: '/overview', personal: '/chat' } as const;

/**
 * Spec 047 S4: write one explicit `app_modules` row per toggle module (the base
 * set) and the org landing page. Idempotent: existing rows and an existing
 * landing page are never overwritten, so a re-run keeps the owner's choices.
 */
export async function installBaseModules(
  ctx: CoreCtx,
  kind: 'business' | 'personal',
): Promise<{ rowsWritten: number; landingSet: boolean }> {
  const rows = toggleIds().map((moduleId) => ({
    orgId: ctx.tenantId,
    moduleId,
    enabled: BASE_MODULES[moduleId as keyof typeof BASE_MODULES],
  }));
  const written = await withOrgCore(ctx, (tx) =>
    tx
      .insert(appModules)
      .values(rows)
      .onConflictDoNothing()
      .returning({ moduleId: appModules.moduleId }),
  );
  await invalidateTags([...tags.tenantDomain(ctx.tenantId, 'modules')]);

  const current = await readNavConfig(ctx);
  if (current.landingPage) return { rowsWritten: written.length, landingSet: false };
  await writeNavConfig(ctx, { ...current, landingPage: ORG_LANDING_DEFAULT[kind] });
  return { rowsWritten: written.length, landingSet: true };
}
