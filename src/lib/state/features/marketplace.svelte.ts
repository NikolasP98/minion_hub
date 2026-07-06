import { sendInstall } from '$lib/services/gateway-rpc';
import { queryClient } from '$lib/query/client';

export interface MarketplaceAgent {
  id: string;
  name: string;
  role: string;
  category: string;
  tags: string; // JSON array string
  description: string;
  catchphrase: string | null;
  version: string;
  model: string | null;
  archetype: string | null;
  avatarSeed: string;
  githubPath: string;
  soulMd?: string | null;
  identityMd?: string | null;
  userMd?: string | null;
  contextMd?: string | null;
  skillsMd?: string | null;
  installCount: number | null;
  // Postgres timestamps serialise to ISO strings over the API (fed to `new Date()`).
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const marketplaceState = $state({
  selectedAgent: null as MarketplaceAgent | null,
  syncing: false,
  syncError: null as string | null,
  installing: false,
  installError: null as string | null,
  lastInstalledAgentId: null as string | null,
});

export function parseTags(tagsJson: string): string[] {
  try {
    return JSON.parse(tagsJson);
  } catch {
    return [];
  }
}

/** queryFn for the `['marketplace','agents', category, term]` query (owned by the agents list page). */
export async function fetchAgents(category?: string, search?: string): Promise<MarketplaceAgent[]> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (search) params.set('search', search);
  const res = await fetch(`/api/marketplace/agents?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { agents: MarketplaceAgent[] }).agents;
}

export async function loadAgent(id: string): Promise<MarketplaceAgent | null> {
  try {
    const res = await fetch(`/api/marketplace/agents/${id}`);
    if (!res.ok) return null;
    const { agent } = await res.json();
    return agent;
  } catch {
    return null;
  }
}

export async function syncFromGitHub(): Promise<{ synced: number; errors: string[] }> {
  marketplaceState.syncing = true;
  marketplaceState.syncError = null;
  try {
    const res = await fetch('/api/marketplace/sync', { method: 'POST' });
    if (!res.ok) {
      const text = await res.text();
      marketplaceState.syncError = text || 'Sync failed';
      return { synced: 0, errors: [marketplaceState.syncError] };
    }
    const data = await res.json();
    // Refresh any mounted agents-list query (list page, if open).
    await queryClient.invalidateQueries({ queryKey: ['marketplace', 'agents'] });
    return data;
  } catch (err) {
    marketplaceState.syncError = (err as Error).message;
    return { synced: 0, errors: [marketplaceState.syncError] };
  } finally {
    marketplaceState.syncing = false;
  }
}

export async function installAgent(
  agentId: string,
  serverId: string,
  serverName?: string,
  serverUrl?: string,
): Promise<boolean> {
  marketplaceState.installing = true;
  marketplaceState.installError = null;
  try {
    const res = await fetch('/api/marketplace/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, serverId, serverName, serverUrl }),
    });
    if (!res.ok) {
      const text = await res.text();
      marketplaceState.installError = text || 'Install failed';
      return false;
    }

    const data = (await res.json()) as { ok: boolean; files?: Record<string, string> };

    // Push agent files to the gateway filesystem via the active WebSocket connection
    if (data.files && Object.keys(data.files).length > 0) {
      try {
        await sendInstall(agentId, data.files);
      } catch (wsErr) {
        // File delivery failed — install is still recorded in DB.
        // Surface this as a non-fatal warning so the user knows files weren't pushed.
        marketplaceState.installError = `Agent registered but file delivery to gateway failed: ${(wsErr as Error).message}`;
        return false;
      }
    }

    marketplaceState.lastInstalledAgentId = agentId;
    // Optimistically bump install count in every cached list/detail entry.
    const bump = (a: MarketplaceAgent) =>
      a.id === agentId ? { ...a, installCount: (a.installCount ?? 0) + 1 } : a;
    queryClient.setQueriesData<MarketplaceAgent[]>(
      { queryKey: ['marketplace', 'agents'] },
      (agents) => agents?.map(bump),
    );
    queryClient.setQueryData<MarketplaceAgent | null>(
      ['marketplace', 'agent', agentId],
      (agent) => (agent ? bump(agent) : agent),
    );
    return true;
  } catch (err) {
    marketplaceState.installError = (err as Error).message;
    return false;
  } finally {
    marketplaceState.installing = false;
  }
}
