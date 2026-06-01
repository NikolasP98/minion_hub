import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flowGroups, flows } from '$server/db/pg-schema/flows';
import { and, eq, isNull, or } from 'drizzle-orm';
import { requireAuth } from '$server/auth/authorize';
import { getFlowsCtx, type FlowsCtx } from '$server/auth/flows-ctx';

/** Resolve a group and verify it belongs to the caller's org (org-scoped). */
async function requireGroupInOrg(tenantId: string, groupId: string, ctx: FlowsCtx) {
  const [group] = await ctx.db.select().from(flowGroups).where(eq(flowGroups.id, groupId));
  if (!group) throw error(404, 'Group not found');
  const sameOrg = group.tenantId === tenantId || group.tenantId === null;
  if (!sameOrg) throw error(403, 'Forbidden');
  return group;
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
  if (!ctx) throw error(401);
  const group = await requireGroupInOrg(ctx.tenantId, params.id!, ctx);

  if (group.pluginId) throw error(403, 'Plugin-managed groups cannot be renamed.');

  const { name } = (await request.json()) as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length === 0) throw error(400, 'name is required');

  await ctx.db.update(flowGroups).set({ name: name.trim(), updatedAt: Date.now() }).where(eq(flowGroups.id, group.id));
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
  if (!ctx) throw error(401);
  const group = await requireGroupInOrg(ctx.tenantId, params.id!, ctx);

  // Plugin groups are managed by their plugin — reconcile would recreate them.
  if (group.pluginId) {
    throw error(403, `This group is managed by the "${group.pluginId}" plugin and cannot be deleted.`);
  }

  // Non-destructive: move the group's flows to "My Flows" (ungrouped), then drop the group.
  // Scope the update by org too (defense-in-depth) so it can never touch another
  // org's rows even if a group somehow contained foreign flows.
  await ctx.db.update(flows).set({ groupId: null, updatedAt: Date.now() }).where(
    and(
      eq(flows.groupId, group.id),
      or(eq(flows.tenantId, ctx.tenantId), isNull(flows.tenantId)),
    ),
  );
  await ctx.db.delete(flowGroups).where(eq(flowGroups.id, group.id));
  return json({ ok: true });
};
