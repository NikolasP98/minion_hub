import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { createPlan, listPlans, PLAN_STATUSES } from '$server/services/pos-accounts.service';
import { handlePosError } from '../_errors';

const postSchema = z
  .object({
    partyId: z.string().uuid().nullable().optional(),
    crmContactId: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(500),
    totalAmount: z.number().finite().positive(),
    currency: z.string().min(1).max(8).optional(),
    productId: z.string().uuid().nullable().optional(),
    bookingId: z.string().uuid().nullable().optional(),
    dueSchedule: z
      .array(
        z.object({ dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.number().positive() }),
      )
      .nullable()
      .optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => Boolean(b.partyId || b.crmContactId), {
    message: 'partyId or crmContactId is required',
  });

/** GET /api/pos/plans?partyId=&crmContactId=&status=&bookingId=&limit= */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  // Reads here expose client stored-value balances and paid-session history —
  // money + PII, not catalog. Writes are gated centrally by apiWriteCapability;
  // this is the matching READ gate (RBAC checklist step 1).
  await requireOrgCapability(locals, 'pos', 'view');
  const partyId = url.searchParams.get('partyId');
  const crmContactId = url.searchParams.get('crmContactId');
  const status = url.searchParams.get('status');
  const limitParam = Number(url.searchParams.get('limit'));
  try {
    return json({
      plans: await listPlans(ctx, {
        client: partyId || crmContactId ? { partyId, crmContactId } : undefined,
        status: PLAN_STATUSES.find((s) => s === status),
        bookingId: url.searchParams.get('bookingId') ?? undefined,
        limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      }),
    });
  } catch (e) {
    return handlePosError(e);
  }
};

/**
 * POST /api/pos/plans — open an instalment plan. Ordinary `pos:create` work
 * (the central apiWriteCapability gate): opening a plan moves no money, each
 * instalment is a fully-paid ticket of its own.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const body = await parseBody(request, postSchema);
  try {
    const plan = await createPlan(ctx, {
      client: { partyId: body.partyId ?? null, crmContactId: body.crmContactId ?? null },
      title: body.title,
      totalAmount: body.totalAmount,
      currency: body.currency,
      productId: body.productId ?? null,
      bookingId: body.bookingId ?? null,
      dueSchedule: body.dueSchedule ?? null,
      note: body.note ?? null,
      actor: {
        id: ctx.profileId ?? null,
        name: locals.user?.displayName ?? locals.user?.email ?? null,
      },
    });
    return json({ ok: true, plan }, { status: 201 });
  } catch (e) {
    return handlePosError(e);
  }
};
