import type {
  NotificationHealthSeed,
  NotificationWorkerHealth,
} from '$lib/notifications/worker-health';
import {
  decodeNotificationWorkerHealth,
  NOTIFICATION_HEALTH_MAX_BYTES,
  NOTIFICATION_HEALTH_TIMEOUT_MS,
} from '$lib/notifications/worker-health';

export interface NotificationHealthIdentity {
  readonly actorId: string | null | undefined;
  readonly orgId: string | null | undefined;
}

export type NotificationHealthReadStatus = 'ready' | 'loading' | 'failed' | 'unavailable';

export interface NotificationHealthController {
  readonly value: NotificationWorkerHealth | null;
  readonly status: NotificationHealthReadStatus;
  readonly stale: boolean;
  readonly warning: boolean;
  reconcile(identity: NotificationHealthIdentity, seed: NotificationHealthSeed): void;
  refresh(): Promise<void>;
  dispose(): void;
}

function identityKey(identity: NotificationHealthIdentity): string | null {
  return identity.actorId && identity.orgId
    ? JSON.stringify([identity.actorId, identity.orgId])
    : null;
}

function seedKey(seed: NotificationHealthSeed): string {
  return JSON.stringify([seed.actorId, seed.orgId]);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > NOTIFICATION_HEALTH_MAX_BYTES) {
      await response.body?.cancel();
      throw new Error('Notification health response is unavailable');
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Notification health response is unavailable');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > NOTIFICATION_HEALTH_MAX_BYTES) {
        await reader.cancel();
        throw new Error('Notification health response is unavailable');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('Notification health response is unavailable');
  }
}

async function fetchNotificationHealth(signal: AbortSignal): Promise<NotificationWorkerHealth> {
  const response = await fetch('/api/notifications/health', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Notification health response is unavailable');
  }
  return decodeNotificationWorkerHealth(await readBoundedJson(response));
}

/** One actor/org health owner. A changed PageData scope synchronously hides the old snapshot. */
export function createNotificationHealthController(
  initialIdentity: NotificationHealthIdentity,
  initialSeed: NotificationHealthSeed,
): NotificationHealthController {
  let value = $state.raw<NotificationWorkerHealth | null>(null);
  let status = $state<NotificationHealthReadStatus>('unavailable');
  let activeKey: string | null = null;
  let generation = 0;
  let disposed = false;
  let lastSeed: NotificationHealthSeed | null = null;
  let active: {
    readonly key: string;
    readonly controller: AbortController;
    readonly promise: Promise<void>;
  } | null = null;

  function visible(): boolean {
    return activeKey !== null;
  }

  function cancelActive(): void {
    active?.controller.abort();
    active = null;
  }

  function clear(nextKey: string | null): void {
    generation++;
    cancelActive();
    activeKey = nextKey;
    value = null;
    status = 'unavailable';
  }

  function reconcile(identity: NotificationHealthIdentity, seed: NotificationHealthSeed): void {
    if (disposed) return;
    const currentKey = identityKey(identity);
    if (currentKey === null) {
      lastSeed = seed;
      clear(null);
      return;
    }
    if (activeKey !== currentKey) clear(currentKey);
    if (lastSeed === seed) return;
    lastSeed = seed;
    generation++;
    cancelActive();
    if (seedKey(seed) !== currentKey) {
      value = null;
      status = 'unavailable';
      return;
    }
    if (seed.status === 'unavailable') {
      status = value ? 'failed' : 'unavailable';
      return;
    }
    if (!value || Date.parse(seed.value.checkedAt) >= Date.parse(value.checkedAt)) {
      value = seed.value;
    }
    status = 'ready';
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    const key = activeKey;
    if (key === null) {
      clear(null);
      return;
    }
    if (active?.key === key) return active.promise;
    cancelActive();
    const requestGeneration = ++generation;
    const controller = new AbortController();
    status = 'loading';
    const timeout = setTimeout(() => controller.abort(), NOTIFICATION_HEALTH_TIMEOUT_MS);
    const current = () => !disposed && generation === requestGeneration && activeKey === key;
    const record = {
      key,
      controller,
      promise: Promise.resolve(),
    };
    record.promise = (async () => {
      try {
        const next = await fetchNotificationHealth(controller.signal);
        if (!current()) return;
        value = next;
        status = 'ready';
      } catch {
        if (current()) status = 'failed';
      } finally {
        clearTimeout(timeout);
        if (active === record) active = null;
      }
    })();
    active = record;
    return record.promise;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    lastSeed = null;
    clear(null);
  }

  reconcile(initialIdentity, initialSeed);

  return {
    get value() {
      return visible() ? value : null;
    },
    get status() {
      return visible() ? status : 'unavailable';
    },
    get stale() {
      return visible() && value !== null && status === 'failed';
    },
    get warning() {
      if (!visible() || status === 'failed' || status === 'unavailable') return true;
      return value?.state !== 'runnable';
    },
    reconcile,
    refresh,
    dispose,
  };
}
