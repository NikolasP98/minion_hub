import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { resolvePrincipal } from '$server/services/brains.service';
import { listBrainsWithKnowledgeStats } from '$server/services/brain-corpus.service';
import { ensureBusinessKnowledgeSources } from '$server/services/brain-business-corpus.service';

/** /brains — every org-visible brain + any private brain the caller has access to. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await requireCoreCtx(locals);
  depends('brains:list');
  // Cheap/idempotent discovery only. Heavy normalization + embedding is owned
  // by the durable daily job and the production backfill CLI.
  await ensureBusinessKnowledgeSources(ctx);
  const principal = await resolvePrincipal(ctx);
  const brains = await listBrainsWithKnowledgeStats(ctx, principal);
  return { brains };
};
