import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { getMarketplaceAgent, recordInstall } from '$server/services/marketplace.service';
import { upsertAgents } from '$server/services/agent.service';

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  const { agentId, serverId } = body as { agentId?: string; serverId?: string };

  if (!agentId || typeof agentId !== 'string') throw error(400, 'agentId is required');
  if (!serverId || typeof serverId !== 'string') throw error(400, 'serverId is required');

  const db = getDb();
  const agent = await getMarketplaceAgent(db, agentId);
  if (!agent) throw error(404, 'Agent not found in marketplace');

  // Upsert agent into hub agents DB for this server
  await upsertAgents(locals.tenantCtx, serverId, [
    {
      id: agentId,
      name: agent.name,
      emoji: null,
      description: agent.description,
      model: agent.model,
      role: agent.role,
      category: agent.category,
      marketplaceVersion: agent.version,
      avatarSeed: agent.avatarSeed,
    },
  ]);

  // Record the install
  await recordInstall(locals.tenantCtx, agentId, serverId);

  return json({ ok: true });
};
