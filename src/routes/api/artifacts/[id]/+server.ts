import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { deleteArtifactRow } from '$lib/server/artifacts/store';

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  await deleteArtifactRow(ctx, params.id);
  return json({ ok: true });
};
