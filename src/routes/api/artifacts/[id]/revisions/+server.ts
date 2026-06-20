import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { listRevisions } from '$lib/server/artifacts/store';

export const GET: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const revisions = await listRevisions(ctx, params.id);
  return json(revisions);
};
