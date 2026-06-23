import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listMemberships, createMembership } from '$server/services/membership.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await listMemberships(ctx));
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const b = await request.json();
  if (!b?.planId) throw error(400, 'planId required');
  return json(await createMembership(ctx, b), { status: 201 });
};
