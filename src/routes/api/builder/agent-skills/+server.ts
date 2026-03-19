import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { setAgentBuiltSkills } from '$server/services/builder.service';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);
  const { gatewayAgentId, serverId, skillIds } = await request.json();
  if (!gatewayAgentId || !serverId || !Array.isArray(skillIds)) {
    throw error(400, 'Missing gatewayAgentId, serverId, or skillIds');
  }
  await setAgentBuiltSkills(ctx, gatewayAgentId, serverId, skillIds);
  return json({ ok: true });
};
