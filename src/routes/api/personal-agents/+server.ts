import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { listOrgPersonalAgents } from '$server/services/personal-agent.service';

export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  if (!locals.tenantCtx) throw error(401);
  const personalAgents = await listOrgPersonalAgents(locals.tenantCtx);
  return json({ personalAgents });
};
