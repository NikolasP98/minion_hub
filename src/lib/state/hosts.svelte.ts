import type { Host } from '$lib/types/host';
import { uuid } from '$lib/utils/uuid';

export const hostsState = $state({
  hosts: [] as Host[],
  activeHostId: null as string | null,
});

export function getActiveHost(): Host | null {
  if (!hostsState.activeHostId) return null;
  return hostsState.hosts.find((h) => h.id === hostsState.activeHostId) ?? null;
}

export async function loadHosts() {
  try {
    const res = await fetch('/api/servers');
    if (res.ok) {
      const data = await res.json();
      hostsState.hosts = data.servers as Host[];
    }
  } catch {
    hostsState.hosts = [];
  }

  // Restore last active host from localStorage (UI preference only)
  const lastId = typeof localStorage !== 'undefined' ? localStorage.getItem('minion-dash-last-host') : null;
  if (lastId && hostsState.hosts.some((h) => h.id === lastId)) {
    hostsState.activeHostId = lastId;
  } else if (hostsState.hosts.length > 0) {
    hostsState.activeHostId = hostsState.hosts[0].id;
  }
}

export async function addHost(host: { name: string; url: string; token: string }): Promise<string> {
  // Check for existing host with the same URL to prevent duplicates
  const existing = hostsState.hosts.find((h) => h.url === host.url);
  if (existing) {
    // Update the existing host instead of creating a duplicate
    await updateHost(existing.id, { name: host.name, token: host.token });
    hostsState.activeHostId = existing.id;
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
  hostsState.activeHostId = id;
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
  if (h) Object.assign(h, updates);
}

export async function removeHost(id: string) {
  const res = await fetch(`/api/servers/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to remove host: ${res.status}`);
  hostsState.hosts = hostsState.hosts.filter((h) => h.id !== id);
}

export function saveLastActiveHost(id: string) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('minion-dash-last-host', id);
  }
}
