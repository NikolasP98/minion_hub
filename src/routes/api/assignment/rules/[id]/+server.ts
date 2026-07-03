import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { updateRule, deleteRule } from '$server/services/assignment.service';

const patchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
  docType: z.string().min(1).max(200).optional(),
  strategy: z.string().max(200).optional(),
  assignees: z.array(z.unknown()).optional(),
  condition: z.unknown().optional(),
});

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const rule = await updateRule(ctx, params.id!, await parseBody(request, patchSchema));
  if (!rule) throw error(404);
  return json(rule);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await deleteRule(ctx, params.id!);
  return json({ ok: true });
};
