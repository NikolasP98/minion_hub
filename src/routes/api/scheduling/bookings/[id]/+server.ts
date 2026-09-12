import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  setBookingStatus,
  setBookingKind,
  rescheduleBooking,
  updateBooking,
  deleteBooking,
  getBooking,
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
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((b) => (b.start === undefined) === (b.end === undefined), {
    message: 'start and end must be provided together',
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });

// Fields that only `updateBooking` (the general edit, spec S5) knows about —
// their presence is what routes a PATCH there instead of the legacy
// single-purpose `setBookingKind` call.
const GENERAL_FIELDS = [
  'title',
  'notes',
  'crmContactId',
  'partyId',
  'eventTypeId',
  'productId',
  'attendeeName',
  'attendeeEmail',
  'attendeePhone',
  'metadata',
] as const;

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, patchSchema);
  // resourceId alone (no time change) is a staff reassignment — routed through
  // updateBooking, which delegates its conflict check to rescheduleBooking.
  // resourceId alongside start/end stays on the existing drag/resize path.
  const hasReschedule = b.start !== undefined && b.end !== undefined;
  const hasGeneral =
    GENERAL_FIELDS.some((f) => b[f] !== undefined) ||
    (!hasReschedule && b.resourceId !== undefined);
  try {
    if (hasReschedule) {
      await rescheduleBooking(ctx, params.id!, {
        start: b.start!,
        end: b.end!,
        resourceId: b.resourceId,
      });
    }
    if (b.status !== undefined) await setBookingStatus(ctx, params.id!, b.status);
    if (hasGeneral) {
      await updateBooking(ctx, params.id!, {
        title: b.title,
        notes: b.notes,
        crmContactId: b.crmContactId,
        partyId: b.partyId,
        eventTypeId: b.eventTypeId,
        productId: b.productId,
        resourceId: hasReschedule ? undefined : b.resourceId,
        kindId: b.kindId,
        attendeeName: b.attendeeName,
        attendeeEmail: b.attendeeEmail,
        attendeePhone: b.attendeePhone,
        metadata: b.metadata,
      });
    } else if (b.kindId !== undefined) {
      await setBookingKind(ctx, params.id!, b.kindId);
    }
  } catch (e) {
    if (e instanceof BookingConflictError) {
      return json({ error: 'conflict', message: e.message }, { status: 409 });
    }
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
  const booking = await getBooking(ctx, params.id!);
  // Plain one-click complete: best-effort realize from the open accruals.
  // Never blocks the status change — a short bin surfaces as stockWarning.
  let stockWarning: { code: string; message: string; draftEntryId?: string } | null = null;
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
