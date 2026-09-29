/**
 * Autosave status for a record editor's title-bar indicator (owner directive:
 * "Visual feedback ... is the KEY to success in building trust"). One instance
 * per open record — `SellableEditorPage` gets it via `peekSaveStatus() ??
 * createSaveStatus()` (see peek.svelte.ts) and hands `.run` to the field
 * autosave callbacks.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveStatus {
  readonly status: SaveState;
  readonly message?: string;
  /** Runs `fn`, serialized after any save already in flight for this record
   *  (ponytail: a promise chain — one global lock per record, per-field locks
   *  if concurrent unrelated fields ever need to overlap). Updates `status`
   *  around the call and remembers `fn` for `retry()`. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Re-runs the last `fn` passed to `run`, only while `status === 'error'`. */
  retry(): Promise<void>;
}

const SAVED_RESET_MS = 1500; // ~--duration-slow scale; see ui-design-governance

export function createSaveStatus(): SaveStatus {
  let status = $state<SaveState>('idle');
  let message = $state<string | undefined>(undefined);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFn: (() => Promise<unknown>) | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  function clearResetTimer() {
    if (resetTimer !== undefined) {
      clearTimeout(resetTimer);
      resetTimer = undefined;
    }
  }

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    lastFn = fn;
    // Set synchronously (before the await below) so the indicator flips to
    // "saving" the instant the caller triggers a save, not a microtask later.
    clearResetTimer();
    status = 'saving';
    message = undefined;
    const prev = chain;
    let release: (() => void) | undefined;
    chain = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    try {
      await prev; // serialize: wait for any save already in flight
      const result = await fn();
      status = 'saved';
      resetTimer = setTimeout(() => {
        status = 'idle';
      }, SAVED_RESET_MS);
      return result;
    } catch (err) {
      status = 'error';
      message = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      release?.();
    }
  }

  function retry(): Promise<void> {
    if (status !== 'error' || !lastFn) return Promise.resolve();
    return run(lastFn).then(
      () => undefined,
      () => undefined,
    );
  }

  return {
    get status() {
      return status;
    },
    get message() {
      return message;
    },
    run,
    retry,
  };
}
