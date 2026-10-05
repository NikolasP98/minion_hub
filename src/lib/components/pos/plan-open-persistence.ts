export * from './plan-open-record';

import {
  PLAN_OPERATION_MAX_BYTES,
  PLAN_OPERATION_UUID_RE,
  PLAN_OPERATION_VERSION,
  PlanPersistenceError,
  isPendingPlanOperation,
  isPlanOperationIdentity,
  serializePendingPlanOperation,
  type PendingPlanOperation,
  type PlanOpenContinuation,
  type PlanOpenIntent,
  type PlanOperationIdentity,
} from './plan-open-record';

const STORAGE_PREFIX = 'minion:pos-plan-operation:v1';
const UUID_PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface LockOptions {
  mode: 'exclusive';
  signal: AbortSignal;
}

interface LockManagerLike {
  request<T>(name: string, options: LockOptions, callback: () => T | PromiseLike<T>): Promise<T>;
}

interface StorageEventLike {
  key: string | null;
}

interface StorageEventsLike {
  addEventListener(type: 'storage', listener: (event: StorageEventLike) => void): void;
  removeEventListener(type: 'storage', listener: (event: StorageEventLike) => void): void;
}

export type PendingPlanObservation =
  { status: 'ready'; record: PendingPlanOperation | null } | { status: 'blocked' };

interface PendingPlanObserverOptions {
  persistence?: PlanOpenPersistence;
  deadlineMs?: number;
}

type LocalStorageListener = (source: PlanOpenPersistence) => void;

const localStorageListeners = new WeakMap<StorageLike, Map<string, Set<LocalStorageListener>>>();

function emitLocalStorageChange(
  storage: StorageLike,
  key: string,
  source: PlanOpenPersistence,
): void {
  const listeners = localStorageListeners.get(storage)?.get(key);
  if (!listeners) return;
  for (const listener of [...listeners]) listener(source);
}

function watchLocalStorageChange(
  storage: StorageLike,
  key: string,
  listener: LocalStorageListener,
): () => void {
  let byKey = localStorageListeners.get(storage);
  if (!byKey) {
    byKey = new Map();
    localStorageListeners.set(storage, byKey);
  }
  let listeners = byKey.get(key);
  if (!listeners) {
    listeners = new Set();
    byKey.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) byKey?.delete(key);
    if (byKey?.size === 0) localStorageListeners.delete(storage);
  };
}

export interface PlanPersistenceEnvironment {
  storage?: StorageLike | null;
  locks?: LockManagerLike | null;
  events?: StorageEventsLike | null;
  randomUUID?: () => string;
  maxBytes?: number;
}

export interface PlanAdmission {
  created: boolean;
  record: PendingPlanOperation;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function defaultLocks(): LockManagerLike | null {
  try {
    return typeof navigator === 'undefined' || !navigator.locks ? null : navigator.locks;
  } catch {
    return null;
  }
}

function defaultEvents(): StorageEventsLike | null {
  try {
    return typeof window === 'undefined' ? null : window;
  } catch {
    return null;
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new PlanPersistenceError('owner_cancelled');
}

export class PlanOpenPersistence {
  readonly #environment: PlanPersistenceEnvironment;
  readonly #maxBytes: number;

  constructor(environment: PlanPersistenceEnvironment = {}) {
    this.#environment = environment;
    this.#maxBytes = environment.maxBytes ?? PLAN_OPERATION_MAX_BYTES;
  }

  storageKey(identity: PlanOperationIdentity): string {
    if (!isPlanOperationIdentity(identity)) throw new PlanPersistenceError('identity_invalid');
    return [
      STORAGE_PREFIX,
      encodeURIComponent(identity.actorId),
      encodeURIComponent(identity.orgId),
    ].join(':');
  }

  #lockName(identity: PlanOperationIdentity): string {
    return ['lock', this.storageKey(identity)].join(':');
  }

  #storage(): StorageLike {
    const storage =
      this.#environment.storage === undefined ? defaultStorage() : this.#environment.storage;
    if (!storage) throw new PlanPersistenceError('storage_unavailable');
    return storage;
  }

