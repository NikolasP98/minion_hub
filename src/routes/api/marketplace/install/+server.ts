import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { servers } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import { getMarketplaceAgent, recordInstall } from '$server/services/marketplace.service';
import { upsertAgents } from '$server/services/agent.service';
import { getTenantCtx } from '$server/auth/tenant-ctx';

export const POST: RequestHandler = async ({ locals, request }) => {
  const tenantCtx = await getTenantCtx(locals);
  if (!tenantCtx) throw error(401, 'No tenant configured');

  const body = await request.json();
  const { agentId, serverId, serverName, serverUrl } = body as {
    agentId?: string;
    serverId?: string;
    serverName?: string;
    serverUrl?: string;
  };

  if (!agentId || typeof agentId !== 'string') throw error(400, 'agentId is required');
  if (!serverId || typeof serverId !== 'string') throw error(400, 'serverId is required');

  // Ensure server row exists (FK required). Use onConflictDoNothing to preserve existing data.
  const now = nowMs();
  await tenantCtx.db
    .insert(servers)
    .values({
      id: serverId,
      tenantId: tenantCtx.tenantId,
      name: serverName ?? serverId,
      url: serverUrl ?? '',
      token: '',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const agent = await getMarketplaceAgent(tenantCtx.db, agentId);
  if (!agent) throw error(404, 'Agent not found in marketplace');

  // Upsert agent into hub agents DB for this server
  await upsertAgents(tenantCtx, serverId, [
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
  await recordInstall(tenantCtx, agentId, serverId);

  return json({ ok: true });
};
