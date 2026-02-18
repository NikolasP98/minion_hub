import { eq } from 'drizzle-orm';
import { tenants } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export async function getTenant(ctx: TenantContext) {
  const rows = await ctx.db
    .select()
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId));

  return rows[0] ?? null;
}

export async function updateTenant(
  ctx: TenantContext,
  data: { name?: string; plan?: string },
) {
  await ctx.db
    .update(tenants)
    .set({ ...data, updatedAt: nowMs() })
    .where(eq(tenants.id, ctx.tenantId));
}
