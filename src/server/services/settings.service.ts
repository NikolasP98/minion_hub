import { eq, and } from 'drizzle-orm';
import { settings } from '$server/db/schema';
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
}

export async function getSettings(
  ctx: TenantContext,
  serverId: string,
): Promise<Record<string, unknown>> {
  const rows = await ctx.db
    .select({ section: settings.section, value: settings.value })
    .from(settings)
    .where(and(eq(settings.serverId, serverId), eq(settings.tenantId, ctx.tenantId)));

  return Object.fromEntries(rows.map((r) => [r.section, JSON.parse(r.value)]));
}

export async function getSettingsSection(
  ctx: TenantContext,
  serverId: string,
  section: string,
): Promise<unknown> {
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
}
