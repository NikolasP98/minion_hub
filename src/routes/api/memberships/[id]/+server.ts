import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { setMembershipStatus } from '$server/services/membership.service';

const STATUSES = new Set(['active', 'paused', 'cancelled']);

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { status } = await request.json();
  if (!STATUSES.has(status)) throw error(400, 'status must be active|paused|cancelled');
  const row = await setMembershipStatus(ctx, params.id!, status);
  if (!row) throw error(404);
  return json(row);
};
