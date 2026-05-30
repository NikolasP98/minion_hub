import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows } from '$server/db/schema';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { flowPluginId } from '$lib/flows/plugin-source';

export const GET: RequestHandler = async ({ locals, url }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const activeOnly = url.searchParams.get('active') === 'true';

  // Return flows owned by this user OR legacy flows with no owner (within same tenant)
  const ownershipFilter = and(
    or(eq(flows.userId, user.id), isNull(flows.userId)),
    or(eq(flows.tenantId, ctx.tenantId), isNull(flows.tenantId)),
  );

  const whereClause = activeOnly
    ? and(ownershipFilter, eq(flows.active, true))
    : ownershipFilter;

  const rows = await ctx.db
    .select()
    .from(flows)
    .where(whereClause)
    .orderBy(desc(flows.updatedAt));

  const result = rows.map((row) => {
    let nodeCount = 0;
    try {
      nodeCount = JSON.parse(row.nodes).length;
    } catch {
      // leave at 0
    }
    return {
      id: row.id,
      name: row.name,
      active: row.active,
      nodeCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // Owning plugin id when this flow was imported from a plugin, else null.
      pluginId: flowPluginId(row.config),
      groupId: row.groupId ?? null,
    };
  });

  return json({ flows: result });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const body = await request.json();
  const { name, nodes, edges, groupId, pluginId, templateId } = body as {
    name?: string; nodes?: unknown; edges?: unknown;
    groupId?: string; pluginId?: string; templateId?: string;
  };

  if (!name || typeof name !== 'string') throw error(400, 'name is required');

  // Optional nodes/edges let a plugin-shipped flow template be imported as a new
  // flow in one call. Stored as JSON; the editor/runner validate concrete shapes.
  const nodesJson = Array.isArray(nodes) ? JSON.stringify(nodes) : '[]';
  const edgesJson = Array.isArray(edges) ? JSON.stringify(edges) : '[]';

  // When duplicating a plugin template into its group, record the source so the
  // card can show the origin pill. config.source no longer locks the flow.
  const config = pluginId
    ? JSON.stringify({ source: { pluginId, templateId } })
    : '{}';

  const id = randomUUID();
  const now = Date.now();

  await ctx.db.insert(flows).values({
    id,
    name,
    nodes: nodesJson,
    edges: edgesJson,
    userId: user.id,
    tenantId: ctx.tenantId,
    createdAt: now,
    updatedAt: now,
    groupId: groupId ?? null,
    config,
  });

  return json({ id }, { status: 201 });
};
