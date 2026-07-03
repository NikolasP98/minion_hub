import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listDefs, upsertDef } from '$server/services/workflow.service';

// states/transitions are jsonb blobs — kept as z.unknown() per plan (no deep
// structural schema in this pass); upsertDef/the doc-type allowlist validate at runtime.
const postSchema = z.object({
  docType: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  enabled: z.boolean().optional(),
  states: z.array(z.unknown()).optional(),
  transitions: z.array(z.unknown()).optional(),
});

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await listDefs(ctx));
};

// Upsert (one def per doc_type — unique conflict updates in place).
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const b = await parseBody(request, postSchema);
  try {
    return json(await upsertDef(ctx, b), { status: 201 });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid def');
  }
};
