import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows } from '$server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import type { TenantContext } from '$server/services/base';

/** Resolve a flow and verify ownership. Throws 401/403/404 as appropriate. */
async function requireFlowOwnership(
  userId: string,
  tenantId: string,
  flowId: string,
  ctx: TenantContext,
) {
  const [flow] = await ctx.db.select().from(flows).where(eq(flows.id, flowId));

  if (!flow) throw error(404, 'Flow not found');

  // Allow if owned by this user; legacy rows (userId null) visible within same tenant
  const ownedByUser = flow.userId === userId;
  const legacyRow = flow.userId === null;
  const sameTenant = flow.tenantId === tenantId || flow.tenantId === null;

  if ((!ownedByUser && !legacyRow) || !sameTenant) throw error(403, 'Forbidden');

  return flow;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const flow = await requireFlowOwnership(user.id, ctx.tenantId, params.id!, ctx);

  return json({
    flow: {
      ...flow,
      nodes: JSON.parse(flow.nodes),
      edges: JSON.parse(flow.edges),
    },
  });
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const existing = await requireFlowOwnership(user.id, ctx.tenantId, params.id!, ctx);

  const body = await request.json();
  const { name, nodes, edges } = body as { name?: string; nodes?: unknown[]; edges?: unknown[] };

  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (name !== undefined) updates.name = name;
  if (nodes !== undefined) updates.nodes = JSON.stringify(nodes);
  if (edges !== undefined) updates.edges = JSON.stringify(edges);

  await ctx.db.update(flows).set(updates).where(eq(flows.id, existing.id));

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const existing = await requireFlowOwnership(user.id, ctx.tenantId, params.id!, ctx);

  await ctx.db.delete(flows).where(eq(flows.id, existing.id));

  return json({ ok: true });
};
