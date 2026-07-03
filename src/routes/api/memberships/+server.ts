import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listMemberships, createMembership } from '$server/services/membership.service';

const postSchema = z.object({
  planId: z.string().min(1).max(200),
  crmContactId: z.string().max(200).nullable().optional(),
  partyId: z.string().max(200).nullable().optional(),
  customerName: z.string().max(500).nullable().optional(),
  startedAt: z.coerce.date().optional(),
});

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await listMemberships(ctx));
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const b = await parseBody(request, postSchema);
  return json(await createMembership(ctx, b), { status: 201 });
};
