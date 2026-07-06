import { ui } from '$lib/state/ui/ui.svelte';
import { queryClient } from '$lib/query/client';

export interface AgentGroup {
  id: string;
  name: string;
  sortOrder: number;
  memberAgentIds: string[];
}

interface AgentGroupsUiState {
  viewMode: 'list' | 'gallery';
  collapsedGroupIds: Set<string>;
  ungroupedCollapsed: boolean;
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
  } catch {
    /* ignore */
  }
  return new Set();
}

function persistViewMode(mode: 'list' | 'gallery') {
  try {
    localStorage.setItem('agentGroups:viewMode', mode);
  } catch {
    /* ignore */
  }
}

function persistCollapsed(ids: Set<string>) {
  try {
    localStorage.setItem('agentGroups:collapsed', JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

function loadPersistedUngroupedCollapsed(): boolean {
  try {
    return localStorage.getItem('agentGroups:ungroupedCollapsed') === 'true';
  } catch {
    return false;
  }
}

function persistUngroupedCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem('agentGroups:ungroupedCollapsed', String(collapsed));
  } catch {
    /* ignore */
  }
}

// UI-only state (not Query's concern — collapse/view-mode prefs, localStorage-backed).
const _ui = $state<AgentGroupsUiState>({
  viewMode: loadPersistedViewMode(),
  collapsedGroupIds: loadPersistedCollapsed(),
  ungroupedCollapsed: loadPersistedUngroupedCollapsed(),
});

export const agentGroupsState = {
  get viewMode() {
    return _ui.viewMode;
  },
  set viewMode(v: 'list' | 'gallery') {
    _ui.viewMode = v;
  },
  get collapsedGroupIds() {
    return _ui.collapsedGroupIds;
  },
  set collapsedGroupIds(v: Set<string>) {
    _ui.collapsedGroupIds = v;
  },
  get ungroupedCollapsed() {
    return _ui.ungroupedCollapsed;
  },
  set ungroupedCollapsed(v: boolean) {
    _ui.ungroupedCollapsed = v;
  },
};

function getServerId(): string | null {
  return ui.selectedServerId ?? null;
}

function groupsQueryKey(sid: string) {
  return ['agent-groups', sid] as const;
}

/** queryFn for `['agent-groups', serverId]` — owned by AgentSidebar's `createQuery`. */
export async function fetchAgentGroups(sid: string): Promise<AgentGroup[]> {
  const res = await fetch(`/api/servers/${sid}/agent-groups`);
  if (!res.ok) throw new Error(`agent-groups fetch failed: ${res.status}`);
  return ((await res.json()) as { groups: AgentGroup[] }).groups ?? [];
}

/**
 * Ask the mounted `createQuery(['agent-groups', serverId])` (in AgentSidebar)
 * to refetch. No-op if nothing is currently observing that key.
 */
export async function loadAgentGroups(serverId?: string) {
  const sid = serverId ?? getServerId();
  if (!sid) return;
  await queryClient.invalidateQueries({ queryKey: groupsQueryKey(sid) });
}

/** Optimistically patch the cached groups for the active server. */
function mutateGroups(updater: (groups: AgentGroup[]) => AgentGroup[]): void {
  const sid = getServerId();
  if (!sid) return;
  queryClient.setQueryData<AgentGroup[]>(groupsQueryKey(sid), (cur) => updater(cur ?? []));
}

export async function createAgentGroup(name: string) {
  const sid = getServerId();
  if (!sid) return;

  // Optimistic: generate temp ID, add to state immediately
  const tempId = `temp-${Date.now()}`;
  const optimistic: AgentGroup = { id: tempId, name, sortOrder: 0, memberAgentIds: [] };
  mutateGroups((groups) => [...groups, optimistic]);

  try {
    const res = await fetch(`/api/servers/${sid}/agent-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      mutateGroups((groups) => groups.filter((g) => g.id !== tempId));
      return;
    }
    const { group } = await res.json();
    mutateGroups((groups) => groups.map((g) => (g.id === tempId ? { ...g, id: group.id } : g)));
  } catch {
    mutateGroups((groups) => groups.filter((g) => g.id !== tempId));
  }
}

export async function updateAgentGroup(
  groupId: string,
  data: { name?: string; sortOrder?: number },
) {
  const sid = getServerId();
  if (!sid) return;

  const res = await fetch(`/api/servers/${sid}/agent-groups/${groupId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) return;

  mutateGroups((groups) => groups.map((g) => (g.id === groupId ? { ...g, ...data } : g)));
}

export async function deleteAgentGroup(groupId: string) {
  const sid = getServerId();
  if (!sid) return;

  const res = await fetch(`/api/servers/${sid}/agent-groups/${groupId}`, { method: 'DELETE' });
  if (!res.ok) return;

  mutateGroups((groups) => groups.filter((g) => g.id !== groupId));
  const next = new Set(agentGroupsState.collapsedGroupIds);
  next.delete(groupId);
  agentGroupsState.collapsedGroupIds = next;
  persistCollapsed(next);
}

export async function moveAgentToGroup(
  agentId: string,
  fromGroupId: string | null,
  toGroupId: string | null,
) {
  const sid = getServerId();
  if (!sid) return;
  const key = groupsQueryKey(sid);

  // Snapshot for revert — cheaper and less jarring than a full refetch on failure.
  const previous = queryClient.getQueryData<AgentGroup[]>(key);
  queryClient.setQueryData<AgentGroup[]>(key, (groups) =>
    (groups ?? []).map((g) => {
      if (g.id === fromGroupId) {
        return { ...g, memberAgentIds: g.memberAgentIds.filter((id) => id !== agentId) };
      }
      if (g.id === toGroupId) {
        return { ...g, memberAgentIds: [...g.memberAgentIds, agentId] };
      }
      return g;
    }),
  );

  try {
    if (fromGroupId) {
      const res = await fetch(`/api/servers/${sid}/agent-groups/${fromGroupId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      if (!res.ok) throw new Error(`remove member failed: ${res.status}`);
    }
    if (toGroupId) {
      const res = await fetch(`/api/servers/${sid}/agent-groups/${toGroupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      if (!res.ok) throw new Error(`add member failed: ${res.status}`);
    }
  } catch {
    // Rollback to the pre-optimistic snapshot.
    queryClient.setQueryData<AgentGroup[]>(key, previous);
  }
}

export function toggleAgentViewMode() {
  agentGroupsState.viewMode = agentGroupsState.viewMode === 'list' ? 'gallery' : 'list';
  persistViewMode(agentGroupsState.viewMode);
}

export function toggleGroupCollapsed(groupId: string) {
  const next = new Set(agentGroupsState.collapsedGroupIds);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  agentGroupsState.collapsedGroupIds = next;
  persistCollapsed(next);
}

export function toggleUngroupedCollapsed() {
  agentGroupsState.ungroupedCollapsed = !agentGroupsState.ungroupedCollapsed;
  persistUngroupedCollapsed(agentGroupsState.ungroupedCollapsed);
}
