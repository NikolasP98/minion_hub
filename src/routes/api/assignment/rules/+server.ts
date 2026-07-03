import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listRules, createRule } from '$server/services/assignment.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await listRules(ctx));
};

const postSchema = z.object({
  name: z.string().min(1).max(500),
  enabled: z.boolean().optional(),
  docType: z.string().min(1).max(200),
  strategy: z.string().max(200).optional(),
  assignees: z.array(z.unknown()).optional(),
  condition: z.unknown().optional(),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const b = await parseBody(request, postSchema);
  try {
    return json(await createRule(ctx, b), { status: 201 });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid rule');
  }
};
