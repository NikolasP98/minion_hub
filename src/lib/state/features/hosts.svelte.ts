import type { Host } from '$lib/types/host';
import type { BuildChannel, ChannelEndpoint } from '$lib/types/host';
import { uuid } from '@minion-stack/shared';
import { page } from '$app/state';
import { invalidateHosts } from './user.svelte';
import { toastAsync } from '$lib/state/ui/toast.svelte';

const HOSTS_CACHE_KEY = 'minion-dash-hosts-cache';
/** Manual host pick — sessionStorage: respected for the current session only,
 *  so a days-old selection can't override the org's assigned gateway. */
const LAST_HOST_KEY = 'minion-dash-last-host';
/** Manual BUILD CHANNEL pick (spec 2026-07-19 §D3). Same sessionStorage-only
 *  rule as the host pick it replaces, for the same reason: a stale pick must
 *  never pin an org to a channel it no longer has. Validated against the
 *  server-resolved `channels` list on every load, so losing a channel silently
 *  drops the pick instead of black-holing the connection. */
const BUILD_CHANNEL_KEY = 'minion-dash-build-channel';

/**
 * Hosts now flow through the canonical (app)/+layout.server.ts bundle
 * into page.data. The localStorage cache is retained ONLY as a fast
 * fallback for the brief window before the layout-load completes (e.g.
 * pages outside (app)/ that still consume `hostsState`).
 *
 * activeHostId precedence ("the balancer decides where requests go"):
 *   1. a manual pick made THIS session (sessionStorage — HostPill/HostsOverlay),
 *   2. the active org's assigned host (page.data orgAssignedHostId),
 *   3. first host.
 * A persisted localStorage pick from previous days no longer pins users to a
 * host their org isn't assigned to (it black-holed a FACES session on
 * minion-1 while minion-2 was healthy).
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`/api/servers/${id}/token`, {
        method: 'POST',
        headers: { 'cache-control': 'no-store' },
      });
      if (res.status === 401) {
        console.warn('[hosts] token fetch 401 — session required to connect');
        return null;
      }
      if (res.status === 503 && attempt === 0) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '1');
        const delayMs = Math.min(2_000, Math.max(250, retryAfter * 1_000 || 1_000));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
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
  return null;
}

const local = $state({
  activeHostId: null as string | null,
  /** Build channel the user is on. The ONLY thing a human picks (§D4) — the
   *  instance behind it is resolved server-side and arrives in page.data. */
  activeChannel: null as BuildChannel | null,
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

/** Host currently assigned to the active org (per-org volume tenancy §3.4 —
 * `gateway.org_id` is a mutable assignment/lease read-model, not ownership).
 * Server-computed in hosts.service.ts; null = no assignment (shared pool). */
function pageOrgAssignedHostId(): string | null {
  const data = page.data as { hosts?: { orgAssignedHostId?: string | null } } | undefined;
  return data?.hosts?.orgAssignedHostId ?? null;
}

/** Build channels the active org has, each ALREADY resolved server-side to one
 * instance (spec §D4 — a human picks the channel, the lease picks the box).
 * Empty on a pre-migration server, which is why every consumer degrades to the
 * old host-id path rather than assuming this is populated. */
function pageChannels(): ChannelEndpoint[] {
  const data = page.data as { hosts?: { channels?: ChannelEndpoint[] } } | undefined;
  const channels = data?.hosts?.channels;
  return Array.isArray(channels) ? channels : [];
}

function pageDefaultChannel(): BuildChannel | null {
  const data = page.data as { hosts?: { defaultChannel?: BuildChannel | null } } | undefined;
  return data?.hosts?.defaultChannel ?? null;
}

function readChannelPick(): BuildChannel | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(BUILD_CHANNEL_KEY);
  return raw === 'dev' || raw === 'prd' ? raw : null;
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
    else if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(LAST_HOST_KEY);
    }
  },
  /** Channels the active org can reach, server-resolved. Length ≤ 1 ⇒ there is
   *  nothing to pick and the control hides itself entirely (FACES). */
  get channels(): ChannelEndpoint[] {
    return pageChannels();
  },
  get activeChannel(): BuildChannel | null {
    return local.activeChannel;
  },
};

/**
 * Switch build channel. Returns the instance the SERVER resolved for it, or
 * null if the org can't reach that channel — the client never picks an instance
 * and never invents one, which is the split that caused the all-day
 * intermittency (browser on an explicit host, server guessing separately).
 *
 * Caller reconnects; this only moves the pointer.
 */
export function selectChannel(channel: BuildChannel): string | null {
  const target = pageChannels().find((c) => c.channel === channel);
  if (!target) return null;
  local.activeChannel = channel;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(BUILD_CHANNEL_KEY, channel);
  }
  local.activeHostId = target.serverId;
  saveLastActiveHost(target.serverId);
  return target.serverId;
}

