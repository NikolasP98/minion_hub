import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { servers } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import { getAgentWithFiles, recordInstall } from '$server/services/marketplace.service';
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

  // Fetch agent with all markdown files (lazy-populates from GitHub if not yet cached)
  const agent = await getAgentWithFiles(tenantCtx.db, agentId);
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

  // Record the install in the hub DB
  await recordInstall(tenantCtx, agentId, serverId);

  // Build agent.json content from DB fields for gateway delivery
  const agentJson = JSON.stringify({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    category: agent.category,
    tags: JSON.parse(agent.tags),
    description: agent.description,
    catchphrase: agent.catchphrase,
    version: agent.version,
    model: agent.model,
    avatarSeed: agent.avatarSeed,
  }, null, 2);

  // Return files so the client can push them to the gateway via WebSocket
  const files: Record<string, string> = { 'agent.json': agentJson };
  if (agent.soulMd) files['SOUL.md'] = agent.soulMd;
  if (agent.identityMd) files['IDENTITY.md'] = agent.identityMd;
  if (agent.userMd) files['USER.md'] = agent.userMd;
  if (agent.contextMd) files['CONTEXT.md'] = agent.contextMd;
  if (agent.skillsMd) files['SKILLS.md'] = agent.skillsMd;

  return json({ ok: true, files });
};
