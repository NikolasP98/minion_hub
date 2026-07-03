import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listDocuments, addDocument, resolvePrincipal } from '$server/services/brains.service';

/** GET /api/brains/:id/documents */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const principal = await resolvePrincipal(ctx);
  return json({ documents: await listDocuments(ctx, params.id!, principal) });
};

const postSchema = z.object({
  title: z.string().trim().min(1).max(500),
  sourceType: z.enum(['note', 'url', 'upload', 'module_ref']),
  sourceRef: z.string().max(2000).nullable().optional(),
  contentMd: z.string().max(500_000).nullable().optional(),
});

/** POST /api/brains/:id/documents — add a document (any sourceType); ingestion
 *  runs async via the brain_ingest bg job (see brains.service.ts). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const principal = await resolvePrincipal(ctx);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  const doc = await addDocument(ctx, params.id!, body, principal, actor);
  return json(doc, { status: 201 });
};
