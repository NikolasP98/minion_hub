import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { workshopSaves } from '$server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import type { TenantContext } from '$server/services/base';

/** Resolve a save and verify ownership. Throws 401/403/404 as appropriate. */
async function requireSaveOwnership(userId: string, tenantId: string, saveId: string, ctx: TenantContext) {
  const [save] = await ctx.db
    .select()
    .from(workshopSaves)
    .where(eq(workshopSaves.id, saveId));

  if (!save) throw error(404, 'Save not found');

  // Allow if owned by this user; legacy rows (userId null) visible only within same tenant
  const ownedByUser = save.userId === userId;
  const legacyRow = save.userId === null;
  const sameTenant = save.tenantId === tenantId || save.tenantId === null;

  if ((!ownedByUser && !legacyRow) || !sameTenant) throw error(403, 'Forbidden');

  return save;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const save = await requireSaveOwnership(user.id, ctx.tenantId, params.id!, ctx);

  return json({
    save: {
      ...save,
      state: JSON.parse(save.state),
    },
  });
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const existing = await requireSaveOwnership(user.id, ctx.tenantId, params.id!, ctx);

  const body = await request.json();
  const { name, state, thumbnail } = body as { name?: string; state?: string; thumbnail?: string };

  const updates: Record<string, unknown> = { updatedAt: Date.now() };

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

  await ctx.db
    .update(workshopSaves)
    .set(updates)
    .where(eq(workshopSaves.id, existing.id));

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const existing = await requireSaveOwnership(user.id, ctx.tenantId, params.id!, ctx);

  await ctx.db
    .delete(workshopSaves)
    .where(eq(workshopSaves.id, existing.id));

  return json({ ok: true });
};
