import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flowGroups } from '$server/db/pg-schema/flows';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getFlowsCtx } from '$server/auth/flows-ctx';
import { withOrgCore } from '$server/db/with-org-core';

export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
  if (!ctx) throw error(401);

  // Org-shared: all members see the org's groups, scoped strictly by tenant.
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(flowGroups)
      .where(eq(flowGroups.tenantId, ctx.tenantId))
      .orderBy(desc(flowGroups.createdAt)),
  );

  return json({
    groups: rows.map((g) => ({
      id: g.id,
      name: g.name,
      pluginId: g.pluginId,
      disabled: g.disabled,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })),
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
  if (!ctx) throw error(401);

  const { name } = (await request.json()) as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw error(400, 'name is required');
  }

  const id = randomUUID();
  const now = Date.now();
  await withOrgCore(ctx, (tx) =>
    tx.insert(flowGroups).values({
      id,
      name: name.trim(),
      userId: user.id, // created-by
      tenantId: ctx.tenantId,
      pluginId: null, // user-created group
      disabled: false,
      createdAt: now,
      updatedAt: now,
    }),
  );

  return json({ id }, { status: 201 });
};
