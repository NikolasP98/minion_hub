import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flowGroups, flows } from '$server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import type { TenantContext } from '$server/services/base';

async function requireGroupOwnership(userId: string, tenantId: string, groupId: string, ctx: TenantContext) {
  const [group] = await ctx.db.select().from(flowGroups).where(eq(flowGroups.id, groupId));
  if (!group) throw error(404, 'Group not found');
  const ownedByUser = group.userId === userId;
  const legacyRow = group.userId === null;
  const sameTenant = group.tenantId === tenantId || group.tenantId === null;
  if ((!ownedByUser && !legacyRow) || !sameTenant) throw error(403, 'Forbidden');
  return group;
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);
  const group = await requireGroupOwnership(user.id, ctx.tenantId, params.id!, ctx);

  if (group.pluginId) throw error(403, 'Plugin-managed groups cannot be renamed.');

  const { name } = (await request.json()) as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length === 0) throw error(400, 'name is required');

  await ctx.db.update(flowGroups).set({ name: name.trim(), updatedAt: Date.now() }).where(eq(flowGroups.id, group.id));
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);
  const group = await requireGroupOwnership(user.id, ctx.tenantId, params.id!, ctx);

  // Plugin groups are managed by their plugin — reconcile would recreate them.
  if (group.pluginId) {
    throw error(403, `This group is managed by the "${group.pluginId}" plugin and cannot be deleted.`);
  }

  // Non-destructive: move the group's flows to "My Flows" (ungrouped), then drop the group.
  await ctx.db.update(flows).set({ groupId: null, updatedAt: Date.now() }).where(eq(flows.groupId, group.id));
  await ctx.db.delete(flowGroups).where(eq(flowGroups.id, group.id));
  return json({ ok: true });
};
