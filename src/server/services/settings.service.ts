import { eq, and } from 'drizzle-orm';
import { settings } from '@minion-stack/db/pg';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import type { ServerCtx } from '$server/auth/core-ctx';

/**
 * Per-gateway config settings, in Supabase Postgres. Keyed by `gateway_id`
 * (resolved from the route serverId by getServerCtx) + `tenant_id`.
 */
export async function upsertSettings(ctx: ServerCtx, section: string, value: unknown) {
  await ctx.db
    .insert(settings)
    .values({
      tenantId: ctx.tenantId,
      gatewayId: ctx.gatewayId,
      section,
      value: JSON.stringify(value),
    })
    .onConflictDoUpdate({
      target: [settings.gatewayId, settings.section],
      set: {
        value: JSON.stringify(value),
        updatedAt: new Date(),
      },
    });

  // Admin edited config — drop the whole-tenant settings cache (both the
  // aggregate map and per-section reads share this domain tag).
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'settings'));
}

export async function getSettings(ctx: ServerCtx): Promise<Record<string, unknown>> {
  return cached(
    keys.hub('settings', { t: ctx.tenantId, d: { gatewayId: ctx.gatewayId } }),
    {
      ttl: '30m',
      swr: '5m',
      tags: tags.tenantDomain(ctx.tenantId, 'settings'),
    },
    async () => {
      const rows = await ctx.db
        .select({ section: settings.section, value: settings.value })
        .from(settings)
        .where(and(eq(settings.gatewayId, ctx.gatewayId), eq(settings.tenantId, ctx.tenantId)));

      return Object.fromEntries(rows.map((r) => [r.section, JSON.parse(r.value)]));
    },
  );
}

export async function getSettingsSection(ctx: ServerCtx, section: string): Promise<unknown> {
  return cached(
    keys.hub('settings', { t: ctx.tenantId, d: { gatewayId: ctx.gatewayId, section } }),
    {
      ttl: '30m',
      swr: '5m',
      tags: tags.tenantDomain(ctx.tenantId, 'settings'),
    },
    async () => {
      const rows = await ctx.db
        .select({ value: settings.value })
        .from(settings)
        .where(
          and(
            eq(settings.gatewayId, ctx.gatewayId),
            eq(settings.section, section),
            eq(settings.tenantId, ctx.tenantId),
          ),
        );

      return rows[0] ? JSON.parse(rows[0].value) : null;
    },
  );
}
