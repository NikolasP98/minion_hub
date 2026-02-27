import { eq } from 'drizzle-orm';
import { organization } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export async function getTenant(ctx: TenantContext) {
  const rows = await ctx.db
    .select()
    .from(organization)
    .where(eq(organization.id, ctx.tenantId));

  return rows[0] ?? null;
}

export async function updateTenant(
  ctx: TenantContext,
  data: { name?: string; slug?: string; logo?: string; metadata?: string },
) {
  await ctx.db
    .update(organization)
    .set(data)
    .where(eq(organization.id, ctx.tenantId));
}
