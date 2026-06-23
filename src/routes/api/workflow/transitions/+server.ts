import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { transitionsFor } from '$server/services/workflow.service';

// Available workflow actions for one doc. GET ?docType=&docId=
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const docType = url.searchParams.get('docType');
  const docId = url.searchParams.get('docId');
  if (!docType || !docId) throw error(400, 'docType, docId required');
  const transitions = await transitionsFor(ctx, docType, docId, {
    id: locals.user?.supabaseId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
    role: locals.user?.role ?? null,
  });
  return json(transitions);
};
