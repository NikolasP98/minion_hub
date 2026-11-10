import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
import { maskPii } from '$lib/pii';
import { parseBody } from '$server/api/validate';
import type { SchedBooking } from '$server/db/pg-scheduling-schema';
import { requireAssistantCapability } from '../../_shared/action-auth';
import {
  AssistantRescheduleError,
  BookingConflictError,
  previewAssistantReschedule,
  rescheduleAssistantBooking,
  SlotUnavailableError,
} from '$server/services/scheduling-bookings.service';

const bodySchema = z.object({
  confirm: z.boolean(),
  bookingId: z.string().min(1).max(200),
  eventTypeId: z.string().min(1).max(200).optional(),
  start: z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
  expectedUpdatedAt: z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .optional(),
  attendeeName: z.string().max(500).nullable().optional(),
  attendeeEmail: z.string().max(500).nullable().optional(),
  attendeePhone: z.string().max(500).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  crmContactId: z.string().max(200).nullable().optional(),
  resourceId: z.string().max(200).nullable().optional(),
});

/** A receipt exposes scheduling facts, not raw funding or arbitrary metadata. */
function bookingReceipt(booking: SchedBooking, maskSensitive: boolean) {
  return {
    id: booking.id,
    eventTypeId: booking.eventTypeId,
    resourceId: booking.resourceId,
    startTime: booking.startTime,
    endTime: booking.endTime,
    status: booking.status,
    title: booking.title,
    crmContactId: booking.crmContactId,
    attendeeName: booking.attendeeName,
    attendeeEmail:
      maskSensitive && booking.attendeeEmail
        ? maskPii(booking.attendeeEmail)
        : booking.attendeeEmail,
    attendeePhone:
      maskSensitive && booking.attendeePhone
        ? maskPii(booking.attendeePhone)
        : booking.attendeePhone,
    updatedAt: booking.updatedAt,
  };
}

/**
 * POST /api/gateway/actions/booking-reschedule?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, bookingId, start, expectedUpdatedAt?, resourceId?,
 *         eventTypeId?, crmContactId?, attendeeName?, attendeeEmail?, attendeePhone?, notes? }
 * start and expectedUpdatedAt are ISO datetimes with explicit offsets.
 * Legacy event/contact/attendee/notes fields may only match the stored facts;
 * grouped bookings require the separate group flow.
 *
 * Move an existing booking in place. Preview validates the original, contact,
 * resource and strict assistant availability, excluding the original slot.
 * It reserves nothing. Confirm requires preview.expectedUpdatedAt (400 if absent)
 * and revalidates under a row lock; a stale different-target move returns 409.
 * Duration and payment/package/series links remain attached to the same ID.
 * An exact same-target/resource retry returns outcome: 'already-at-target'
 * without rechecking changed availability rules or advancing updatedAt;
 * a committed move returns outcome: 'moved' with a monotonically newer updatedAt.
 * Receipts whitelist scheduling fields and mask attendee PII by principal level.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const { ctx, capabilities } = await requireAssistantCapability(locals, url, 'scheduling', 'edit');
  const b = await parseBody(request, bodySchema);
  if (b.confirm && !b.expectedUpdatedAt)
    throw error(400, 'expectedUpdatedAt is required from a booking preview');
  const maskSensitive = capabilities.fieldLevel('scheduling') < SENSITIVE_FIELD_LEVEL;
  const input = {
    start: b.start,
    resourceId: b.resourceId,
    eventTypeId: b.eventTypeId,
    crmContactId: b.crmContactId,
    attendeeName: b.attendeeName,
    attendeeEmail: b.attendeeEmail,
    attendeePhone: b.attendeePhone,
    notes: b.notes,
  };
  try {
    if (!b.confirm) {
      const preview = await previewAssistantReschedule(ctx, b.bookingId, input);
      if (maskSensitive) {
        preview.attendeeEmail = preview.attendeeEmail ? maskPii(preview.attendeeEmail) : null;
        preview.attendeePhone = preview.attendeePhone ? maskPii(preview.attendeePhone) : null;
      }
      return json({ preview: { action: 'booking-reschedule', ...preview } });
    }
    const result = await rescheduleAssistantBooking(ctx, b.bookingId, {
      ...input,
      expectedUpdatedAt: b.expectedUpdatedAt!,
    });
    return json({
      outcome: result.outcome,
      booking: bookingReceipt(result.booking, maskSensitive),
    });
  } catch (cause) {
    if (cause instanceof AssistantRescheduleError) throw error(cause.status, cause.message);
    if (cause instanceof SlotUnavailableError || cause instanceof BookingConflictError)
      throw error(409, 'new slot unavailable');
    throw cause;
  }
};
