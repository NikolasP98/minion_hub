import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { getEntry, updateEntry, deleteEntry } from '$server/services/stock.service';
import { ENTRY_TYPES } from '$server/services/stock.logic';
import { handleStockError } from '../../_errors';

const lineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().positive(),
  uom: z.string().max(50).nullable().optional(),
  rate: z.number().nonnegative().nullable().optional(),
  fromWarehouseId: z.string().min(1).nullable().optional(),
  toWarehouseId: z.string().min(1).nullable().optional(),
});

const patchSchema = z.object({
  type: z.enum(ENTRY_TYPES).optional(),
  partyId: z.string().max(200).nullable().optional(),
  note: z.string().max(20_000).nullable().optional(),
  lines: z.array(lineSchema).optional(),
});

/** GET /api/stock/entries/:id — { entry, lines } */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const result = await getEntry(ctx, params.id!);
  if (!result) throw error(404);
  return json(result);
};

/** PATCH /api/stock/entries/:id — draft-only (header + lines, full replace of lines when given). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  try {
    const entry = await updateEntry(ctx, params.id!, body);
    if (!entry) throw error(404);
    return json(entry);
  } catch (e) {
    handleStockError(e);
  }
};

/** DELETE /api/stock/entries/:id — draft-only. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  try {
    const ok = await deleteEntry(ctx, params.id!);
    if (!ok) throw error(404);
    return json({ ok: true });
  } catch (e) {
    handleStockError(e);
  }
};
