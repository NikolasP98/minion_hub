import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listComponents, setComponent, removeComponent } from '$server/services/stock.service';
import { handleStockError } from '../../../_errors';

/**
 * Item composition edges (Slice 1b). Writes are gated centrally by
 * apiWriteCapability — '/api/stock' → the `stock` module — so no bare
 * requireAuth here.
 */
const postSchema = z.object({
  childItemId: z.string().uuid(),
  qty: z.number().positive(),
  optional: z.boolean().optional(),
  defaultIncluded: z.boolean().optional(),
  choiceGroup: z.string().max(200).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

const deleteSchema = z.object({ componentId: z.string().uuid() });

function actorOf(locals: App.Locals, profileId: string | null) {
  return { id: profileId, name: locals.user?.displayName ?? locals.user?.email ?? null };
}

/** GET /api/stock/items/:id/components — one item's direct children. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ components: await listComponents(ctx, params.id as string) });
};

/** POST /api/stock/items/:id/components — upsert one edge (cycle-checked). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  try {
    const row = await setComponent(ctx, { parentItemId: params.id as string, ...body }, actorOf(locals, ctx.profileId ?? null));
    return json({ ok: true, component: row }, { status: 201 });
  } catch (e) {
    handleStockError(e);
  }
};

/** DELETE /api/stock/items/:id/components — remove one edge by id. */
export const DELETE: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { componentId } = await parseBody(request, deleteSchema);
  try {
    const ok = await removeComponent(ctx, componentId, actorOf(locals, ctx.profileId ?? null));
    if (!ok) throw error(404);
    return json({ ok: true });
  } catch (e) {
    handleStockError(e);
  }
};
