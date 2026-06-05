import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listOrgPersonalAgents } from '$server/services/personal-agent.service';

export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const personalAgents = await listOrgPersonalAgents(ctx);
  return json({ personalAgents });
};
