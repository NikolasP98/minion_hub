import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows, flowGroups } from '$server/db/pg-schema/flows';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { requireAuth } from '$server/auth/authorize';
import { getFlowsCtx } from '$server/auth/flows-ctx';
import { scopeData } from '$server/services/base';
import { withOrgCore } from '$server/db/with-org-core';
import { flowPluginId } from '$lib/flows/plugin-source';

export const GET: RequestHandler = async ({ locals, url }) => {
  requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
  if (!ctx) throw error(401);

  const activeOnly = url.searchParams.get('active') === 'true';

  // Org-shared list read, cached per (tenant, activeOnly). Short TTL + the
  // shared 'flows' tag — every flows/flow-groups mutation calls invalidateTags
  // on this tag, so stale entries are dropped immediately rather than waiting
  // out the TTL.
  const result = await cached(
    keys.hub('flows', { t: ctx.tenantId, d: scopeData({ resource: 'list', activeOnly: activeOnly ? 1 : 0 }) }),
    { ttl: '2m', tags: tags.tenantDomain(ctx.tenantId, 'flows') },
    async () => {
      // Org-shared: every member of the org sees the org's flows, scoped strictly by
      // tenant (RLS also enforces this). Per-user scoping was removed so plugin-seeded
      // org automations are visible to all members, not just whoever first imported them.
      const orgFilter = eq(flows.tenantId, ctx.tenantId);

      const whereClause = activeOnly ? and(orgFilter, eq(flows.active, true)) : orgFilter;

      const rows = await withOrgCore(ctx, async (tx) =>
        tx.select().from(flows).where(whereClause).orderBy(desc(flows.updatedAt)),
      );

      return rows.map((row) => {
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
    },
  );

  return json({ flows: result });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
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

  await withOrgCore(ctx, async (tx) => {
    // SECURITY (IDOR): when a target group is specified, it must belong to the
    // caller's org. Flows are org-shared, so any member may file into the org's
    // groups — but never into another org's group.
    if (groupId) {
      const [group] = await tx.select().from(flowGroups).where(eq(flowGroups.id, groupId));
      if (!group) throw error(404, 'Group not found');
      if (group.tenantId !== ctx.tenantId) throw error(403, 'Forbidden');
    }

    await tx.insert(flows).values({
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
  });

  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'flows'));

  return json({ id }, { status: 201 });
};
