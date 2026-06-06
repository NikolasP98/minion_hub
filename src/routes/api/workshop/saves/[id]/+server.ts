import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { workshopSaves } from '@minion-stack/db/pg';
import { eq } from 'drizzle-orm';
import { requireAuth } from '$server/auth/authorize';
import { getCoreCtx, type CoreCtx } from '$server/auth/core-ctx';

/** Resolve a save and verify ownership. Throws 401/403/404 as appropriate. */
async function requireSaveOwnership(
  profileId: string | null,
  tenantId: string,
  saveId: string,
  ctx: CoreCtx,
) {
  const [save] = await ctx.db.select().from(workshopSaves).where(eq(workshopSaves.id, saveId));

  if (!save) throw error(404, 'Save not found');

  // Allow if owned by this user (by profile uuid); legacy ownerless rows
  // (profileId null) visible only within the same tenant.
  const ownedByUser = profileId !== null && save.profileId === profileId;
  const legacyRow = save.profileId === null;
  const sameTenant = save.tenantId === tenantId || save.tenantId === null;

  if ((!ownedByUser && !legacyRow) || !sameTenant) throw error(403, 'Forbidden');

  return save;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const save = await requireSaveOwnership(user.supabaseId ?? null, ctx.tenantId, params.id!, ctx);

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
  const user = requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const existing = await requireSaveOwnership(user.supabaseId ?? null, ctx.tenantId, params.id!, ctx);

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

  await ctx.db.update(workshopSaves).set(updates).where(eq(workshopSaves.id, existing.id));

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const existing = await requireSaveOwnership(user.supabaseId ?? null, ctx.tenantId, params.id!, ctx);

  await ctx.db.delete(workshopSaves).where(eq(workshopSaves.id, existing.id));

  return json({ ok: true });
};
