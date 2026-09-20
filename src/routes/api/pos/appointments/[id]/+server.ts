import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { requireOrgCapability } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  bookingDetailResponse,
  patchBookingResponse,
} from '../../../scheduling/bookings/_handlers';

/**
 * GET/PATCH /api/pos/appointments/[id] — the POS calendar's drawer detail and
 * its reschedule / status changes, gated on POS capabilities (`pos:view` here,
 * `pos:edit` centrally for PATCH) instead of scheduling ones. Same payloads as
 * `/api/scheduling/bookings/[id]`.
 */
async function gate(locals: App.Locals) {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(403, 'pos module disabled');
  return ctx;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await gate(locals);
  await requireOrgCapability(locals, 'pos', 'view');
  return bookingDetailResponse(ctx, locals, params.id!);
};

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const ctx = await gate(locals);
  return patchBookingResponse(ctx, locals, request, params.id!);
};
