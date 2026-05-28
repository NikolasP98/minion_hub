/**
 * Reusable async state helpers for Svelte 5 runes.
 *
 * These factories capture three patterns hand-rolled across the dashboard:
 *
 *  - `createAsyncResource` — the loading/error/data triad with the canonical
 *    `try { loading=true; error=null; … } catch { error=… } finally { loading=false }`.
 *  - `createAutoSave` — a single debounced auto-save timer with flush/cancel.
 *  - `createConnectedFetch` — the "fetch once per connection, reset on disconnect"
 *    fire-once guard used by gateway-backed pages.
 *
 * IMPORTANT — these helpers are ONLY for gateway/runtime data (skills, tools,
 * reliability metrics, editor saves). Do NOT use them to client-fetch
 * auth-derived data (`/api/me`, permissions, workspaces, …) from `$effect`/
 * `onMount`; that is a documented anti-pattern (see CLAUDE.md → "Auth-derived
 * data: canonical load flow"). Auth-derived data must flow through
 * `+layout.server.ts` / `+page.server.ts` loads.
 *
 * Factories that hold `$state` must be defined in a `.svelte.ts` module and
 * expose reactive values via getters (you cannot export a bare `$state`).
 */

// ── createAsyncResource ─────────────────────────────────────────────────────

/** Stringify a thrown value to `string`. Default form matches `String(e)`. */
export type ErrorFormatter = (e: unknown) => string;

/** Matches the `e instanceof Error ? e.message : String(e)` form used by several call sites. */
export const messageError: ErrorFormatter = (e) => (e instanceof Error ? e.message : String(e));

export interface AsyncResourceOptions {
  /** Initial `loading` value. Some call sites start `true` (eager panels), others `false`. Default `false`. */
  initialLoading?: boolean;
  /** How a caught error is turned into the stored string. Default `String(e)`. */
  formatError?: ErrorFormatter;
}

export interface AsyncResource<T, A extends unknown[] = []> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** Run the fetcher, managing loading/error/data with the canonical try/catch/finally. */
  load(...args: A): Promise<void>;
  /** Reset to the initial empty state (data=null, error=null, loading=initialLoading). */
  reset(): void;
}

/**
 * Wrap an async fetcher in the loading/error/data triad.
 *
 * ```ts
 * const skills = createAsyncResource(
 *   (agentId: string) => sendRequest('skills.status', { agentId }),
 * );
 * await skills.load('agent-1');
 * skills.data; // T | null
 * ```
 */
export function createAsyncResource<T, A extends unknown[] = []>(
  fetcher: (...args: A) => Promise<T>,
  options: AsyncResourceOptions = {},
): AsyncResource<T, A> {
  const initialLoading = options.initialLoading ?? false;
  const formatError = options.formatError ?? ((e: unknown) => String(e));

  let data = $state<T | null>(null);
  let loading = $state<boolean>(initialLoading);
  let error = $state<string | null>(null);

  async function load(...args: A): Promise<void> {
    loading = true;
    error = null;
    try {
      data = await fetcher(...args);
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }

  function reset(): void {
    data = null;
    error = null;
    loading = initialLoading;
  }

  return {
    get data() {
      return data;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    load,
    reset,
  };
}

// ── createAutoSave ──────────────────────────────────────────────────────────

export interface AutoSave {
  /** (Re)start the debounce timer; the latest call wins. */
  schedule(): void;
  /** Cancel any pending timer and invoke `save()` immediately. */
  flush(): void;
  /** Cancel any pending timer without saving. */
  cancel(): void;
}

/**
 * Debounced single-timer auto-save. Replicates the hand-rolled
 * `clearTimeout(saveTimer); saveTimer = setTimeout(save, delayMs)` idiom.
 *
 * Does NOT manage a `dirty`/`saving` flag — call sites keep owning that UI
 * state so behavior stays identical (e.g. set `dirty = true` before `schedule()`).
 */
export function createAutoSave(save: () => void | Promise<void>, delayMs: number): AutoSave {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(): void {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, delayMs);
  }

  function flush(): void {
    cancel();
    void save();
  }

  return { schedule, flush, cancel };
}

// ── createConnectedFetch ────────────────────────────────────────────────────

export interface ConnectedFetch {
  /**
   * Drive the fire-once guard from the current connection state. Call this
   * INSIDE an `$effect` whose body reads `isConnected()`:
   *
   * ```ts
   * const feed = createConnectedFetch(() => conn.connected, loadFeed);
   * $effect(() => feed.sync());
   * ```
   *
   * On the first `isConnected() === true` it runs `fetchOnce()`; once the
   * connection drops it re-arms so a reconnect fetches again.
   */
  sync(): void;
  /** Manually re-arm the guard (so the next connected `sync()` fetches again). */
  reset(): void;
}

/**
 * Encapsulates the "fetch once per connection, reset on disconnect" pattern:
 *
 * ```ts
 * let fetchedForConnection = false;
 * $effect(() => {
 *   if (conn.connected && !fetchedForConnection) { fetchedForConnection = true; loadFeed(); }
 *   if (!conn.connected) fetchedForConnection = false;
 * });
 * ```
 */
export function createConnectedFetch(
  isConnected: () => boolean,
  fetchOnce: () => void,
): ConnectedFetch {
  let fetched = false;

  function sync(): void {
    const connected = isConnected();
    if (connected && !fetched) {
      fetched = true;
      fetchOnce();
    }
    if (!connected) {
      fetched = false;
    }
  }

  function reset(): void {
    fetched = false;
  }

  return { sync, reset };
}
