import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { resolvePrincipal } from '$server/services/brains.service';
import { searchBrainHybrid } from '$server/services/brain-hybrid-retrieval.service';
import { requireOrgCapability } from '$server/services/rbac.service';

const postSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  limit: z.number().int().positive().max(50).optional(),
  sourceIds: z.array(z.string().uuid()).max(50).optional(),
  connectors: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  kinds: z
    .array(z.enum(['summary', 'section', 'burst', 'code_file', 'code_symbol', 'raw']))
    .max(20)
    .optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  neighborRadius: z.number().int().min(0).max(3).optional(),
});

/** POST /api/brains/:id/search — deterministic hybrid evidence retrieval. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  await requireOrgCapability(locals, 'brains', 'view');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const principal = await resolvePrincipal(ctx);
  const result = await searchBrainHybrid(ctx, params.id!, body.query, body, principal);
  return json(result);
};
