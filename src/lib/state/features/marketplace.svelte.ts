import {
  getMarketplaceAgents,
  getMarketplaceAgent,
  syncMarketplace,
  installMarketplaceAgent,
} from '$lib/remote/marketplace.remote';

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
  avatarSeed: string;
  githubPath: string;
  soulMd?: string | null;
  identityMd?: string | null;
  userMd?: string | null;
  contextMd?: string | null;
  skillsMd?: string | null;
  installCount: number | null;
  syncedAt: number;
  createdAt: number;
  updatedAt: number;
}

export const marketplaceState = $state({
  agents: [] as MarketplaceAgent[],
  selectedAgent: null as MarketplaceAgent | null,
  selectedCategory: null as string | null,
  searchQuery: '',
  syncing: false,
  syncError: null as string | null,
  loading: false,
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

export async function loadAgents(category?: string, search?: string) {
  marketplaceState.loading = true;
  try {
    marketplaceState.agents = (await getMarketplaceAgents({ category, search })) as MarketplaceAgent[];
  } catch {
    // non-critical
  } finally {
    marketplaceState.loading = false;
  }
}

export async function loadAgent(id: string): Promise<MarketplaceAgent | null> {
  try {
    return (await getMarketplaceAgent(id)) as MarketplaceAgent;
  } catch {
    return null;
  }
}

export async function syncFromGitHub(): Promise<{ synced: number; errors: string[] }> {
  marketplaceState.syncing = true;
  marketplaceState.syncError = null;
  try {
    const data = await syncMarketplace();
    // Reload agents after sync
    await loadAgents(
      marketplaceState.selectedCategory ?? undefined,
      marketplaceState.searchQuery || undefined,
    );
    return data;
  } catch (err) {
    marketplaceState.syncError = (err as Error).message || 'Sync failed';
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
    const data = await installMarketplaceAgent({ agentId, serverId, serverName, serverUrl });

    // Push agent files to the gateway filesystem via the active WebSocket connection
    if (data.files && Object.keys(data.files).length > 0) {
      const { sendInstall } = await import('$lib/services/gateway.svelte');
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
    // Optimistically bump install count
    const agent = marketplaceState.agents.find((a) => a.id === agentId);
    if (agent) agent.installCount = (agent.installCount ?? 0) + 1;
    return true;
  } catch (err) {
    marketplaceState.installError = (err as Error).message;
    return false;
  } finally {
    marketplaceState.installing = false;
  }
}
