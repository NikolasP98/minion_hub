import type { Host } from '$lib/types/host';
import { uuid } from '@minion-stack/shared';

const HOSTS_CACHE_KEY = 'minion-dash-hosts-cache';

/**
 * Strip token before persisting. Tokens live server-side and are fetched
 * via POST /api/servers/[id]/token immediately before WS connect — never
 * read from localStorage. Cached tokens drift, server-encrypted tokens
 * don't.
 */
function stripTokens(hosts: Host[]): Host[] {
  return hosts.map(({ token: _drop, ...rest }) => rest);
}

function updateHostsCache(hosts: Host[]) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(HOSTS_CACHE_KEY, JSON.stringify(stripTokens(hosts)));
  }
}

/**
 * Fetches the decrypted gateway token for a host immediately before
 * connecting. Requires an authenticated session — surfaces 401 so the
 * caller can redirect to /login. Returns `null` on any failure; callers
 * MUST treat that as "cannot connect" rather than silently retrying with
 * a stale cached token.
 */
export async function fetchHostToken(id: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/servers/${id}/token`, {
      method: 'POST',
      headers: { 'cache-control': 'no-store' },
    });
    if (res.status === 401) {
      console.warn('[hosts] token fetch 401 — session required to connect');
      return null;
    }
    if (!res.ok) {
      console.warn(`[hosts] token fetch failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch (err) {
    console.warn('[hosts] token fetch threw', err);
    return null;
  }
}

export const hostsState = $state({
  hosts: [] as Host[],
  activeHostId: null as string | null,
});

export function getActiveHost(): Host | null {
  if (!hostsState.activeHostId) return null;
  return hostsState.hosts.find((h) => h.id === hostsState.activeHostId) ?? null;
}

export async function loadHosts() {
  // Seed state immediately from localStorage cache for instant UI
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(HOSTS_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as Host[];
        if (Array.isArray(cached) && cached.length > 0) {
          hostsState.hosts = cached;
        }
      }
    } catch {
      /* ignore corrupt cache */
    }
  }

  // Fetch fresh data from DB. Do NOT overwrite cache on error or on a
  // suspicious empty response — silent wipes on refresh are the bug that
  // motivated this guard. Only treat an empty list as authoritative when
  // we either had no cache to begin with, or the response carries an
  // explicit `authoritative: true` (e.g. server can prove "no hosts" is
  // a real DB state, not an auth/decrypt failure masquerading as empty).
  try {
    const res = await fetch('/api/servers');
    if (!res.ok) {
      console.warn(
        `[hosts] GET /api/servers returned ${res.status}; preserving cached hosts`,
      );
      return;
    }
    const data = (await res.json()) as { servers?: Host[]; authoritative?: boolean };
    const fresh = Array.isArray(data.servers) ? data.servers : null;
    if (fresh === null) {
      console.warn('[hosts] GET /api/servers returned unexpected payload; preserving cache');
      return;
    }
    const cachedCount = hostsState.hosts.length;
    if (fresh.length === 0 && cachedCount > 0 && data.authoritative !== true) {
      console.warn(
        `[hosts] Server returned 0 hosts but cache has ${cachedCount}. ` +
          'Treating as suspect (likely auth/decrypt drift). Preserving cache. ' +
          'Add ?force=1 to /api/servers or call addHost/removeHost to overwrite.',
      );
      return;
    }
    hostsState.hosts = fresh;
    updateHostsCache(fresh);
  } catch (err) {
    console.warn('[hosts] GET /api/servers threw; preserving cache', err);
  }

  // Restore last-active preference. Persist whichever id wins so the next
  // reload picks the same host even if the WS handshake hasn't run yet
  // (saveLastActiveHost was previously only called from inside the WS
  // success path, so a freshly-added host with no completed connect would
  // never write the key).
  const lastId =
    typeof localStorage !== 'undefined' ? localStorage.getItem('minion-dash-last-host') : null;
  if (lastId && hostsState.hosts.some((h) => h.id === lastId)) {
    hostsState.activeHostId = lastId;
  } else if (hostsState.hosts.length > 0) {
    hostsState.activeHostId = hostsState.hosts[0].id;
    saveLastActiveHost(hostsState.hosts[0].id);
  }
}

export function selectHost(id: string): void {
  if (!hostsState.hosts.some((h) => h.id === id)) return;
  hostsState.activeHostId = id;
  saveLastActiveHost(id);
}

export async function addHost(host: { name: string; url: string; token: string }): Promise<string> {
  // Check for existing host with the same URL to prevent duplicates
  const existing = hostsState.hosts.find((h) => h.url === host.url);
  if (existing) {
    // Update the existing host instead of creating a duplicate
    await updateHost(existing.id, { name: host.name, token: host.token });
    hostsState.activeHostId = existing.id;
    saveLastActiveHost(existing.id);
    updateHostsCache(hostsState.hosts);
    return existing.id;
  }

  const id = uuid();
  const newHost: Host = { id, ...host, lastConnectedAt: null };
  const res = await fetch('/api/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newHost),
  });
  if (!res.ok) throw new Error(`Failed to save host: ${res.status}`);
  hostsState.hosts.push(newHost);
  updateHostsCache(hostsState.hosts);
  hostsState.activeHostId = id;
  saveLastActiveHost(id);
  return id;
}

export async function updateHost(id: string, updates: Partial<Omit<Host, 'id'>>) {
  const res = await fetch(`/api/servers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update host: ${res.status}`);
  const h = hostsState.hosts.find((x) => x.id === id);
  if (h) {
    Object.assign(h, updates);
    updateHostsCache(hostsState.hosts);
  }
}

export async function removeHost(id: string) {
  const res = await fetch(`/api/servers/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to remove host: ${res.status}`);
  hostsState.hosts = hostsState.hosts.filter((h) => h.id !== id);
  updateHostsCache(hostsState.hosts);
  // If we just removed the active host, advance to another or clear.
  if (hostsState.activeHostId === id) {
    const next = hostsState.hosts[0]?.id ?? null;
    hostsState.activeHostId = next;
    if (next) saveLastActiveHost(next);
    else if (typeof localStorage !== 'undefined')
      localStorage.removeItem('minion-dash-last-host');
  }
}

export function saveLastActiveHost(id: string) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('minion-dash-last-host', id);
  }
}
