import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listDefs, upsertDef } from '$server/services/workflow.service';

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
  const b = await request.json();
  if (!b?.name || !b?.docType) throw error(400, 'name, docType required');
  try {
    return json(await upsertDef(ctx, b), { status: 201 });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid def');
  }
};
