import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listTickets, submitTicket } from '$server/services/pos.service';
import { handlePosError } from '../_errors';

const lineSchema = z.object({
  kind: z.enum(['service', 'product']),
  finProductId: z.string().min(1).nullable().optional(),
  bookingId: z.string().min(1).nullable().optional(),
  description: z.string().min(1).max(500),
  qty: z.number().finite(),
  unitPrice: z.number().finite(),
  discount: z.number().finite().optional(),
});

const paymentSchema = z.object({
  method: z.string().min(1).max(40),
  amount: z.number().finite(),
  tendered: z.number().finite().nullable().optional(),
});

const postSchema = z.object({
  lines: z.array(lineSchema).min(1),
  payments: z.array(paymentSchema),
  partyId: z.string().max(200).nullable().optional(),
  crmContactId: z.string().max(200).nullable().optional(),
  customerName: z.string().max(500).nullable().optional(),
  discount: z.number().finite().optional(),
  note: z.string().max(20_000).nullable().optional(),
});

/** GET /api/pos/tickets?shiftId=&from=&to=&limit= */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  return json(
    await listTickets(ctx, {
      shiftId: url.searchParams.get('shiftId') ?? undefined,
      from: fromParam ? new Date(fromParam) : undefined,
      to: toParam ? new Date(toParam) : undefined,
      limit: limit && Number.isFinite(limit) ? limit : undefined,
    }),
  );
};

/** POST /api/pos/tickets */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const body = await parseBody(request, postSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  try {
    const { ticket, stockWarning } = await submitTicket(ctx, {
      lines: body.lines,
      payments: body.payments,
      partyId: body.partyId ?? null,
      crmContactId: body.crmContactId ?? null,
      customerName: body.customerName ?? null,
      discount: body.discount,
      note: body.note ?? null,
      actor,
    });
    return json({ ok: true, ticket, stockWarning }, { status: 201 });
  } catch (e) {
    return handlePosError(e);
  }
};
