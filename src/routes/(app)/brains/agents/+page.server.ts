import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { listBrains, resolvePrincipal } from '$server/services/brains.service';

/**
 * /brains/agents — which agent manages each brain. Wave 2 adds `brains.agent_id`
 * + provisioning; for now this just surfaces the org's brains list so the page
 * has real data to render (agent column is an em-dash placeholder client-side).
 */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await requireCoreCtx(locals);
  depends('brains:list');
  const principal = await resolvePrincipal(ctx);
  const brains = await listBrains(ctx, principal);
  return { brains };
};
