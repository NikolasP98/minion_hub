/**
 * Field-level autosave — THE primitive for "no Save button" edits (owner
 * 2026-10-10: Save/confirm buttons only for destructive or important
 * decisions; everything else saves asynchronously with visual feedback and a
 * fallback when the write fails). Policy O in
 * specs/2026-09-21-hub-optimistic-interactions-motion-spec.md §2 / §3.4.
 *
 * It composes the three pieces the hub already had, so nothing is re-invented:
 * - the value shows the user's intent on the next paint (`createOptimistic`'s
 *   overlay contract: committed value takes back over once the write settles —
 *   new server value on success; unknown/conflict keep the draft for review);
 * - the write is debounced (500 ms idle / 2 s max — spec scheduling constants)
 *   and serialized through a `SaveStatus` (one per record → one
 *   `SaveIndicator`; pass `status` to share it, omit it for a per-field one);
 * - the write registers with the action runtime so the global sidebar
 *   spinner reflects it (`SidebarUtilities`) — never a local spinner.
 *
 * ```svelte
 * const name = createAutosave({
 *   committed: () => data.item.name,
 *   save: (v) => patchJson(`/api/items/${data.item.id}`, { name: v }),
 *   status: saveStatus,
 * });
 * <Input bind:value={name.value} onblur={name.flush} />
 * ```
 * Toggles/selects pass `debounceMs: 0` (commit on each change). Text fields
 * that must retain typing after a confirmed rejection pass `keepDraftOnError: true`.
 * Retry repeats only confirmed rejected writes or repairs an acknowledged refresh.
 */
import { onDestroy } from 'svelte';
import {
  createSaveStatus,
  saveFailure,
  SaveOutcomeError,
  type SaveStatus,
  type SaveState,
} from './save-status.svelte';
import { tryUseActions } from '$lib/services/actions/context';
import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';

export interface AutosaveOptions<V> {
  /** Committed value as a getter, so refreshed load data flows through. */
  committed: () => V;
  save?: (value: V) => Promise<void>;
  /** Capture record/version now, before the debounce or shared queue. */
  prepare?: (value: V, isCurrent: () => boolean) => () => Promise<void>;
  /** Record identity; the action runtime additionally fences actor/org changes. */
  scope?: () => string | undefined;
  /** Shared per-record status (spec §3.5: one live region per editing context). */
  status?: SaveStatus;
  /** Idle debounce before committing; `0` commits on every `set` (toggles). */
  debounceMs?: number;
  /** Upper bound while the user keeps typing. */
  maxWaitMs?: number;
  /** Keep the typed draft on failure (with Retry) instead of rolling back. */
  keepDraftOnError?: boolean;
  equals?: (a: V, b: V) => boolean;
  /** Test seam; defaults to the runtime from component context, if any. */
  actions?: ActionRuntime;
}

export interface Autosave<V> {
  /** Read: intent while editing/saving, else committed. Write: schedules a save. */
  value: V;
  /** A save is scheduled or in flight. */
  readonly pending: boolean;
  readonly status: SaveState;
  readonly message: string | undefined;
  set(value: V): void;
  /** Commit now (blur / Enter / unmount). Resolves after the write settles. */
  flush(): Promise<void>;
  /** Drop the scheduled draft (Escape before dispatch). */
  cancel(): void;
  retry(): Promise<void>;
}

const DEBOUNCE_MS = 500;
const MAX_WAIT_MS = 2000;

function inComponent<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined; // outside component init (tests, module scope)
  }
}

