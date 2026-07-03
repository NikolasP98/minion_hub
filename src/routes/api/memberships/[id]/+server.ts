import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { setMembershipStatus } from '$server/services/membership.service';

const patchSchema = z.object({ status: z.enum(['active', 'paused', 'cancelled']) });

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { status } = await parseBody(request, patchSchema);
  const row = await setMembershipStatus(ctx, params.id!, status);
  if (!row) throw error(404);
  return json(row);
};
