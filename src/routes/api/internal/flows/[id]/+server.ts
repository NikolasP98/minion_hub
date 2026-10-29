import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows } from '$server/db/pg-schema/flows';
import { eq } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { env } from '$env/dynamic/private';
import { isEnforced, orgAllowsForConfig } from '$server/services/entitlements.service';

/**
 * Internal endpoint for langgraph-server to fetch flow nodes+edges by ID.
 * Requires Authorization: Bearer <HUB_API_TOKEN>. FAIL CLOSED: if the env var
 * is unset this endpoint refuses — /api/internal/* bypasses user auth, so an
 * unset token must not mean "open to the internet".
 */
export const GET: RequestHandler = async ({ params, request }) => {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expectedToken = env.HUB_API_TOKEN ?? '';

  if (!expectedToken || token !== expectedToken) {
    throw error(401, 'Unauthorized');
  }

  const db = getCoreDb();
  const [flow] = await db.select().from(flows).where(eq(flows.id, params.id!)).limit(1);
  if (!flow) throw error(404, 'Flow not found');

  // Spec 043: the runner ends AI branches when false. Flag off → true. A lookup error never demotes a
  // paying org (owner decision): the last answer on this instance, else true.
  let aiEnabled = true;
  if (flow.tenantId) {
    aiEnabled = await orgAllowsForConfig(flow.tenantId, 'ai', 'flows.internal');
  } else {
    // TODO(handoff): flows with a NULL tenant_id are never gated (aiEnabled true); backfill
    // flows.tenant_id or decide their owner. See meta proposals/2026-10-29-hub-org-entitlements-followups.md (R13).
    if (isEnforced())
      console.info('entitlement.unscoped_flow', JSON.stringify({ flowId: flow.id }));
  }

  return json({
    nodes: JSON.parse(flow.nodes),
    edges: JSON.parse(flow.edges),
    aiEnabled,
  });
};
