import type { Host } from '$lib/types/host';
import { uuid } from '@minion-stack/shared';
import { page } from '$app/state';
import { invalidateHosts } from './user.svelte';
import { toastAsync } from '$lib/state/ui/toast.svelte';
import * as m from '$lib/paraglide/messages';

const HOSTS_CACHE_KEY = 'minion-dash-hosts-cache';

/**
 * Hosts now flow through the canonical (app)/+layout.server.ts bundle
 * into page.data. The localStorage cache is retained ONLY as a fast
 * fallback for the brief window before the layout-load completes (e.g.
 * pages outside (app)/ that still consume `hostsState`).
 *
 * activeHostId stays in localStorage and is exposed as writable state —
 * per spec it's a per-device user preference and does NOT belong in the
 * server-load bundle.
 *
 * Tokens are never persisted client-side: see `fetchHostToken()`.
 */

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

function readHostsCache(): Host[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HOSTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Host[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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

const local = $state({
  activeHostId: null as string | null,
  /** Local overlay applied after add/remove/update mutations so the UI
   *  reflects the change before `invalidateHosts()` re-runs the
   *  layout-load. Cleared on the next page-data read that includes the
   *  mutation. */
  overlay: null as Host[] | null,
});

function pageHosts(): Host[] | null {
  const data = page.data as { hosts?: { servers?: Host[] } } | undefined;
  const servers = data?.hosts?.servers;
  return Array.isArray(servers) ? servers : null;
}

export const hostsState = {
  /** Authoritative on (app)/* via page.data; falls back to overlay /
   *  localStorage cache outside that scope or during transitions. */
  get hosts(): Host[] {
    if (local.overlay) return local.overlay;
    const fromPage = pageHosts();
    if (fromPage) return fromPage;
    return readHostsCache();
  },
  get activeHostId(): string | null {
    return local.activeHostId;
  },
  set activeHostId(id: string | null) {
    local.activeHostId = id;
    if (id) saveLastActiveHost(id);
    else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('minion-dash-last-host');
    }
  },
};

export function getActiveHost(): Host | null {
  if (!local.activeHostId) return null;
  return hostsState.hosts.find((h) => h.id === local.activeHostId) ?? null;
}

/**
 * Initialize activeHostId from localStorage and warm the cache from the
 * current page.data snapshot. No network — data is server-loaded.
 */
export function loadHosts(): void {
  // Pull authoritative list from page.data (if (app)/+layout loaded);
  // mirror into localStorage so non-app routes have a fallback.
  const fromPage = pageHosts();
  if (fromPage) {
    updateHostsCache(fromPage);
    // Clear any stale overlay now that the layout-load has caught up.
    local.overlay = null;
  }

  const hosts = hostsState.hosts;
  const lastId =
    typeof localStorage !== 'undefined' ? localStorage.getItem('minion-dash-last-host') : null;
  if (lastId && hosts.some((h) => h.id === lastId)) {
    local.activeHostId = lastId;
  } else if (hosts.length > 0) {
    local.activeHostId = hosts[0].id;
    saveLastActiveHost(hosts[0].id);
  }
}

export function selectHost(id: string): void {
  if (!hostsState.hosts.some((h) => h.id === id)) return;
  local.activeHostId = id;
  saveLastActiveHost(id);
}

export async function addHost(host: { name: string; url: string; token: string }): Promise<string> {
  const existing = hostsState.hosts.find((h) => h.url === host.url);
  if (existing) {
    await updateHost(existing.id, { name: host.name, token: host.token }, { silent: true });
    local.activeHostId = existing.id;
    saveLastActiveHost(existing.id);
    return existing.id;
  }

  const id = uuid();
  const newHost: Host = { id, ...host, lastConnectedAt: null };

  return toastAsync(
    (async () => {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHost),
      });
      if (!res.ok) throw new Error(`Failed to save host: ${res.status}`);

      local.overlay = [...hostsState.hosts, newHost];
      updateHostsCache(local.overlay);
      local.activeHostId = id;
      saveLastActiveHost(id);
      await invalidateHosts();
      return id;
    })(),
    {
      loading: m.hosts_adding(),
      getOutcome: () => ({ type: 'success', title: 'Gateway added' }),
      onError: (err: unknown) => ({
        title: 'Failed to add gateway',
        description: err instanceof Error ? err.message : 'Could not add gateway.',
      }),
    },
  );
}

export async function updateHost(id: string, updates: Partial<Omit<Host, 'id'>>, options?: { silent?: boolean }) {
  const run = async () => {
    const res = await fetch(`/api/servers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to update host: ${res.status}`);
    const merged = hostsState.hosts.map((h) => (h.id === id ? { ...h, ...updates } : h));
    local.overlay = merged;
    updateHostsCache(merged);
    await invalidateHosts();
  };

  if (options?.silent) {
    await run();
    return;
  }

  await toastAsync(run(), {
    loading: 'Saving gateway…',
    getOutcome: () => ({ type: 'success', title: 'Gateway updated' }),
    onError: (err: unknown) => ({
      title: 'Failed to update gateway',
      description: err instanceof Error ? err.message : 'Update failed',
    }),
  });
}

export async function removeHost(id: string, options?: { silent?: boolean }) {
  const run = async () => {
    const res = await fetch(`/api/servers/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to remove host: ${res.status}`);
    const filtered = hostsState.hosts.filter((h) => h.id !== id);
    local.overlay = filtered;
    updateHostsCache(filtered);
    if (local.activeHostId === id) {
      const next = filtered[0]?.id ?? null;
      local.activeHostId = next;
      if (next) saveLastActiveHost(next);
      else if (typeof localStorage !== 'undefined')
        localStorage.removeItem('minion-dash-last-host');
    }
    await invalidateHosts();
  };

  if (options?.silent) {
    await run();
    return;
  }

  await toastAsync(run(), {
    loading: 'Removing gateway…',
    getOutcome: () => ({ type: 'success', title: 'Gateway removed' }),
    onError: (err: unknown) => ({
      title: 'Failed to remove gateway',
      description: err instanceof Error ? err.message : 'Remove failed',
    }),
  });
}

export function saveLastActiveHost(id: string) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('minion-dash-last-host', id);
  }
}