  #locks(): LockManagerLike {
    const locks = this.#environment.locks === undefined ? defaultLocks() : this.#environment.locks;
    if (!locks) throw new PlanPersistenceError('lock_unavailable');
    return locks;
  }

  #randomUUID(): string {
    const value = (this.#environment.randomUUID ?? (() => crypto.randomUUID()))();
    if (!PLAN_OPERATION_UUID_RE.test(value)) throw new PlanPersistenceError('record_invalid');
    return value;
  }

  #decode(raw: string, identity: PlanOperationIdentity): PendingPlanOperation {
    if (new TextEncoder().encode(raw).byteLength > this.#maxBytes) {
      throw new PlanPersistenceError('record_too_large');
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new PlanPersistenceError('record_invalid');
    }
    if (
      !isPendingPlanOperation(value) ||
      value.actorId !== identity.actorId ||
      value.orgId !== identity.orgId
    ) {
      throw new PlanPersistenceError('record_invalid');
    }
    return value;
  }

  #encode(record: PendingPlanOperation): string {
    const raw = serializePendingPlanOperation(record);
    if (new TextEncoder().encode(raw).byteLength > this.#maxBytes) {
      throw new PlanPersistenceError('record_too_large');
    }
    return raw;
  }

  #readRaw(storage: StorageLike, key: string): string | null {
    try {
      return storage.getItem(key);
    } catch {
      throw new PlanPersistenceError('storage_read');
    }
  }

  #writeRaw(storage: StorageLike, key: string, raw: string): void {
    try {
      storage.setItem(key, raw);
    } catch {
      throw new PlanPersistenceError('storage_write');
    }
    if (this.#readRaw(storage, key) !== raw) {
      throw new PlanPersistenceError('storage_readback');
    }
    emitLocalStorageChange(storage, key, this);
  }

  async #withLock<T>(
    identity: PlanOperationIdentity,
    signal: AbortSignal,
    callback: (storage: StorageLike, key: string) => T | Promise<T>,
  ): Promise<T> {
    throwIfCancelled(signal);
    const storage = this.#storage();
    const locks = this.#locks();
    const key = this.storageKey(identity);
    try {
      return await locks.request(
        this.#lockName(identity),
        { mode: 'exclusive', signal },
        async () => {
          throwIfCancelled(signal);
          return callback(storage, key);
        },
      );
    } catch (error) {
      if (error instanceof PlanPersistenceError) throw error;
      if (signal.aborted) throw new PlanPersistenceError('owner_cancelled');
      throw new PlanPersistenceError('lock_unavailable');
    }
  }

  async read(
    identity: PlanOperationIdentity,
    signal: AbortSignal,
  ): Promise<PendingPlanOperation | null> {
    return this.#withLock(identity, signal, (storage, key) => {
      const raw = this.#readRaw(storage, key);
      return raw === null ? null : this.#decode(raw, identity);
    });
  }

  async admit(
    identity: PlanOperationIdentity,
    intent: PlanOpenIntent,
    continuation: PlanOpenContinuation,
    signal: AbortSignal,
  ): Promise<PlanAdmission> {
    if (!isPlanOperationIdentity(identity)) throw new PlanPersistenceError('identity_invalid');
    const bounded: PendingPlanOperation = {
      version: PLAN_OPERATION_VERSION,
      actorId: identity.actorId,
      orgId: identity.orgId,
      operationId: UUID_PLACEHOLDER,
      stage: 'prepared',
      intent,
      planId: null,
      continuation,
    };
    this.#encode(bounded);
    return this.#withLock(identity, signal, (storage, key) => {
      const existing = this.#readRaw(storage, key);
      if (existing !== null) {
        return { created: false, record: this.#decode(existing, identity) };
      }
      throwIfCancelled(signal);
      const record = { ...bounded, operationId: this.#randomUUID() };
      this.#writeRaw(storage, key, this.#encode(record));
      return { created: true, record };
    });
  }

  async update(
    identity: PlanOperationIdentity,
    operationId: string,
    signal: AbortSignal,
    update: (record: PendingPlanOperation) => PendingPlanOperation,
  ): Promise<PendingPlanOperation> {
    return this.#withLock(identity, signal, (storage, key) => {
      const raw = this.#readRaw(storage, key);
      if (raw === null) throw new PlanPersistenceError('operation_replaced');
      const current = this.#decode(raw, identity);
      if (current.operationId !== operationId) {
        throw new PlanPersistenceError('operation_replaced');
      }
      const next = update(structuredClone(current));
      if (
        next.operationId !== current.operationId ||
        next.actorId !== current.actorId ||
        next.orgId !== current.orgId
      ) {
        throw new PlanPersistenceError('record_invalid');
      }
      this.#writeRaw(storage, key, this.#encode(next));
      return next;
    });
  }

  async clear(
    identity: PlanOperationIdentity,
    operationId: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    return this.#withLock(identity, signal, (storage, key) => {
      const raw = this.#readRaw(storage, key);
      if (raw === null) return true;
      const current = this.#decode(raw, identity);
      if (current.operationId !== operationId) return false;
      try {
        storage.removeItem(key);
      } catch {
        throw new PlanPersistenceError('storage_write');
      }
      if (this.#readRaw(storage, key) !== null) {
        throw new PlanPersistenceError('storage_readback');
      }
      emitLocalStorageChange(storage, key, this);
      return true;
    });
  }

  watch(
    identity: PlanOperationIdentity,
    callback: () => void,
    options: { includeOwn?: boolean } = {},
  ): () => void {
    const events =
      this.#environment.events === undefined ? defaultEvents() : this.#environment.events;
    const key = this.storageKey(identity);
    let unwatchLocal = () => {};
    try {
      unwatchLocal = watchLocalStorageChange(this.#storage(), key, (source) => {
        if (options.includeOwn || source !== this) callback();
      });
    } catch {
      // The bounded read reports the storage failure to the visible observer.
    }
    if (!events) return unwatchLocal;
    const listener = (event: StorageEventLike) => {
      if (event.key === key) callback();
    };
    events.addEventListener('storage', listener);
    return () => {
      unwatchLocal();
      events.removeEventListener('storage', listener);
    };
  }
}