export function createAutosave<V>(opts: AutosaveOptions<V>): Autosave<V> {
  const {
    committed,
    save,
    debounceMs = DEBOUNCE_MS,
    maxWaitMs = MAX_WAIT_MS,
    keepDraftOnError = false,
    equals = Object.is,
  } = opts;
  const status = opts.status ?? createSaveStatus();
  const actions = opts.actions ?? inComponent(tryUseActions);

  const scopeKey = () => JSON.stringify([opts.scope?.(), actions?.scopeVersion]);
  let owner = scopeKey();
  let draft = $state<{
    value: V;
    write: () => Promise<void>;
    owner: string;
    attempted: boolean;
  } | null>(null);
  function isCurrent(captured: string) {
    if (owner !== scopeKey()) {
      owner = scopeKey();
      clearTimers();
      draft = null;
      base = null;
      status.reset();
    }
    return captured === owner;
  }
  // Last acknowledged write, kept until `committed()` moves off the value it
  // had at save time — covers `save` callbacks that don't `invalidate()`.
  let base = $state<{ value: V; from: V } | null>(null);
  let inFlight = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers() {
    clearTimeout(timer);
    clearTimeout(maxTimer);
    timer = maxTimer = undefined;
  }
  function current(): V {
    isCurrent(owner);
    const c = committed();
    return base && equals(c, base.from) ? base.value : c;
  }

  function commit(entry: NonNullable<typeof draft>): () => Promise<void> {
    return async () => {
      if (!isCurrent(entry.owner)) throw new SaveOutcomeError('unknown', 'Editing context changed');
      const from = committed();
      try {
        await entry.write();
      } catch (cause) {
        if (saveFailure(cause).outcome === 'committed-refreshing' && isCurrent(entry.owner)) {
          base = { value: entry.value, from };
          if (draft === entry) draft = null;
        }
        throw cause;
      }
      if (!isCurrent(entry.owner)) return;
      base = { value: entry.value, from };
      if (draft === entry) draft = null;
    };
  }

  async function flush(): Promise<void> {
    clearTimers();
    isCurrent(owner);
    if (inFlight || !draft || draft.attempted) return;
    const entry = draft;
    const value = entry.value;
    if (equals(value, current())) {
      draft = null;
      return;
    }
    inFlight = true;
    entry.attempted = true;
    const write = commit(entry);
    let succeeded = false;
    const runOptions = { isCurrent: () => isCurrent(entry.owner) };
    try {
      // Registered as an OPTIMISTIC command so the global activity indicator
      // shows it while the field owns the failure UI (no attention badge).
      if (actions) {
        const outcome = await actions.runCommand(
          'autosave',
          async (ctx) => {
            try {
              await ctx.attempt('save', () => status.run(write, runOptions));
              ctx.acknowledge();
              return { status: 'succeeded', value: undefined };
            } catch (error) {
              const failure = saveFailure(error);
              return {
                status: failure.outcome === 'error' ? 'failed' : failure.outcome,
                error: failure,
              };
            }
          },
          { policy: 'optimistic' },
        );
        if (outcome.status !== 'succeeded')
          throw ('error' in outcome && outcome.error) || new Error('autosave failed');
      } else {
        await status.run(write, runOptions);
      }
      succeeded = true;
    } catch {
      // Rollback = the committed value takes back over (visible revert),
      // unless the caller asked to keep the draft for Retry. Newer typing is
      // never discarded (spec §3.2).
      if (status.status === 'error' && !keepDraftOnError && draft === entry) draft = null;
    } finally {
      inFlight = false;
    }
    // A retired completion must not mark the new owner's draft as attempted.
    if (!isCurrent(entry.owner)) {
      if (draft && !draft.attempted) void flush();
      return;
    }
    // Edits made while the write was in flight go out next.
    if (succeeded && draft && draft !== entry && isCurrent(entry.owner)) void flush();
    else if (!succeeded) {
      clearTimers();
      if (draft) draft.attempted = true; // pending edits require a fresh user decision too
    }
  }

  function set(value: V) {
    isCurrent(owner);
    if (draft && equals(draft.value, value)) return;
    const captured = owner;
    const check = () => isCurrent(captured);
    let write: () => Promise<void>;
    try {
      write =
        opts.prepare?.(value, check) ??
        (() => {
          if (!save) throw new SaveOutcomeError('error', 'Autosave requires a writer');
          return save(value);
        });
    } catch (cause) {
      write = async () => {
        throw cause;
      };
    }
    draft = { value, owner: captured, write, attempted: false };
    if (debounceMs === 0) {
      void flush();
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), debounceMs);
    if (maxTimer === undefined) maxTimer = setTimeout(() => void flush(), maxWaitMs);
  }

  // Spec §3.4: never drop a draft because the editor unmounted.
  inComponent(() => onDestroy(() => void flush()));

  return {
    get value() {
      isCurrent(owner);
      return draft ? draft.value : current();
    },
    set value(v: V) {
      set(v);
    },
    get pending() {
      return inFlight || timer !== undefined;
    },
    get status() {
      return status.status;
    },
    get message() {
      return status.message;
    },
    set,
    flush,
    cancel() {
      clearTimers();
      draft = null;
    },
    retry: () => status.retry(),
  };
}
