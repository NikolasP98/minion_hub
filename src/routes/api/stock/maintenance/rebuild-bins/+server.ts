import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { rebuildBins } from '$server/services/stock.service';

/**
 * POST /api/stock/maintenance/rebuild-bins?item=<id> — recovery path: replays
 * stk_ledger into stk_bins. Gated on `stock:manage` directly (stricter than
 * the generic `stock:edit` the central hooks.server.ts write-gate requires
 * for /api/stock/*, per the RBAC "required build step" convention — see
 * CLAUDE.md § RBAC gating).
 */
export const POST: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await requireOrgCapability(locals, 'stock', 'manage');
  const result = await rebuildBins(ctx, url.searchParams.get('item') ?? undefined);
  return json(result);
};
