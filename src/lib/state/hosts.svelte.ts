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

export function loadHosts() {
  if (typeof localStorage === 'undefined') return;

  // Migrate old single-host format
  const oldUrl = localStorage.getItem('minion-dash-url');
  const oldToken = localStorage.getItem('minion-dash-token');
  if (oldUrl !== null || oldToken !== null) {
    let hostname = 'host';
    try { hostname = new URL(oldUrl ?? '').hostname || 'host'; } catch { /* ignore */ }
    const migrated: Host[] = [{ id: uuid(), name: hostname, url: oldUrl ?? '', token: oldToken ?? '', lastConnectedAt: null }];
    localStorage.setItem('minion-dash-hosts', JSON.stringify(migrated));
    localStorage.removeItem('minion-dash-url');
    localStorage.removeItem('minion-dash-token');
  }

  try {
    hostsState.hosts = JSON.parse(localStorage.getItem('minion-dash-hosts') ?? '[]') as Host[];
  } catch {
    hostsState.hosts = [];
  }

  const lastId = localStorage.getItem('minion-dash-last-host');
  if (lastId && hostsState.hosts.some((h) => h.id === lastId)) {
    hostsState.activeHostId = lastId;
  } else if (hostsState.hosts.length > 0) {
    hostsState.activeHostId = hostsState.hosts[0].id;
  }
}

export function saveHosts() {
  localStorage.setItem('minion-dash-hosts', JSON.stringify(hostsState.hosts));
}
