import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  uploadFile,
  listAuthorizedFiles,
  validateAttachment,
  assertOrgQuota,
  ATTACHMENT_LIMITS,
} from '$server/services/file.service';
import { z } from 'zod';
import { ATTACHMENT_OBJECT_TYPES } from '$server/db/pg-attachments-schema';
import { uploadProxiedAttachment } from '$server/services/attachments.service';
import { handleAttachmentError } from '../attachments/_errors';
import { resolveAttachmentAccess } from '$server/services/attachment-access';
import { getCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const category = url.searchParams.get('category') ?? undefined;
  const access = await resolveAttachmentAccess(locals, ctx);
  const files = await listAuthorizedFiles(ctx, category, access);
  return json({ files });
};

// R6 (recon D3): this is the server-proxied path, capped below Vercel's
// serverless body limit — anything larger goes through the presigned
// /api/attachments/intent flow instead (file.service ATTACHMENT_LIMITS).
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > ATTACHMENT_LIMITS.proxiedMaxBytes) {
    throw error(413, `file too large (max ${ATTACHMENT_LIMITS.proxiedMaxBytes} bytes)`);
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const category = (formData.get('category') as string) ?? 'general';

  if (!file) throw error(400, 'file is required');

  const contentType = file.type || 'application/octet-stream';
  const validation = validateAttachment(
    { fileName: file.name, contentType, sizeBytes: file.size },
    { maxBytes: ATTACHMENT_LIMITS.proxiedMaxBytes },
  );
  if (!validation.ok) {
    throw error(validation.code === 'mime_not_allowed' ? 415 : 413, validation.message);
  }
  const quota = await assertOrgQuota(ctx, file.size);
  if (!quota.ok) throw error(413, quota.message);

  const data = new Uint8Array(await file.arrayBuffer());
  if (category === 'attachment' || category === 'attachments') {
    const access = await resolveAttachmentAccess(locals, ctx);
    let targets: unknown;
    try {
      targets = JSON.parse(String(formData.get('links') ?? '[]'));
    } catch {
      throw error(400, 'Invalid attachment targets');
    }
    const parsed = z
      .array(z.object({ objectType: z.enum(ATTACHMENT_OBJECT_TYPES), objectId: z.string().uuid() }))
      .max(50)
      .safeParse(targets);
    if (!parsed.success) throw error(400, 'Invalid attachment targets');
    try {
      const id = await uploadProxiedAttachment(
        ctx,
        { fileName: file.name, contentType, sizeBytes: file.size, data, links: parsed.data },
        access,
      );
      return json({ ok: true, id });
    } catch (e) {
      return handleAttachmentError(e);
    }
  }
  const id = await uploadFile(ctx, {
    fileName: file.name,
    contentType,
    data,
    category,
    // uploaded_by is a uuid → profiles.id; use the Supabase identity or null.
    uploadedBy: locals.user?.supabaseId,
  });

  return json({ ok: true, id });
};
