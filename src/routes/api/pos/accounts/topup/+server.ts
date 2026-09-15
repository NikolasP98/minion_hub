import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { addLedgerEntry } from '$server/services/pos-accounts.service';
import { handlePosError } from '../../_errors';

const postSchema = z
  .object({
    partyId: z.string().uuid().nullable().optional(),
    crmContactId: z.string().uuid().nullable().optional(),
    /** Signed: a refund-to-credit is positive, a manual correction may be negative. */
    amount: z.number().finite(),
    kind: z.enum(['topup', 'deposit', 'refund', 'adjustment']).default('topup'),
    currency: z.string().min(1).max(8).optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => Boolean(b.partyId || b.crmContactId), {
    message: 'partyId or crmContactId is required',
  });

/**
 * POST /api/pos/accounts/topup — append one stored-value row.
 *
 * Manager-grade: this mints money the client can spend at the till, so it gets
 * the explicit `pos:manage` check on top of the central write gate, exactly
 * like /api/pos/shifts/close.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'manage');
  const body = await parseBody(request, postSchema);
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  try {
    const entry = await addLedgerEntry(ctx, {
      client: { partyId: body.partyId ?? null, crmContactId: body.crmContactId ?? null },
      kind: body.kind,
      amount: body.amount,
      currency: body.currency,
      note: body.note ?? null,
      actor,
    });
    return json({ ok: true, entry }, { status: 201 });
  } catch (e) {
    return handlePosError(e);
  }
};
