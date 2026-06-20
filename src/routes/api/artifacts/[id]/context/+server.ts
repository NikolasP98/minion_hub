import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getArtifactContext } from '$lib/server/artifacts/registry';
import { getSystemAgentDescriptors } from '$lib/server/system-agents/registry';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await requireCoreCtx(locals); // throws 401 if unauthenticated
  const agentId = url.searchParams.get('agentId');
  if (!agentId) throw error(400, 'agentId required');
  // Admin-only agents (e.g. the artifact builder) gate their context like their UI:
  // the card/detail guards only hide it, but this JSON API is independently forgeable.
  const desc = getSystemAgentDescriptors().find((d) => d.id === agentId);
  if (desc?.adminOnly && locals.user?.role !== 'admin') throw error(404, 'artifact context not found');
  const context = await getArtifactContext(ctx, agentId, params.id);
  if (!context) throw error(404, 'artifact context not found');
  return json(context);
};
