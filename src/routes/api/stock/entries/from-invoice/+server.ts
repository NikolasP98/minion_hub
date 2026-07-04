import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { buildInvoiceIssuePreview, createIssueFromInvoice } from '$server/services/stock.service';
import { handleStockError } from '../../_errors';

function actorOf(ctx: { profileId?: string }, locals: App.Locals) {
  return { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
}

const lineSchema = z.object({ itemId: z.string().min(1), qty: z.number().positive() });

const postSchema = z.object({
  invoiceId: z.string().min(1),
  warehouseId: z.string().min(1),
  preview: z.boolean().optional(),
  lines: z.array(lineSchema).optional(),
  submit: z.boolean().optional(),
});

/**
 * POST /api/stock/entries/from-invoice
 * body: { invoiceId, warehouseId, preview?, lines?, submit? }
 *
 * preview:true — computed lines only (confirm-before-write contract), no write.
 * otherwise — creates (and optionally submits) an `issue` stk_entry from `lines`.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const body = await parseBody(request, postSchema);

  try {
    if (body.preview) {
      const preview = await buildInvoiceIssuePreview(ctx, body.invoiceId, body.warehouseId);
      return json({ preview });
    }
    if (!body.lines?.length) throw error(400, 'lines is required unless preview is true');
    const entry = await createIssueFromInvoice(ctx, {
      invoiceId: body.invoiceId,
      warehouseId: body.warehouseId,
      lines: body.lines,
      submit: body.submit,
      actor: actorOf(ctx, locals),
    });
    return json(entry, { status: 201 });
  } catch (e) {
    handleStockError(e);
  }
};
