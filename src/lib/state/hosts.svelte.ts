import type { Host } from '$lib/types/host';
import { uuid } from '$lib/utils/uuid';

const STORAGE_KEY = 'minion-dash-hosts';
const ACTIVE_KEY = 'minion-dash-last-host';

export const hostsState = $state({
  hosts: [] as Host[],
  activeHostId: null as string | null,
});

export function getActiveHost(): Host | null {
  if (!hostsState.activeHostId) return null;
  return hostsState.hosts.find((h) => h.id === hostsState.activeHostId) ?? null;
}

// ---------------------------------------------------------------------------
// localStorage helpers (fast cache layer)
// ---------------------------------------------------------------------------

function cacheToLocal() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hostsState.hosts));
  if (hostsState.activeHostId) {
    localStorage.setItem(ACTIVE_KEY, hostsState.activeHostId);
  }
}

function loadFromLocal(): Host[] {
  if (typeof localStorage === 'undefined') return [];

  // Migrate old single-host format
  const oldUrl = localStorage.getItem('minion-dash-url');
  const oldToken = localStorage.getItem('minion-dash-token');
  if (oldUrl !== null || oldToken !== null) {
    let hostname = 'host';
    try { hostname = new URL(oldUrl ?? '').hostname || 'host'; } catch { /* ignore */ }
    const migrated: Host[] = [{ id: uuid(), name: hostname, url: oldUrl ?? '', token: oldToken ?? '', lastConnectedAt: null }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    localStorage.removeItem('minion-dash-url');
    localStorage.removeItem('minion-dash-token');
  }

  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Host[];
  } catch {
    return [];
  }
}

function restoreActiveId() {
  if (typeof localStorage === 'undefined') return;
  const lastId = localStorage.getItem(ACTIVE_KEY);
  if (lastId && hostsState.hosts.some((h) => h.id === lastId)) {
    hostsState.activeHostId = lastId;
  } else if (hostsState.hosts.length > 0) {
    hostsState.activeHostId = hostsState.hosts[0].id;
  }
}

// ---------------------------------------------------------------------------
// Server API helpers (source of truth — backed by SQLite/Turso)
// ---------------------------------------------------------------------------

async function fetchServersFromApi(): Promise<Host[] | null> {
  try {
    const res = await fetch('/api/servers');
    if (!res.ok) return null;
    const data = await res.json();
    return (data.servers ?? []) as Host[];
  } catch {
    return null;
  }
}

async function pushToApi(host: Host): Promise<void> {
  try {
    await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(host),
    });
  } catch { /* fire-and-forget */ }
}

async function deleteFromApi(id: string): Promise<void> {
  try {
    await fetch(`/api/servers/${id}`, { method: 'DELETE' });
  } catch { /* fire-and-forget */ }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load hosts: localStorage first (instant), then fetch from server and merge.
 * Server data wins on conflicts (same id); new local-only hosts get pushed up.
 */
export function loadHosts() {
  // 1. Instant load from localStorage
  hostsState.hosts = loadFromLocal();
  restoreActiveId();

  // 2. Background fetch from server API (source of truth)
  fetchServersFromApi().then((serverHosts) => {
    if (!serverHosts) return; // offline or unauthenticated — keep local

    // Merge: server data is authoritative for existing ids
    const serverById = new Map(serverHosts.map((h) => [h.id, h]));
    const localById = new Map(hostsState.hosts.map((h) => [h.id, h]));

    // Start with all server hosts
    const merged: Host[] = [...serverHosts];

    // Add any local-only hosts and push them to the server
    for (const [id, local] of localById) {
      if (!serverById.has(id)) {
        merged.push(local);
        pushToApi(local);
      }
    }

    hostsState.hosts = merged;
    cacheToLocal();
    restoreActiveId();
  });
}

/** Persist hosts to localStorage cache (called after mutations). */
export function saveHosts() {
  cacheToLocal();
}

/** Save a single host to both localStorage and server API. */
export async function persistHost(host: Host) {
  cacheToLocal();
  await pushToApi(host);
}

/** Delete a host from both localStorage and server API. */
export async function removeHost(id: string) {
  hostsState.hosts = hostsState.hosts.filter((h) => h.id !== id);
  cacheToLocal();
  await deleteFromApi(id);
}
