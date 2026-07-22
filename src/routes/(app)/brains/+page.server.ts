import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { resolvePrincipal } from '$server/services/brains.service';
import { listBrainsWithKnowledgeStats } from '$server/services/brain-corpus.service';

/** /brains — every org-visible brain + any private brain the caller has access to. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await requireCoreCtx(locals);
  depends('brains:list');
  const principal = await resolvePrincipal(ctx);
  const brains = await listBrainsWithKnowledgeStats(ctx, principal);
  return { brains };
};
