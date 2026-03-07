import { ui } from '$lib/state/ui/ui.svelte';

export interface AgentGroup {
  id: string;
  name: string;
  sortOrder: number;
  memberAgentIds: string[];
}

interface AgentGroupsState {
  groups: AgentGroup[];
  loading: boolean;
  viewMode: 'list' | 'gallery';
  collapsedGroupIds: Set<string>;
}

function loadPersistedViewMode(): 'list' | 'gallery' {
  try {
    const v = localStorage.getItem('agentGroups:viewMode');
    return v === 'gallery' ? 'gallery' : 'list';
  } catch {
    return 'list';
  }
}

function loadPersistedCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem('agentGroups:collapsed');
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function persistViewMode(mode: 'list' | 'gallery') {
  try { localStorage.setItem('agentGroups:viewMode', mode); } catch { /* ignore */ }
}

function persistCollapsed(ids: Set<string>) {
  try { localStorage.setItem('agentGroups:collapsed', JSON.stringify([...ids])); } catch { /* ignore */ }
}

export const agentGroupsState: AgentGroupsState = $state({
  groups: [],
  loading: false,
  viewMode: loadPersistedViewMode(),
  collapsedGroupIds: loadPersistedCollapsed(),
});

function getServerId(): string | null {
  return ui.selectedServerId ?? null;
}

export async function loadAgentGroups(serverId?: string) {
  const sid = serverId ?? getServerId();
  if (!sid) return;

  agentGroupsState.loading = true;
  try {
    const res = await fetch(`/api/servers/${sid}/agent-groups`);
    if (!res.ok) return;
    const { groups } = await res.json();
    agentGroupsState.groups = groups ?? [];
  } catch {
    // non-critical
  } finally {
    agentGroupsState.loading = false;
  }
}

export async function createAgentGroup(name: string) {
  const sid = getServerId();
  if (!sid) return;

  const res = await fetch(`/api/servers/${sid}/agent-groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return;
  const { group } = await res.json();
  agentGroupsState.groups = [...agentGroupsState.groups, group];
}

export async function updateAgentGroup(groupId: string, data: { name?: string; sortOrder?: number }) {
  const sid = getServerId();
  if (!sid) return;

  const res = await fetch(`/api/servers/${sid}/agent-groups/${groupId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) return;

  agentGroupsState.groups = agentGroupsState.groups.map((g) =>
    g.id === groupId ? { ...g, ...data } : g,
  );
}

export async function deleteAgentGroup(groupId: string) {
  const sid = getServerId();
  if (!sid) return;

  const res = await fetch(`/api/servers/${sid}/agent-groups/${groupId}`, { method: 'DELETE' });
  if (!res.ok) return;

  agentGroupsState.groups = agentGroupsState.groups.filter((g) => g.id !== groupId);
  agentGroupsState.collapsedGroupIds.delete(groupId);
  persistCollapsed(agentGroupsState.collapsedGroupIds);
}

export async function moveAgentToGroup(agentId: string, fromGroupId: string | null, toGroupId: string | null) {
  const sid = getServerId();
  if (!sid) return;

  // Optimistic update
  agentGroupsState.groups = agentGroupsState.groups.map((g) => {
    if (g.id === fromGroupId) {
      return { ...g, memberAgentIds: g.memberAgentIds.filter((id) => id !== agentId) };
    }
    if (g.id === toGroupId) {
      return { ...g, memberAgentIds: [...g.memberAgentIds, agentId] };
    }
    return g;
  });

  try {
    if (fromGroupId) {
      await fetch(`/api/servers/${sid}/agent-groups/${fromGroupId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
    }
    if (toGroupId) {
      await fetch(`/api/servers/${sid}/agent-groups/${toGroupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
    }
  } catch {
    // Rollback on error
    await loadAgentGroups(sid);
  }
}

export function toggleAgentViewMode() {
  agentGroupsState.viewMode = agentGroupsState.viewMode === 'list' ? 'gallery' : 'list';
  persistViewMode(agentGroupsState.viewMode);
}

export function toggleGroupCollapsed(groupId: string) {
  if (agentGroupsState.collapsedGroupIds.has(groupId)) {
    agentGroupsState.collapsedGroupIds.delete(groupId);
  } else {
    agentGroupsState.collapsedGroupIds.add(groupId);
  }
  persistCollapsed(agentGroupsState.collapsedGroupIds);
}
