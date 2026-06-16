import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { pluginsUiList } from '$lib/server/gateway-rpc';

export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  try {
    // Pass the acting org so each entry carries per-org `orgEnabled` — the nav
    // store dims plugins this org has disabled (vs the global configEnabled).
    const orgId = locals.orgId ?? locals.tenantCtx?.tenantId;
    const entries = await pluginsUiList(locals.user?.supabaseId, orgId);
    return json({ entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ entries: [], error: message }, { status: 200 });
  }
};
