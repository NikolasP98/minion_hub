import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getFileUrl, deleteFile } from '$server/services/file.service';
import { getCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const file = await getFileUrl(ctx, params.id!);
  if (!file) throw error(404);
  return json({ file });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  await deleteFile(ctx, params.id!);
  return json({ ok: true });
};
