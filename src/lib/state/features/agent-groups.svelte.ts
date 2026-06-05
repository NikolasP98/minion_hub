import { ui } from '$lib/state/ui/ui.svelte';
import { createCachedStore, type CachedStore } from '$lib/state/cached-store.svelte';
import { userState } from '$lib/state/features/user.svelte';
import {
  getAgentGroups,
  createAgentGroup as createAgentGroupRemote,
  updateAgentGroup as updateAgentGroupRemote,
  deleteAgentGroup as deleteAgentGroupRemote,
  addAgentToGroupRemote,
  removeAgentFromGroupRemote,
} from '$lib/remote/agent-groups.remote';

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

export const agentGroupsState: AgentGroupsState = $state({
  groups: [],
  loading: false,
  viewMode: loadPersistedViewMode(),
  collapsedGroupIds: loadPersistedCollapsed(),
  ungroupedCollapsed: loadPersistedUngroupedCollapsed(),
});

function getServerId(): string | null {
  return ui.selectedServerId ?? null;
}

// Module-scope cached store — one instance per session, replaced if server/user changes.
let _groupsStore: CachedStore<AgentGroup[]> | null = null;
let _groupsStoreKey = '';

function buildCacheKey(sid: string, userId: string, tenantId: string): string {
  return `hub:v1:agent-groups:t=${tenantId}:u=${userId}:s=${sid}`;
}

function buildCacheTags(sid: string, userId: string, tenantId: string): string[] {
  return [
    `t:${tenantId}:agent-groups`,
    `t:${tenantId}`,
    `d:agent-groups`,
    `u:${userId}`,
    `s:${sid}`,
  ];
}

function getOrCreateGroupsStore(sid: string): CachedStore<AgentGroup[]> {
  const userId = userState.user?.id ?? 'anon';
  const tenantId = userState.orgId ?? 'anon';
  const key = buildCacheKey(sid, userId, tenantId);

  if (_groupsStore && _groupsStoreKey === key) return _groupsStore;

  // Destroy old store (unregisters from invalidation listener).
  _groupsStore?.destroy();

  _groupsStore = createCachedStore<AgentGroup[]>({
    key,
    tags: buildCacheTags(sid, userId, tenantId),
    fetcher: async () => {
      const data = (await getAgentGroups()) as AgentGroup[];
      // Keep module-scope state in sync so existing consumers see the update.
      agentGroupsState.groups = data;
      agentGroupsState.loading = false;
      return data;
    },
    storage: 'session',
  });
  _groupsStoreKey = key;
  return _groupsStore;
}

export async function loadAgentGroups(serverId?: string) {
  const sid = serverId ?? getServerId();
  if (!sid) return;

  agentGroupsState.loading = true;
  const store = getOrCreateGroupsStore(sid);
  // If sessionStorage already has fresh data, data is non-null immediately.
  if (store.data !== null) {
    agentGroupsState.groups = store.data;
    agentGroupsState.loading = store.loading;
  }
  // Always kick a background refresh so data stays current.
  await store.refresh();
}

/**
 * Destroy the current cached store (call from a component's onDestroy when the
 * component is the primary owner of the groups lifecycle).
 */
export function destroyGroupsStore(): void {
  _groupsStore?.destroy();
  _groupsStore = null;
  _groupsStoreKey = '';
}

export async function createAgentGroup(name: string) {
  const sid = getServerId();
  if (!sid) return;

  // Optimistic: generate temp ID, add to state immediately
  const tempId = `temp-${Date.now()}`;
  const optimistic: AgentGroup = { id: tempId, name, sortOrder: 0, memberAgentIds: [] };
  agentGroupsState.groups = [...agentGroupsState.groups, optimistic];

  try {
    const { group } = await createAgentGroupRemote({ name });
    agentGroupsState.groups = agentGroupsState.groups.map((g) =>
      g.id === tempId ? { ...g, id: group.id } : g,
    );
  } catch {
    agentGroupsState.groups = agentGroupsState.groups.filter((g) => g.id !== tempId);
  }
}

export async function updateAgentGroup(
  groupId: string,
  data: { name?: string; sortOrder?: number },
) {
  const sid = getServerId();
  if (!sid) return;

  try {
    await updateAgentGroupRemote({ groupId, ...data });
  } catch {
    return;
  }

  agentGroupsState.groups = agentGroupsState.groups.map((g) =>
    g.id === groupId ? { ...g, ...data } : g,
  );
}

export async function deleteAgentGroup(groupId: string) {
  const sid = getServerId();
  if (!sid) return;

  try {
    await deleteAgentGroupRemote(groupId);
  } catch {
    return;
  }

  agentGroupsState.groups = agentGroupsState.groups.filter((g) => g.id !== groupId);
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
      await removeAgentFromGroupRemote({ groupId: fromGroupId, agentId });
    }
    if (toGroupId) {
      await addAgentToGroupRemote({ groupId: toGroupId, agentId });
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
