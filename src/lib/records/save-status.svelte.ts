/** One serialized, scope-aware save indicator per editing context. */
import { tryUseActions } from '$lib/services/actions/context';
import { ApiError } from '$lib/api/fetch-json';
import { MutationRejected } from '$lib/services/actions/mutations';

export type SaveState =
  'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'unknown' | 'committed-refreshing';
export class SaveOutcomeError extends Error {
  constructor(
    readonly outcome: 'error' | 'conflict' | 'unknown' | 'committed-refreshing',
    message: string,
    readonly recover?: () => Promise<void>,
  ) {
    super(message);
    this.name = 'SaveOutcomeError';
  }
}
export function saveFailure(error: unknown): SaveOutcomeError {
  if (error instanceof SaveOutcomeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ApiError || error instanceof MutationRejected) {
    if (error.status === 409) return new SaveOutcomeError('conflict', message);
    if (error.status >= 400 && error.status < 500) return new SaveOutcomeError('error', message);
  }
  // A lost response or server error does not prove that the write was rejected.
  return new SaveOutcomeError('unknown', message);
}

/** Keep acknowledgement separate from projection repair; recovery never calls write. */
export async function saveAndRefresh<T>(
  write: () => Promise<T>,
  refresh: () => Promise<void>,
  isCurrent: () => boolean = () => true,
): Promise<T> {
  const result = await write();
  if (!isCurrent()) throw new SaveOutcomeError('unknown', 'Editing context changed');
  const repair = async () => {
    if (!isCurrent()) throw new SaveOutcomeError('unknown', 'Editing context changed');
    await refresh();
  };
  try {
    await repair();
  } catch (cause) {
    throw new SaveOutcomeError(
      'committed-refreshing',
      cause instanceof Error ? cause.message : String(cause),
      repair,
    );
  }
  return result;
}

export interface SaveRunOptions {
  isCurrent?: () => boolean;
}
export interface SaveStatus {
  readonly status: SaveState;
  readonly message?: string;
  readonly canRetry: boolean;
  run<T>(fn: () => Promise<T>, options?: SaveRunOptions): Promise<T>;
  retry(): Promise<void>;
  /** Retire callbacks owned by the previous record/identity. */
  reset(): void;
}

export function createSaveStatus(): SaveStatus {
  let actions: ReturnType<typeof tryUseActions>;
  try {
    actions = tryUseActions();
  } catch {
    actions = undefined;
  }
  let statusScope = actions?.scopeVersion;
  let status = $state<SaveState>('idle');
  let message = $state<string>();
  let recovery: (() => Promise<void>) | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let epoch = 0;
  let revision = 0;
  let failedRevision = -1;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  function reset() {
    epoch++;
    revision++;
    failedRevision = -1;
    clearTimeout(resetTimer);
    recovery = undefined;
    status = 'idle';
    message = undefined;
  }
  async function run<T>(fn: () => Promise<T>, options: SaveRunOptions = {}): Promise<T> {
    const scope = actions?.scopeVersion;
    if (statusScope !== scope) {
      reset();
      statusScope = scope;
    }
    const owner = epoch;
    const ownRevision = ++revision;
    const previousFailure = failedRevision;
    const current = () =>
      owner === epoch && scope === actions?.scopeVersion && (options.isCurrent?.() ?? true);
    clearTimeout(resetTimer);
    recovery = undefined;
    status = 'saving';
    message = undefined;
    const prev = chain;
    let release!: () => void;
    chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await prev;
      if (!current()) throw new SaveOutcomeError('unknown', 'Editing context changed');
      if (failedRevision !== previousFailure)
        throw new SaveOutcomeError(
          // A predecessor may have set the shared status while this run awaited.
          (status as SaveState) === 'conflict' ? 'conflict' : 'unknown',
          'Queued edit requires review',
        );
      const result = await fn();
      if (!current()) throw new SaveOutcomeError('unknown', 'Editing context changed');
      if (current() && ownRevision === revision) {
        status = 'saved';
        resetTimer = setTimeout(() => {
          if (current() && ownRevision === revision) status = 'idle';
        }, 1500);
      }
      return result;
    } catch (cause) {
      const failure = saveFailure(cause);
      if (current()) {
        failedRevision = ownRevision;
        status = failure.outcome;
        message = failure.message;
        // Only confirmed rejection can repeat a write. Conflict needs a new user edit.
        recovery =
          failure.outcome === 'error'
            ? () => run(fn, options).then(() => undefined)
            : failure.outcome === 'committed-refreshing' && failure.recover
              ? async () => {
                  if (!current() || ownRevision !== revision) return;
                  await failure.recover!();
                  if (current() && ownRevision === revision) {
                    status = 'saved';
                    message = undefined;
                    recovery = undefined;
                  }
                }
              : undefined;
      }
      throw failure;
    } finally {
      release();
    }
  }
  return {
    get status() {
      return statusScope === actions?.scopeVersion ? status : 'idle';
    },
    get message() {
      return statusScope === actions?.scopeVersion ? message : undefined;
    },
    get canRetry() {
      return statusScope === actions?.scopeVersion && recovery !== undefined;
    },
    run,
    reset,
    async retry() {
      if (statusScope !== actions?.scopeVersion) {
        reset();
        return;
      }
      const repair = recovery;
      if (!repair) return;
      const previous = status;
      const retryRevision = revision;
      recovery = undefined;
      try {
        await repair();
      } catch (cause) {
        if (
          retryRevision === revision &&
          previous === 'committed-refreshing' &&
          status === 'committed-refreshing'
        ) {
          message = cause instanceof Error ? cause.message : String(cause);
          recovery = repair;
        }
      }
    },
  };
}
