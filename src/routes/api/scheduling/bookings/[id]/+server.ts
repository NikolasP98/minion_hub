import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { setBookingStatus } from '$server/services/scheduling-bookings.service';

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.status !== 'string') throw error(400, 'status required');
  try {
    await setBookingStatus(ctx, params.id!, b.status);
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
  return json({ ok: true });
};
