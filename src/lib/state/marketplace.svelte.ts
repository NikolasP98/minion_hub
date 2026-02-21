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
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (search) params.set('search', search);

    const res = await fetch(`/api/marketplace/agents?${params.toString()}`);
    if (!res.ok) return;
    const { agents } = await res.json();
    marketplaceState.agents = agents;
  } catch {
    // non-critical
  } finally {
    marketplaceState.loading = false;
  }
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
    // Reload agents after sync
    await loadAgents(marketplaceState.selectedCategory ?? undefined, marketplaceState.searchQuery || undefined);
    return data;
  } catch (err) {
    marketplaceState.syncError = (err as Error).message;
    return { synced: 0, errors: [marketplaceState.syncError] };
  } finally {
    marketplaceState.syncing = false;
  }
}

export async function installAgent(agentId: string, serverId: string, serverName?: string, serverUrl?: string): Promise<boolean> {
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
