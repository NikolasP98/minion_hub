import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flowGroups, flows } from '$server/db/pg-schema/flows';
import { and, eq } from 'drizzle-orm';
import { invalidateTags, tags } from '@minion-stack/cache';
import { requireAuth } from '$server/auth/authorize';
import { getFlowsCtx, type FlowsCtx } from '$server/auth/flows-ctx';
import { withOrgCore } from '$server/db/with-org-core';

/** Resolve a group and verify it belongs to the caller's org (org-scoped). */
async function requireGroupInOrg(tenantId: string, groupId: string, ctx: FlowsCtx) {
  const [group] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(flowGroups)
      .where(and(eq(flowGroups.id, groupId), eq(flowGroups.tenantId, tenantId))),
  );
  if (!group) throw error(404, 'Group not found');
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

  await withOrgCore(ctx, (tx) =>
    tx.update(flowGroups).set({ name: name.trim(), updatedAt: Date.now() }).where(eq(flowGroups.id, group.id)),
  );
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'flows'));
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
  await withOrgCore(ctx, async (tx) => {
    await tx.update(flows).set({ groupId: null, updatedAt: Date.now() }).where(
      and(eq(flows.groupId, group.id), eq(flows.tenantId, ctx.tenantId)),
    );
    await tx.delete(flowGroups).where(eq(flowGroups.id, group.id));
  });
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'flows'));
  return json({ ok: true });
};
