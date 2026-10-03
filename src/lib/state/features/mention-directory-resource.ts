import {
  DirectoryReadError,
  EMPTY_DIRECTORY,
  readMentionDirectory,
  type DirectoryFailure,
  type DirectoryOwner,
} from './mention-directory-wire';

const TTL_MS = 5 * 60_000;
const COOLDOWN_MS = 30_000;
const DEADLINE_MS = 10_000;

interface DirectoryDependencies {
  fetch: (signal: AbortSignal) => Promise<Response>;
  currentOwner: () => DirectoryOwner | null;
  changed: () => void;
  report: (reason: DirectoryFailure) => void;
  now?: () => number;
  /** Identity-free throttles may outlive a mounted cache, never its data or owner. */
  failureWindow?: { retryAt: number; lastReported: number };
}

const key = (owner: DirectoryOwner | null) =>
  owner ? `${owner.actorId}:${owner.organizationId}` : '';

/** A single observation slot. Retirement settles even when transport ignores abort. */
export function createMentionDirectory(deps: DirectoryDependencies) {
  const now = deps.now ?? (() => performance.now());
  let ownerKey = '';
  let generation = 0;
  let disposed = false;
  let data = EMPTY_DIRECTORY;
  let expiresAt = 0;
  const failureWindow = deps.failureWindow ?? { retryAt: 0, lastReported: -Infinity };
  let pending: { promise: Promise<ReadonlyMap<string, string>>; stop: () => void } | null = null;

  function changed() {
    try {
      deps.changed();
    } catch {
      /* An observer cannot turn a read into a rejection. */
    }
  }

  function retire() {
    generation++;
    const previous = pending;
    pending = null;
    data = EMPTY_DIRECTORY;
    expiresAt = 0;
    previous?.stop();
    changed();
  }

  function read(owner: DirectoryOwner | null): ReadonlyMap<string, string> {
    return !disposed && key(owner) === ownerKey && ownerKey !== '' && now() < expiresAt
      ? data
      : EMPTY_DIRECTORY;
  }

  function ensure(owner: DirectoryOwner | null): Promise<ReadonlyMap<string, string>> {
    if (disposed) return Promise.resolve(EMPTY_DIRECTORY);
    const nextKey = key(owner);
    if (nextKey !== ownerKey) {
      ownerKey = nextKey;
      retire();
    }
    if (!owner) return Promise.resolve(EMPTY_DIRECTORY);
    if (pending) return pending.promise;
    if (now() < expiresAt) return Promise.resolve(data);
    if (now() < failureWindow.retryAt) return Promise.resolve(EMPTY_DIRECTORY);
    const captured = generation;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let cancelObservation!: () => void;
    const cancelled = new Promise<ReadonlyMap<string, string>>((resolve) => {
      cancelObservation = () => {
        controller.abort();
        resolve(EMPTY_DIRECTORY);
      };
    });
    const current = () =>
      !disposed &&
      captured === generation &&
      ownerKey === nextKey &&
      key(deps.currentOwner()) === nextKey;
    const request = {
      promise: Promise.resolve(EMPTY_DIRECTORY),
      stop: () => {
        clearTimeout(timer);
        cancelObservation();
      },
    };
    pending = request;
    const deadline = new Promise<ReadonlyMap<string, string>>((_, reject) => {
      timer = setTimeout(() => {
        reject(new DirectoryReadError('timeout'));
        controller.abort();
      }, DEADLINE_MS);
    });
    const work = Promise.resolve().then(async () => {
      if (!current()) return EMPTY_DIRECTORY;
      return readMentionDirectory(await deps.fetch(controller.signal), owner, controller.signal);
    });
    request.promise = Promise.race([work, deadline, cancelled])
      .then((value) => {
        if (!current() || controller.signal.aborted) return EMPTY_DIRECTORY;
        data = value;
        expiresAt = now() + TTL_MS;
        failureWindow.retryAt = 0;
        changed();
        return data;
      })
      .catch((error: unknown) => {
        if (!current()) return EMPTY_DIRECTORY;
        data = EMPTY_DIRECTORY;
        expiresAt = 0;
        failureWindow.retryAt = now() + COOLDOWN_MS;
        changed();
        if (now() - failureWindow.lastReported >= 60_000) {
          failureWindow.lastReported = now();
          try {
            deps.report(error instanceof DirectoryReadError ? error.reason : 'unavailable');
          } catch {
            /* Fixed-category telemetry never affects the resource outcome. */
          }
        }
        return EMPTY_DIRECTORY;
      })
      .finally(() => {
        clearTimeout(timer);
        if (pending === request) pending = null;
      });
    return request.promise;
  }

  return {
    read,
    ensure,
    invalidate() {
      if (!disposed) {
        failureWindow.retryAt = 0;
        retire();
      }
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        retire();
        ownerKey = '';
      }
    },
  };
}
