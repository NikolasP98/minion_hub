/** Owner-fenced credential health snapshots. */
import { createAsyncResource } from '../async.svelte';
import { integer, record, rows, string } from './decode-primitives';
import { fetchReliabilityJson, RELIABILITY_HTTP_MAX_BYTES } from './http-read';
import { createReadFailureMonitor } from './read-monitor';
import type { ReliabilityHttpOwner } from './view-owner';

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

interface DecodedCredentialSnapshot extends CredentialSnapshot {
  providers: CredentialProfile[];
}

export interface ParsedSnapshot {
  capturedAt: number;
  providers: CredentialProfile[];
}

const STATUSES = new Set<CredentialProfile['status']>([
  'ok',
  'expiring',
  'expired',
  'static',
  'missing',
]);

function decodeProviders(snapshotJson: string): CredentialProfile[] {
  let raw: unknown;
  try {
    raw = JSON.parse(snapshotJson) as unknown;
  } catch {
    throw new Error('Invalid credential snapshot JSON');
  }
  const value = record(raw);
  const providers = rows(
    value.providers,
    (rawProfile) => {
      const profile = record(rawProfile);
      const status = string(profile.status) as CredentialProfile['status'];
      if (!STATUSES.has(status)) throw new Error('Invalid credential status');
      const expiresAt =
        profile.expiresAt === undefined || profile.expiresAt === null
          ? profile.expiresAt
          : integer(profile.expiresAt);
      return {
        provider: string(profile.provider),
        profileId: string(profile.profileId),
        status,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      };
    },
    2000,
  );
  const keys = providers.map((profile) => `${profile.provider}\u0000${profile.profileId}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate credential profile');
  return providers;
}

export function decodeCredentialSnapshots(
  raw: unknown,
  expectedServerId: string,
): DecodedCredentialSnapshot[] {
  const envelope = record(raw);
  return rows(
    envelope.snapshots,
    (rawSnapshot) => {
      const snapshot = record(rawSnapshot);
      const serverId = string(snapshot.serverId);
      if (serverId !== expectedServerId) throw new Error('Credential snapshot owner mismatch');
      const snapshotJson = string(snapshot.snapshotJson, RELIABILITY_HTTP_MAX_BYTES);
      return {
        id: integer(snapshot.id),
        serverId,
        snapshotJson,
        capturedAt: integer(snapshot.capturedAt),
        providers: decodeProviders(snapshotJson),
      };
    },
    2000,
  );
}

export function createCredentialHealthState(owner: () => ReliabilityHttpOwner | null) {
  const monitor = createReadFailureMonitor('credentialHealth');
  let controller: AbortController | null = null;
  let lastServerId: string | null = null;
  const resource = createAsyncResource<
    DecodedCredentialSnapshot[],
    [ReliabilityHttpOwner | null, string, AbortSignal]
  >(
    async (captured, serverId, signal) => {
      if (!captured) throw new Error('Credential health unavailable');
      let phase: 'transport' | 'decode' = 'transport';
      try {
        const params = new URLSearchParams({ serverId, limit: '1' });
        const raw = await fetchReliabilityJson(`/api/metrics/credential-health?${params}`, signal);
        phase = 'decode';
        const result = decodeCredentialSnapshots(raw, serverId);
        return result;
      } catch (error) {
        if (captured.current()) monitor.failed(captured.token, phase);
        throw error;
      }
    },
    {
      initialLoading: true,
      formatError: () => 'Credential health could not be refreshed.',
      owner: (captured) => captured,
      key: (_captured, serverId) => serverId,
      beforePublish: (_snapshots, captured) => captured && monitor.ready(),
    },
  );

  function recomputeStatus(profile: CredentialProfile): CredentialProfile {
    if (profile.expiresAt == null) return profile;
    const diff = profile.expiresAt - Date.now();
    if (diff < 0) return { ...profile, status: 'expired' };
    if (diff < 30 * 86_400_000) return { ...profile, status: 'expiring' };
    return { ...profile, status: 'ok' };
  }

  async function load(serverId: string): Promise<void> {
    lastServerId = serverId;
    controller?.abort();
    controller = new AbortController();
    await resource.load(owner(), serverId, controller.signal);
  }
  function reset(): void {
    controller?.abort();
    controller = null;
    resource.reset();
  }
  function parseLatest(): ParsedSnapshot | null {
    const latest = resource.data?.[0];
    return latest
      ? { capturedAt: latest.capturedAt, providers: latest.providers.map(recomputeStatus) }
      : null;
  }
  return {
    get snapshots(): CredentialSnapshot[] {
      return resource.data ?? [];
    },
    get loading() {
      return resource.loading;
    },
    get error() {
      return resource.error;
    },
    get status() {
      return resource.status;
    },
    load,
    retry: () => (lastServerId ? load(lastServerId) : Promise.resolve()),
    reset,
    parseLatest,
  };
}
