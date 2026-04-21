import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows } from from '@minion-stack/db/schema';
import { flows } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  // Return flows owned by this user OR legacy flows with no owner (within same tenant)
  const rows = await ctx.db
    .select()
    .from(flows)
    .where(
      and(
        or(eq(flows.userId, user.id), isNull(flows.userId)),
        or(eq(flows.tenantId, ctx.tenantId), isNull(flows.tenantId)),
      ),
    )
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
      nodeCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  return json({ flows: result });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const body = await request.json();
  const { name } = body as { name?: string };

  if (!name || typeof name !== 'string') throw error(400, 'name is required');

  const id = randomUUID();
  const now = Date.now();

  await ctx.db.insert(flows).values({
    id,
    name,
    nodes: '[]',
    edges: '[]',
    userId: user.id,
    tenantId: ctx.tenantId,
    createdAt: now,
    updatedAt: now,
  });

  return json({ id }, { status: 201 });
};
