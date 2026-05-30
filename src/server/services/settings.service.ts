import { eq, and } from 'drizzle-orm';
import { settings } from '@minion-stack/db/schema';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export async function upsertSettings(
  ctx: TenantContext,
  serverId: string,
  section: string,
  value: unknown,
) {
  const now = nowMs();
  await ctx.db
    .insert(settings)
    .values({
      tenantId: ctx.tenantId,
      serverId,
      section,
      value: JSON.stringify(value),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [settings.serverId, settings.section],
      set: {
        value: JSON.stringify(value),
        updatedAt: now,
      },
    });

  // Admin edited config — drop the whole-tenant settings cache (both the
  // aggregate map and per-section reads share this domain tag).
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'settings'));
}

export async function getSettings(
  ctx: TenantContext,
  serverId: string,
): Promise<Record<string, unknown>> {
  return cached(
    keys.hub('settings', { t: ctx.tenantId, d: { serverId } }),
    {
      ttl: '30m',
      swr: '5m',
      tags: tags.tenantDomain(ctx.tenantId, 'settings'),
    },
    async () => {
      const rows = await ctx.db
        .select({ section: settings.section, value: settings.value })
        .from(settings)
        .where(and(eq(settings.serverId, serverId), eq(settings.tenantId, ctx.tenantId)));

      return Object.fromEntries(rows.map((r) => [r.section, JSON.parse(r.value)]));
    },
  );
}

export async function getSettingsSection(
  ctx: TenantContext,
  serverId: string,
  section: string,
): Promise<unknown> {
  return cached(
    keys.hub('settings', { t: ctx.tenantId, d: { serverId, section } }),
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
            eq(settings.serverId, serverId),
            eq(settings.section, section),
            eq(settings.tenantId, ctx.tenantId),
          ),
        );

      return rows[0] ? JSON.parse(rows[0].value) : null;
    },
  );
}
