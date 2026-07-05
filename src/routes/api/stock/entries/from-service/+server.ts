import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { buildServiceIssuePreview, createServiceIssue } from '$server/services/stock.service';
import { handleStockError } from '../../_errors';

function actorOf(ctx: { profileId?: string }, locals: App.Locals) {
  return { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
}

const lineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().positive(),
  /** Optional qty in the item's CONSUMPTION uom — when present, the server
   *  converts to stock uom authoritatively and ignores `qty`. */
  qtyConsumption: z.number().positive().nullable().optional(),
});

const postSchema = z.object({
  finProductId: z.string().min(1),
  quantity: z.number().positive().default(1),
  warehouseId: z.string().min(1),
  partyId: z.string().max(200).nullable().optional(),
  note: z.string().max(20_000).nullable().optional(),
  preview: z.boolean().optional(),
  lines: z.array(lineSchema).optional(),
  submit: z.boolean().optional(),
});

/**
 * POST /api/stock/entries/from-service
 * body: { finProductId, quantity, warehouseId, partyId?, note?, preview?, lines?, submit? }
 *
 * preview:true — computed consumption lines only (confirm-before-write), no write.
 * otherwise — creates (and optionally submits) an `issue` stk_entry for the
 * service performed for `partyId`, with `note` as the procedure note.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const body = await parseBody(request, postSchema);

  try {
    if (body.preview) {
      const preview = await buildServiceIssuePreview(ctx, {
        finProductId: body.finProductId,
        quantity: body.quantity,
        warehouseId: body.warehouseId,
      });
      return json({ preview });
    }
    if (!body.lines?.length) throw error(400, 'lines is required unless preview is true');
    const entry = await createServiceIssue(ctx, {
      finProductId: body.finProductId,
      quantity: body.quantity,
      warehouseId: body.warehouseId,
      partyId: body.partyId ?? null,
      note: body.note ?? null,
      lines: body.lines,
      submit: body.submit,
      actor: actorOf(ctx, locals),
    });
    return json(entry, { status: 201 });
  } catch (e) {
    handleStockError(e);
  }
};
