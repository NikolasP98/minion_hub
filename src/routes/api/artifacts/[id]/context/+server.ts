import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getArtifactContext } from '$lib/server/artifacts/registry';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await requireCoreCtx(locals); // throws 401 if unauthenticated
  const agentId = url.searchParams.get('agentId');
  if (!agentId) throw error(400, 'agentId required');
  const context = await getArtifactContext(ctx, agentId, params.id);
  if (!context) throw error(404, 'artifact context not found');
  return json(context);
};
