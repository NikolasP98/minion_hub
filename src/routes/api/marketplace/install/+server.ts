import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { tenants, servers } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import { getMarketplaceAgent, recordInstall } from '$server/services/marketplace.service';
import { upsertAgents } from '$server/services/agent.service';
import type { TenantContext } from '$server/services/base';

export const POST: RequestHandler = async ({ locals, request }) => {
  let tenantCtx = locals.tenantCtx;

  if (!tenantCtx) {
    // Fall back to first tenant for unauthenticated local usage
    const db = getDb();
    const rows = await db.select({ id: tenants.id }).from(tenants).limit(1);
    if (rows.length === 0) throw error(401, 'No tenant configured');
    tenantCtx = { db, tenantId: rows[0].id } satisfies TenantContext;
  }

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
