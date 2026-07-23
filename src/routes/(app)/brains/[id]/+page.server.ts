import type { PageServerLoad } from './$types';
import { error, isHttpError } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import {
  listDocuments,
  listAccess,
  canAccessBrain,
  resolvePrincipal,
} from '$server/services/brains.service';
import { getBrainKnowledgeOverview } from '$server/services/brain-corpus.service';
import { listRbacRoles } from '$server/services/rbac.service';
import { listEntityTimeline } from '$server/services/activity.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

/**
 * /brains/:id — 404s when the brain doesn't exist OR isn't accessible
 * (canAccessBrain fail-closed), same "no existence leak" shape as the API.
 * Access-management data (grants + role catalog) is only fetched for callers
 * with write access — `listAccess` itself requires it, so this also saves a
 * guaranteed-403 round trip for read-only viewers.
 */
export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await requireCoreCtx(locals);
  depends('brains:detail');
  const principal = await resolvePrincipal(ctx);

  let overview;
  try {
    overview = await getBrainKnowledgeOverview(ctx, params.id, principal);
  } catch (e) {
    if (isHttpError(e) && e.status === 403) throw error(404, 'Brain not found');
    throw e;
  }
  if (!overview) throw error(404, 'Brain not found');

  const [documents, canWriteBrain, timeline] = await Promise.all([
    listDocuments(ctx, params.id, principal),
    canAccessBrain(ctx, params.id, 'write', principal),
    listEntityTimeline(ctx, 'brain', params.id),
  ]);

  const [access, roles] = canWriteBrain
    ? await Promise.all([listAccess(ctx, params.id, principal), listRbacRoles(ctx.tenantId)])
    : [[], []];

  return { brain: overview.brain, overview, documents, canWriteBrain, access, roles, timeline };
};
