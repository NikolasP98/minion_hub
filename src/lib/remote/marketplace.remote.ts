/**
 * Remote functions for the agent marketplace (browse / sync / install).
 * Mirrors the `/api/marketplace/*` routes. Browsing is public (no auth), as in
 * the routes. The install command does the DB work and returns the agent files;
 * the WebSocket file-handoff to the gateway (`sendInstall`) stays CLIENT-side in
 * marketplace.svelte.ts — it's a duplex gateway operation, not request/response.
 */
import { query, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$server/db/client';
import { currentTenantCtx, currentLocals } from '$server/remote/guard';
import { servers } from '@minion-stack/db/schema';
import { nowMs } from '$server/db/utils';
import {
  listMarketplaceAgents,
  getAgentWithFiles,
  recordInstall,
  syncMarketplaceAgents,
} from '$server/services/marketplace.service';
import { upsertAgents } from '$server/services/agent.service';
import { getPostHogClient } from '$lib/server/posthog';

/** Browse marketplace agents (optionally filtered by category/search). */
export const getMarketplaceAgents = query(
  z.object({ category: z.string().optional(), search: z.string().optional() }),
  async ({ category, search }) => {
    const db = getDb();
    return listMarketplaceAgents(db, { category, search, limit: 50, offset: 0 });
  },
);

/** A single marketplace agent with its markdown files. */
export const getMarketplaceAgent = query(z.string().min(1), async (id) => {
  const agent = await getAgentWithFiles(getDb(), id);
  if (!agent) error(404, 'Agent not found');
  return agent;
});

/** Sync the marketplace catalog from GitHub. */
export const syncMarketplace = command(async () => {
  return syncMarketplaceAgents(getDb());
});

/**
 * Install a marketplace agent into a server: ensures the server row, upserts the
 * agent, records the install, and returns the agent files for WS delivery.
 */
export const installMarketplaceAgent = command(
  z.object({
    agentId: z.string().min(1),
    serverId: z.string().min(1),
    serverName: z.string().optional(),
    serverUrl: z.string().optional(),
  }),
  async ({ agentId, serverId, serverName, serverUrl }) => {
    const tenantCtx = await currentTenantCtx();

    // Ensure server row exists (FK required); preserve existing data.
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

    const agent = await getAgentWithFiles(tenantCtx.db, agentId);
    if (!agent) error(404, 'Agent not found in marketplace');

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

    await recordInstall(tenantCtx, agentId, serverId);

    const posthog = await getPostHogClient();
    posthog?.capture({
      distinctId: currentLocals().user?.id ?? 'anonymous',
      event: 'agent_installed_from_marketplace',
      properties: {
        agent_id: agentId,
        agent_name: agent.name,
        agent_category: agent.category,
        agent_version: agent.version,
        server_id: serverId,
      },
    });

    const agentJson = JSON.stringify(
      {
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
      },
      null,
      2,
    );

    const files: Record<string, string> = { 'agent.json': agentJson };
    if (agent.soulMd) files['SOUL.md'] = agent.soulMd;
    if (agent.identityMd) files['IDENTITY.md'] = agent.identityMd;
    if (agent.userMd) files['USER.md'] = agent.userMd;
    if (agent.contextMd) files['CONTEXT.md'] = agent.contextMd;
    if (agent.skillsMd) files['SKILLS.md'] = agent.skillsMd;

    return { ok: true as const, files };
  },
);
