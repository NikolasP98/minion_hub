import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { PosError } from '$server/services/pos.service';
import { bookAndLinkTicketLine, SlotUnavailableError } from '$server/services/scheduling-bookings.service';
import { handlePosError } from '../../../_errors';

const postSchema = z.object({
  lineId: z.string().uuid(),
  eventTypeId: z.string().min(1).max(200),
  start: z.coerce.date(),
  attendeeName: z.string().max(500).nullable().optional(),
  attendeeEmail: z.string().max(500).nullable().optional(),
  attendeePhone: z.string().max(500).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  clientNote: z.string().max(20_000).nullable().optional(),
  crmContactId: z.string().max(200).nullable().optional(),
  resourceId: z.string().max(200).nullable().optional(),
  forceResourceId: z.string().max(200).optional(),
  overrideConflicts: z.boolean().optional(),
  consumption: z
    .array(z.object({ itemId: z.string().min(1), qtyConsumption: z.number().positive() }))
    .nullable()
    .optional(),
  packageGrantId: z.string().uuid().nullable().optional(),
  paymentPlanId: z.string().uuid().nullable().optional(),
});

/**
 * POST /api/pos/tickets/:id/schedule — book the appointment for one sold
 * service line AND stamp `pos_ticket_lines.booking_id`, in ONE transaction.
 *
 * This replaced the client-driven pair (`POST /api/scheduling/bookings` then a
 * separate link call): if the second call failed, the appointment existed, the
 * line still read unscheduled, and the retry booked a SECOND one. There is no
 * longer any path where a booking survives a failed link.
 *
 * Gates: `/api/pos` is in `API_WRITE_PREFIXES`, so `apiWriteCapability` in
 * hooks.server.ts already requires the POS write capability. Because this
 * endpoint also CREATES a booking — which under `/api/scheduling` would be
 * gated as `scheduling:edit` — the scheduling capability is required here
 * explicitly rather than inherited by accident.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  await requireOrgCapability(locals, 'scheduling', 'edit');
  const b = await parseBody(request, postSchema);
  try {
    const { booking, created } = await bookAndLinkTicketLine(ctx, {
      ticketId: params.id!,
      lineId: b.lineId,
      eventTypeId: b.eventTypeId,
      start: b.start,
      attendeeName: b.attendeeName ?? null,
      attendeeEmail: b.attendeeEmail ?? null,
      attendeePhone: b.attendeePhone ?? null,
      notes: b.notes ?? null,
      clientNote: b.clientNote ?? null,
      crmContactId: b.crmContactId ?? null,
      preferredResourceId: b.resourceId ?? null,
      // Same posture as the internal `/api/scheduling/bookings` POST this
      // replaces: staff booking on behalf of a customer bypasses min-notice and
      // the rolling period. Slot, conflict and resource-availability validation
      // are untouched.
      source: 'internal',
      bypassRules: true,
      consumption: b.consumption ?? null,
      forceResourceId: b.forceResourceId ?? undefined,
      overrideConflicts: b.overrideConflicts ?? undefined,
      packageGrantId: b.packageGrantId ?? null,
      paymentPlanId: b.paymentPlanId ?? null,
      actor: { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null },
    });
    // `created: false` = idempotent replay of a double-submit; the caller gets
    // the SAME appointment back, not a second one.
    return json({ booking, created });
  } catch (e) {
    if (e instanceof SlotUnavailableError) return handlePosError(new PosError('slot unavailable', 'slot_unavailable'));
    if (e instanceof Error && e.message === 'overrideConflicts requires forceResourceId') throw error(400, e.message);
    return handlePosError(e);
  }
};
