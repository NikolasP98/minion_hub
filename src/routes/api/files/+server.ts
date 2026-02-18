import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { uploadFile, listFiles } from '$server/services/file.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.tenantCtx) throw error(401);

  const category = url.searchParams.get('category') ?? undefined;
  const files = await listFiles(locals.tenantCtx, category);
  return json({ files });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const category = (formData.get('category') as string) ?? 'general';

  if (!file) throw error(400, 'file is required');

  const data = new Uint8Array(await file.arrayBuffer());
  const id = await uploadFile(locals.tenantCtx, {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    data,
    category,
    uploadedBy: locals.user?.id,
  });

  return json({ ok: true, id });
};