/**
 * Ask the server to re-probe the current channel and flip the lease if the
 * holder is dead (spec §F2/§F4). Call on connect failure — never speculatively,
 * it opens a real WS upgrade server-side.
 *
 * Returns `stateMoved: false` always: a flip restores SERVICE, not SESSIONS.
 * Surface that; a silent partial recovery is worse than an honest error.
 */
export async function revalidateChannel(): Promise<ChannelEndpoint | null> {
  const channel = local.activeChannel;
  if (!channel) return null;
  try {
    const res = await fetch('/api/gateway/lease', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    });
    if (!res.ok) return null;
    const next = (await res.json()) as ChannelEndpoint;
    if (next.serverId && next.serverId !== local.activeHostId) {
      local.activeHostId = next.serverId;
      saveLastActiveHost(next.serverId);
    }
    return next;
  } catch {
    return null;
  }
}

export function getActiveHost(): Host | null {
  if (!local.activeHostId) return null;
  return hostsState.hosts.find((h) => h.id === local.activeHostId) ?? null;
}

/**
 * Initialize activeHostId and warm the cache from the current page.data
 * snapshot. No network — data is server-loaded.
 * Precedence: this-session manual pick > org-assigned host > first host.
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
  // Drop the legacy persisted pick — it used to win unconditionally and
  // pinned sessions to hosts their org isn't assigned to.
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LAST_HOST_KEY);

  // Channel path (spec §D3). The server already resolved each channel the org
  // has to exactly one instance, so picking a channel picks the connection.
  // A this-session pick wins, but ONLY if the org still has that channel —
  // validating against the server list is what keeps a stale pick from pinning
  // an org to a channel it lost.
  const channels = pageChannels();
  if (channels.length > 0) {
    const pick = readChannelPick();
    const chosen =
      channels.find((c) => c.channel === pick) ??
      channels.find((c) => c.channel === pageDefaultChannel()) ??
      channels[0];
    if (pick && pick !== chosen.channel && typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(BUILD_CHANNEL_KEY);
    }
    local.activeChannel = chosen.channel;
    local.activeHostId = chosen.serverId;
    return;
  }

  // Pre-migration / no-channel fallback: the original host-id precedence. Keeps
  // this shippable ahead of 20260719210000_gateway_channel_lease.sql.
  const hosts = hostsState.hosts;
  const sessionPick =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(LAST_HOST_KEY) : null;
  const orgHostId = pageOrgAssignedHostId();
  if (sessionPick && hosts.some((h) => h.id === sessionPick)) {
    // Explicit pick made this session — respect it until the tab closes.
    local.activeHostId = sessionPick;
  } else if (orgHostId && hosts.some((h) => h.id === orgHostId)) {
    // The org's assigned gateway wins over any stale preference (§3.4).
    local.activeHostId = orgHostId;
  } else if (hosts.length > 0) {
    local.activeHostId = hosts[0].id;
  }
}

/**
 * Re-point at the active org's assigned host after an org switch (call after
 * invalidateAll so page.data is fresh). Clears the session manual pick — it
 * belonged to the previous org context. Returns true if the active host
 * changed (caller should reconnect exactly once — no reconnect loops).
 */
export function applyOrgAssignedHost(): boolean {
  // The channel pick belonged to the PREVIOUS org — the new org may not even
  // have that channel (FACES is prd-only). Drop it and take the new org's
  // default; keeping it is how an org gets pinned to a channel it lost.
  if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(BUILD_CHANNEL_KEY);
  const channels = pageChannels();
  if (channels.length > 0) {
    const chosen = channels.find((c) => c.channel === pageDefaultChannel()) ?? channels[0];
    local.activeChannel = chosen.channel;
    if (chosen.serverId === local.activeHostId) return false;
    local.activeHostId = chosen.serverId;
    return true;
  }

  const orgHostId = pageOrgAssignedHostId();
  if (!orgHostId || !hostsState.hosts.some((h) => h.id === orgHostId)) return false;
  if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(LAST_HOST_KEY);
  if (orgHostId === local.activeHostId) return false;
  local.activeHostId = orgHostId;
  return true;
}

/** Return the org-assigned host without mutating the active connection pick. */
export function getOrgAssignedHost(): Host | null {
  const orgHostId = pageOrgAssignedHostId();
  if (!orgHostId) return null;
  return hostsState.hosts.find((host) => host.id === orgHostId) ?? null;
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

  // Lazy: this module loads with the root layout — a module-scope messages
  // import would drag the full paraglide chunk into the eager shell bundle.
  const m = await import('$lib/paraglide/messages');
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

export async function updateHost(
  id: string,
  updates: Partial<Omit<Host, 'id'>>,
  options?: { silent?: boolean },
) {
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
      else if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(LAST_HOST_KEY);
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
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(LAST_HOST_KEY, id);
  }
}
