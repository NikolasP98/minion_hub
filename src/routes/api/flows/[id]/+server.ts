import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows } from '$server/db/pg-schema/flows';
import { and, eq } from 'drizzle-orm';
import { requireAuth } from '$server/auth/authorize';
import { getFlowsCtx, type FlowsCtx } from '$server/auth/flows-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { flowPluginId } from '$lib/flows/plugin-source';

/**
 * Resolve a flow and verify it belongs to the caller's org. Org-shared: any
 * member of the org may read/edit/delete the org's flows. Strictly scoped by
 * tenant — no legacy null-tenant allowance. Throws 404 if not found in-org.
 */
async function requireFlowInOrg(tenantId: string, flowId: string, ctx: FlowsCtx) {
  const [flow] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(flows)
      .where(and(eq(flows.id, flowId), eq(flows.tenantId, tenantId))),
  );

  if (!flow) throw error(404, 'Flow not found');

  return flow;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
  if (!ctx) throw error(401);

  const flow = await requireFlowInOrg(ctx.tenantId, params.id!, ctx);

  return json({
    flow: {
      ...flow,
      active: flow.active,
      nodes: JSON.parse(flow.nodes),
      edges: JSON.parse(flow.edges),
      pluginId: flowPluginId(flow.config),
      groupId: flow.groupId ?? null,
    },
  });
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
  if (!ctx) throw error(401);

  const existing = await requireFlowInOrg(ctx.tenantId, params.id!, ctx);

  const body = await request.json();
  const { name, nodes, edges, active } = body as { name?: string; nodes?: unknown[]; edges?: unknown[]; active?: boolean };

  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (name !== undefined) updates.name = name;
  if (nodes !== undefined) updates.nodes = JSON.stringify(nodes);
  if (edges !== undefined) updates.edges = JSON.stringify(edges);
  if (active !== undefined) updates.active = active;

  await withOrgCore(ctx, (tx) => tx.update(flows).set(updates).where(eq(flows.id, existing.id)));

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
  if (!ctx) throw error(401);

  const existing = await requireFlowInOrg(ctx.tenantId, params.id!, ctx);

  // Instances (incl. plugin-template duplicates) are deletable by any org member.
  // The plugin's group container is what's protected — see /api/flow-groups/[id].
  await withOrgCore(ctx, (tx) => tx.delete(flows).where(eq(flows.id, existing.id)));

  return json({ ok: true });
};
