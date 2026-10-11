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
 *   new server value on success, old one on failure = a visible rollback);
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
 * that must not lose typing on a failed write pass `keepDraftOnError: true`
 * and surface `SaveIndicator`'s Retry.
 */
import { onDestroy } from 'svelte';
import { createSaveStatus, type SaveStatus, type SaveState } from './save-status.svelte';
import { tryUseActions } from '$lib/services/actions/context';
import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';

export interface AutosaveOptions<V> {
  /** Committed value as a getter, so refreshed load data flows through. */
  committed: () => V;
  save: (value: V) => Promise<void>;
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

  let draft = $state<{ value: V } | null>(null);
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
    const c = committed();
    return base && equals(c, base.from) ? base.value : c;
  }

  function commit(value: V): () => Promise<void> {
    return async () => {
      const from = committed();
      await save(value);
      base = { value, from };
      if (draft && equals(draft.value, value)) draft = null;
    };
  }

  async function flush(): Promise<void> {
    clearTimers();
    if (inFlight || !draft) return;
    const value = draft.value;
    if (equals(value, current())) {
      draft = null;
      return;
    }
    inFlight = true;
    const write = commit(value);
    try {
      // Registered as a confirmed command so the global activity indicator
      // shows it; the field owns the failure UI, so a failed record is
      // dismissed from the attention list immediately.
      if (actions) {
        let actionId: number | undefined;
        const outcome = await actions.runCommand('autosave', async (ctx) => {
          actionId = ctx.actionId;
          try {
            await ctx.attempt('save', () => status.run(write));
            ctx.acknowledge();
            return { status: 'succeeded', value: undefined };
          } catch (error) {
            return { status: 'failed', error };
          }
        });
        if (outcome.status !== 'succeeded') {
          if (actionId !== undefined) actions.dismiss(actionId);
          throw ('error' in outcome && outcome.error) || new Error('autosave failed');
        }
      } else {
        await status.run(write);
      }
    } catch {
      // Rollback = the committed value takes back over (visible revert),
      // unless the caller asked to keep the draft for Retry. Newer typing is
      // never discarded (spec §3.2).
      if (!keepDraftOnError && draft && equals(draft.value, value)) draft = null;
    } finally {
      inFlight = false;
    }
    // Edits made while the write was in flight go out next.
    if (draft && !equals(draft.value, value)) void flush();
  }

  function set(value: V) {
    draft = { value };
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
