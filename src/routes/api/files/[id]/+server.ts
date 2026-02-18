import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getFileUrl, deleteFile } from '$server/services/file.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  const file = await getFileUrl(locals.tenantCtx, params.id!);
  if (!file) throw error(404);
  return json({ file });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  await deleteFile(locals.tenantCtx, params.id!);
  return json({ ok: true });
};
