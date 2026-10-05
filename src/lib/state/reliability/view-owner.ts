import type { GatewaySessionOwner } from '$lib/services/gateway/session-owner.svelte';
import type { AsyncResourceOwner } from '../async.svelte';
export interface ReliabilityViewIdentity {
  actorId: string | null | undefined;
  orgId: string | null | undefined;
  hostId: string | null | undefined;
  hostUrl: string | null | undefined;
  /** The visible range/query that owns the read, when the caller has one. */
  queryKey?: string | null | undefined;
}

export interface ReliabilityHttpIdentity {
  actorId: string | null | undefined;
  orgId: string | null | undefined;
  serverId: string | null | undefined;
  /** The visible range/query that owns the read, when the caller has one. */
  queryKey?: string | null | undefined;
}

export interface ReliabilityHttpOwner extends AsyncResourceOwner {
  readonly actorId: string;
  readonly orgId: string;
  readonly serverId: string;
  readonly queryKey: string;
}

/**
 * Capture one HTTP-read authority epoch from canonical PageData. The token is
 * stable while actor/org/server stay unchanged, so a same-query refresh keeps
 * its admitted payload. `current()` re-reads PageData before every publication.
 */
export function createReliabilityHttpOwner(
  identity: () => ReliabilityHttpIdentity,
): () => ReliabilityHttpOwner | null {
  let cachedKey = '';
  let cached: ReliabilityHttpOwner | null = null;
  return () => {
    const view = identity();
    if (!view.actorId || !view.orgId || !view.serverId) {
      cachedKey = '';
      cached = null;
      return null;
    }
    const captured = {
      actorId: view.actorId,
      orgId: view.orgId,
      serverId: view.serverId,
      queryKey: view.queryKey ?? '',
    };
    const key = JSON.stringify([
      captured.actorId,
      captured.orgId,
      captured.serverId,
      captured.queryKey,
    ]);
    if (cached && cachedKey === key && cached.current()) return cached;
    const owner: ReliabilityHttpOwner = Object.freeze({
      ...captured,
      token: Symbol('reliability-http-owner'),
      current: () => {
        const current = identity();
        return (
          current.actorId === captured.actorId &&
          current.orgId === captured.orgId &&
          current.serverId === captured.serverId &&
          (current.queryKey ?? '') === captured.queryKey
        );
      },
    });
    cachedKey = key;
    cached = owner;
    return owner;
  };
}
/** Read canonical PageData again at publication, including before the next route effect. */
export function matchReliabilityViewOwner(
  owner: GatewaySessionOwner | null,
  identity: () => ReliabilityViewIdentity,
): GatewaySessionOwner | null {
  if (!owner) return null;
  const capturedQueryKey = identity().queryKey ?? '';
  const current = () => {
    const view = identity();
    return (
      owner.current() &&
      owner.actorId === view.actorId &&
      owner.orgId === view.orgId &&
      owner.hostId === view.hostId &&
      owner.hostUrl === view.hostUrl &&
      (view.queryKey ?? '') === capturedQueryKey
    );
  };
  return current() ? { ...owner, current } : null;
}
