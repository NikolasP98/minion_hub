import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { workshopSaves } from '@minion-stack/db/pg';
import { and, eq } from 'drizzle-orm';
import { requireAuth } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';

/**
 * Resolve a save within the current org. Workshop saves are org-shared — any
 * member of the org may load/update/delete them — so the only gate is the org
 * `tenant_id` (enforced by RLS inside `withOrgCore`, and asserted here as
 * defence-in-depth). `profileId` is created-by audit only, not an access gate.
 * Runs on the caller-supplied transaction so it can share one txn with a
 * subsequent mutation. Throws 404 if the save isn't in this org.
 */
async function requireSaveInOrg(tx: CoreTx, tenantId: string, saveId: string) {
  const [save] = await tx
    .select()
    .from(workshopSaves)
    .where(and(eq(workshopSaves.id, saveId), eq(workshopSaves.tenantId, tenantId)));

  if (!save) throw error(404, 'Save not found');

  return save;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const save = await withOrgCore(ctx, (tx) => requireSaveInOrg(tx, ctx.tenantId, params.id!));

  return json({
    save: {
      ...save,
      createdAt: save.createdAt.getTime(),
      updatedAt: save.updatedAt.getTime(),
      state: JSON.parse(save.state),
    },
  });
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const body = await request.json();
  const { name, state, thumbnail } = body as { name?: string; state?: string; thumbnail?: string };

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (name !== undefined) {
    if (typeof name !== 'string' || !name) throw error(400, 'name must be a non-empty string');
    updates.name = name;
  }

  if (state !== undefined) {
    if (typeof state !== 'string') throw error(400, 'state must be a JSON string');
    try {
      JSON.parse(state);
    } catch {
      throw error(400, 'state must be valid JSON');
    }
    updates.state = state;
  }

  if (thumbnail !== undefined) {
    updates.thumbnail = typeof thumbnail === 'string' ? thumbnail : null;
  }

  await withOrgCore(ctx, async (tx) => {
    const existing = await requireSaveInOrg(tx, ctx.tenantId, params.id!);
    await tx.update(workshopSaves).set(updates).where(eq(workshopSaves.id, existing.id));
  });

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  await withOrgCore(ctx, async (tx) => {
    const existing = await requireSaveInOrg(tx, ctx.tenantId, params.id!);
    await tx.delete(workshopSaves).where(eq(workshopSaves.id, existing.id));
  });

  return json({ ok: true });
};
