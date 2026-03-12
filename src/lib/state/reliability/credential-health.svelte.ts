/**
 * State module for credential health data.
 *
 * Each snapshot contains a JSON blob with per-provider credential status
 * (e.g. { providers: [{ provider, profileId, status, expiresAt }] }).
 */

export interface CredentialProfile {
  provider: string;
  profileId: string;
  status: 'ok' | 'expiring' | 'expired' | 'static' | 'missing';
  expiresAt?: number | null;
}

export interface CredentialSnapshot {
  id: number;
  serverId: string;
  snapshotJson: string;
  capturedAt: number;
}

export interface ParsedSnapshot {
  capturedAt: number;
  providers: CredentialProfile[];
}

export function createCredentialHealthState() {
  let snapshots = $state<CredentialSnapshot[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load(serverId: string) {
    loading = true;
    error = null;
    try {
      const res = await globalThis.fetch(
        `/api/metrics/credential-health?serverId=${encodeURIComponent(serverId)}&limit=1`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      snapshots = data.snapshots ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function recomputeStatus(p: CredentialProfile): CredentialProfile {
    if (p.expiresAt == null) return p;
    const diff = p.expiresAt - Date.now();
    if (diff < 0) return { ...p, status: 'expired' };
    if (diff < 30 * 86_400_000) return { ...p, status: 'expiring' };
    return { ...p, status: 'ok' };
  }

  function parseLatest(): ParsedSnapshot | null {
    if (snapshots.length === 0) return null;
    const raw = snapshots[0];
    try {
      const parsed = JSON.parse(raw.snapshotJson);
      const providers: CredentialProfile[] = Array.isArray(parsed.providers) ? parsed.providers : [];
      return {
        capturedAt: raw.capturedAt,
        providers: providers.map(recomputeStatus),
      };
    } catch {
      return null;
    }
  }

  return {
    get snapshots() {
      return snapshots;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    load,
    parseLatest,
  };
}