/**
 * Observe the one actor/org slot without exposing an unlocked localStorage peek.
 * Every initial or storage-triggered read has its own bounded lock owner.
 */
export function observePendingPlanOperation(
  identity: PlanOperationIdentity,
  publish: (observation: PendingPlanObservation) => void,
  options: PendingPlanObserverOptions = {},
): () => void {
  const persistence = options.persistence ?? new PlanOpenPersistence();
  const deadlineMs = options.deadlineMs ?? 15_000;
  let disposed = false;
  let generation = 0;
  let active: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const refresh = () => {
    const token = ++generation;
    active?.abort(new DOMException('Pending plan observation superseded', 'AbortError'));
    if (timer !== null) clearTimeout(timer);
    const controller = new AbortController();
    active = controller;
    timer = setTimeout(
      () =>
        controller.abort(new DOMException('Pending plan observation timed out', 'TimeoutError')),
      deadlineMs,
    );
    void persistence
      .read(identity, controller.signal)
      .then((record) => {
        if (!disposed && token === generation && !controller.signal.aborted) {
          publish({ status: 'ready', record });
        }
      })
      .catch(() => {
        if (!disposed && token === generation) {
          publish({ status: 'blocked' });
        }
      })
      .finally(() => {
        if (token !== generation) return;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (active === controller) active = null;
      });
  };

  const unwatch = persistence.watch(identity, refresh, { includeOwn: true });
  refresh();
  return () => {
    if (disposed) return;
    disposed = true;
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    active?.abort(new DOMException('Pending plan observation disposed', 'AbortError'));
    active = null;
    unwatch();
  };
}
