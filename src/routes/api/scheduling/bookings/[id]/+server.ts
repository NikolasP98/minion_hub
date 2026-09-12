import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  patchBooking,
  deleteBooking,
  BookingConflictError,
  BookingReferencedError,
} from '$server/services/scheduling-bookings.service';
import { realizeAccruals } from '$server/services/stock-accruals.service';

/** Trimmed nullable string: '' and missing both collapse to null (spec S5 —
 *  "empty → null for nullable columns"). */
const trimmedNullable = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() || null : v),
    z.string().max(max).nullable().optional(),
  );

// Mirrors SETTABLE in scheduling-bookings.service.ts. `status`/`kindId` are a
// plain edit; `start`+`end` (both or neither — the refine below) drive a
// drag/drop or resize reschedule (spec §3.2b), `resourceId` with them moves the
// booking to another staff column too. The general-edit fields (spec S5) cover
// everything else `updateBooking` accepts. At least one recognized field must
// be present.
const patchSchema = z
  .object({
    status: z
      .enum(['accepted', 'pending', 'cancelled', 'rejected', 'completed', 'no_show'])
      .optional(),
    kindId: z.string().max(200).nullable().optional(),
    start: z.coerce.date().optional(),
    end: z.coerce.date().optional(),
    resourceId: z.string().max(200).optional(),
    title: trimmedNullable(200),
    notes: trimmedNullable(4000),
    crmContactId: z.string().max(200).nullable().optional(),
    partyId: z.string().max(200).nullable().optional(),
    eventTypeId: z.string().max(200).optional(),
    productId: z.string().max(200).nullable().optional(),
    attendeeName: trimmedNullable(200),
    attendeeEmail: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toLowerCase() || null : v),
      z.string().max(320).email().nullable().optional(),
    ),
    attendeePhone: trimmedNullable(32),
    invoiceId: z.string().uuid().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((b) => (b.start === undefined) === (b.end === undefined), {
    message: 'start and end must be provided together',
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, patchSchema);
  let booking: Awaited<ReturnType<typeof patchBooking>>;
  try {
    booking = await patchBooking(ctx, params.id!, b);
  } catch (e) {
    if (e instanceof BookingConflictError) {
      return json({ error: 'conflict', message: e.message }, { status: 409 });
    }
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
  // Plain one-click complete: best-effort realize from the open accruals.
  // Never blocks the status change — a short bin surfaces as stockWarning.
  let stockWarning: { code: string; message: string; draftEntryId?: string } | null = null;
  // TODO(handoff): Persist realization admission with the status change; this
  // postcommit attempt is still vulnerable to process loss, see meta
  // proposals/2026-09-12-hub-booking-stock-postcommit-recovery.md.
  if (b.status === 'completed') {
    try {
      const r = await realizeAccruals(ctx, {
        source: 'booking',
        sourceId: params.id!,
        finProductId: booking?.productId ?? null,
        partyId: booking?.partyId ?? null,
        note: booking ? `Booking: ${booking.title}` : null,
        actor: {
          id: ctx.profileId ?? null,
          name: locals.user?.displayName ?? locals.user?.email ?? null,
        },
      });
      stockWarning = r.stockWarning;
    } catch (e) {
      stockWarning = {
        code: 'realize_failed',
        message: e instanceof Error ? e.message : 'stock realize failed',
      };
    }
  }
  return json({
    ok: true,
    stockWarning,
    booking: booking
      ? {
          id: booking.id,
          start: booking.startTime.toISOString(),
          end: booking.endTime.toISOString(),
          resourceId: booking.resourceId,
          status: booking.status,
        }
      : null,
  });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  try {
    await deleteBooking(ctx, params.id!);
  } catch (e) {
    if (e instanceof BookingReferencedError) {
      return json({ error: 'referenced', references: e.references }, { status: 409 });
    }
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
  return new Response(null, { status: 204 });
};
