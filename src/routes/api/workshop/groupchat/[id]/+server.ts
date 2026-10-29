import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getGroupchatRun } from '$server/services/groupchat.service';
import { requireFeature } from '$server/services/entitlements.service';

// Poll a run: status + agents + full transcript.
export const GET: RequestHandler = async ({ locals, params }) => {
  await requireFeature(locals, 'ai');
  if (!locals.tenantCtx) throw error(401);
  const ctx = await getGroupchatRun(locals.tenantCtx.tenantId, params.id!);
  if (!ctx) throw error(404);
  return json(ctx);
};
