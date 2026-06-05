import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { uploadFile, listFiles } from '$server/services/file.service';
import { getCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const category = url.searchParams.get('category') ?? undefined;
  const files = await listFiles(ctx, category);
  return json({ files });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const category = (formData.get('category') as string) ?? 'general';

  if (!file) throw error(400, 'file is required');

  const data = new Uint8Array(await file.arrayBuffer());
  const id = await uploadFile(ctx, {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    data,
    category,
    // uploaded_by is a uuid → profiles.id; use the Supabase identity or null.
    uploadedBy: locals.user?.supabaseId,
  });

  return json({ ok: true, id });
};
