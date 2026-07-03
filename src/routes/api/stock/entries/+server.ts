import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listEntries, createEntry } from '$server/services/stock.service';
import { ENTRY_TYPES } from '$server/services/stock.logic';
import { handleStockError } from '../_errors';

function actorOf(ctx: { profileId?: string }, locals: App.Locals) {
  return { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
}

const lineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().positive(),
  uom: z.string().max(50).nullable().optional(),
  rate: z.number().nonnegative().nullable().optional(),
  fromWarehouseId: z.string().min(1).nullable().optional(),
  toWarehouseId: z.string().min(1).nullable().optional(),
});

const postSchema = z.object({
  type: z.enum(ENTRY_TYPES),
  partyId: z.string().max(200).nullable().optional(),
  note: z.string().max(20_000).nullable().optional(),
  lines: z.array(lineSchema).default([]),
});

/** GET /api/stock/entries?status=&type= */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  return json(
    await listEntries(ctx, {
      status: url.searchParams.get('status') ?? undefined,
      type: url.searchParams.get('type') ?? undefined,
      partyId: url.searchParams.get('party') ?? undefined,
    }),
  );
};

/** POST /api/stock/entries — creates a DRAFT (submit is a separate step). */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const body = await parseBody(request, postSchema);
  try {
    const entry = await createEntry(ctx, { ...body, partyId: body.partyId ?? null, note: body.note ?? null }, actorOf(ctx, locals));
    return json(entry, { status: 201 });
  } catch (e) {
    handleStockError(e);
  }
};
