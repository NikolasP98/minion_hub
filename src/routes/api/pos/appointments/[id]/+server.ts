import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireModuleEnabled } from '$server/http/require-module';
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
  await requireModuleEnabled(ctx, 'scheduling');
  await requireModuleEnabled(ctx, 'pos');
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
