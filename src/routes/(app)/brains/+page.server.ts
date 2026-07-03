import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { listBrains, resolvePrincipal } from '$server/services/brains.service';

/** /brains — every org-visible brain + any private brain the caller has access to. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await requireCoreCtx(locals);
  depends('brains:list');
  const principal = await resolvePrincipal(ctx);
  const brains = await listBrains(ctx, principal);
  return { brains };
};
