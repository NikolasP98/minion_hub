import type { GatewaySessionOwner } from '$lib/services/gateway/session-owner.svelte';
import { createReadFailureMonitor, type ReliabilityResourceName } from './read-monitor';

export type ReliabilityReadStatus =
  'idle' | 'loading' | 'ready' | 'failed' | 'unsupported' | 'unavailable';

/** One endpoint/query slot. Every asynchronous publication belongs to its captured epoch. */
export function createReliabilityResource<T>(name: ReliabilityResourceName) {
  let value = $state.raw<T | null>(null);
  let viewOwner = $state.raw<GatewaySessionOwner | null>(null);
  let status = $state<ReliabilityReadStatus>('idle');
  let queryKey = '';
  let token: symbol | null = null;
  let generation = 0;
  const monitor = createReadFailureMonitor(name);

  function reset() {
    generation++;
    queryKey = '';
    token = null;
    value = null;
    viewOwner = null;
    status = 'idle';
  }

  async function load(
    owner: GatewaySessionOwner | null,
    method: string,
    params: Record<string, unknown>,
    decode: (raw: unknown) => T,
  ): Promise<void> {
    const key = JSON.stringify([method, params]);
    const requestGeneration = ++generation;
    const current = () => generation === requestGeneration && owner?.current() === true;
    if (queryKey !== key || token !== owner?.token) value = null;
    queryKey = key;
    token = owner?.token ?? null;
    viewOwner = owner;
    if (!owner?.current() || !owner.methods) {
      value = null;
      status = 'unavailable';
      return;
    }
    if (!owner.methods.includes(method)) {
      value = null;
      status = 'unsupported';
      return;
    }
    status = 'loading';
    let phase: 'transport' | 'decode' = 'transport';
    try {
      const raw = await owner.request(method, params);
      if (!current()) return;
      phase = 'decode';
      const next = decode(raw);
      if (!current()) return;
      value = next;
      status = 'ready';
      monitor.ready();
    } catch {
      if (current()) {
        status = 'failed';
        monitor.failed(owner.token, phase);
      }
    }
  }

  return {
    get value() {
      return viewOwner && !viewOwner.current() ? null : value;
    },
    get status() {
      return viewOwner && !viewOwner.current() ? 'idle' : status;
    },
    reset,
    load,
    /** The live sample may append only after its owner has been checked by the caller. */
    replace(next: T) {
      value = next;
    },
  };
}
