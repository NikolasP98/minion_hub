import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { createImport, requirePersonalOrg } from '$server/services/finance-statements.service';

// R5: dedicated upload endpoint — NOT raw /api/files (no finance capability/
// MIME/size/hash checks there). Multipart 'file' → CSV; JSON { text } → pasted.
const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_CHARS = 500_000; // ~500 KB pasted text
const ALLOWED_CSV_MIME = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'text/plain',
  'application/octet-stream',
]);

const textSchema = z.object({ text: z.string().min(1).max(MAX_TEXT_CHARS) });

/** POST /api/finances/statement-imports — create (or dedupe onto) an import
 *  and enqueue the statement_ingest background job. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403, 'finances module disabled');
  await requirePersonalOrg(ctx);

  const contentType = request.headers.get('content-type') ?? '';
  const createdBy = locals.user?.supabaseId ?? null;

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) throw error(400, 'file is required');
    if (file.size === 0) throw error(400, 'file is empty');
    if (file.size > MAX_CSV_BYTES) throw error(413, `file too large (max ${MAX_CSV_BYTES} bytes)`);
    const isCsvName = file.name.toLowerCase().endsWith('.csv');
    if (!isCsvName && !ALLOWED_CSV_MIME.has(file.type)) {
      throw error(400, 'unsupported file type — expected CSV');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await createImport(ctx, {
      sourceKind: 'csv',
      fileName: file.name,
      contentType: file.type || 'text/csv',
      bytes,
      createdBy,
    });
    return json({ id: result.import.id, status: result.import.status, created: result.created });
  }

  const body = await parseBody(request, textSchema);
  const result = await createImport(ctx, { sourceKind: 'text', text: body.text, createdBy });
  return json({ id: result.import.id, status: result.import.status, created: result.created });
};
