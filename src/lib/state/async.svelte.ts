/**
 * Reusable async state helpers for Svelte 5 runes.
 *
 * These factories capture three patterns hand-rolled across the dashboard:
 *
 *  - `createAsyncResource` — the loading/error/data triad with the canonical
 *    `try { loading=true; error=null; … } catch { error=… } finally { loading=false }`.
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

export interface AsyncResourceOwner {
  /** Stable for one actor/org/query authority epoch. */
  readonly token: symbol;
  /** Re-check canonical authority at every publication and getter. */
  readonly current: () => boolean;
}

export type AsyncResourceStatus =
  'idle' | 'loading' | 'ready' | 'failed' | 'unsupported' | 'unavailable';

export interface AsyncResourceOptions<T = unknown, A extends unknown[] = []> {
  /** Initial `loading` value. Some call sites start `true` (eager panels), others `false`. Default `false`. */
  initialLoading?: boolean;
  /** How a caught error is turned into the stored string. Default `String(e)`. */
  formatError?: ErrorFormatter;
  /** Fixed fallback when an error formatter itself throws. */
  fallbackError?: string;
  /** Optional immutable owner captured synchronously before the fetch starts. */
  owner?: (...args: A) => AsyncResourceOwner | null;
  /** Query identity. A changed key clears old data before replacement effects run. */
  key?: (...args: A) => string;
  /** Optional capability/admission check for the captured owner. */
  admit?: (owner: AsyncResourceOwner, ...args: A) => 'unsupported' | 'unavailable' | null;
  /** Synchronous cleanup that runs only for an admitted current value, before publication. */
  beforePublish?: (value: T, owner: AsyncResourceOwner | null, ...args: A) => void;
}

export interface AsyncResource<T, A extends unknown[] = []> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly status: AsyncResourceStatus;
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
  options: AsyncResourceOptions<T, A> = {},
): AsyncResource<T, A> {
  const initialLoading = options.initialLoading ?? false;
  const formatError = options.formatError ?? ((e: unknown) => String(e));
  const fallbackError = options.fallbackError ?? 'Unable to load this data.';

  let data = $state<T | null>(null);
  let loading = $state<boolean>(initialLoading);
  let error = $state<string | null>(null);
  let status = $state<AsyncResourceStatus>(initialLoading ? 'loading' : 'idle');
  let owner = $state.raw<AsyncResourceOwner | null>(null);
  let ownerToken: symbol | null = null;
  let ownerAttempted = false;
  let queryKey = '';
  let generation = 0;

  function isCurrent(requestGeneration: number, capturedOwner: AsyncResourceOwner | null): boolean {
    return (
      generation === requestGeneration &&
      (!options.owner ||
        (capturedOwner !== null && ownerToken === capturedOwner.token && capturedOwner.current()))
    );
  }

  function hasVisibleOwner(): boolean {
    return !options.owner || !ownerAttempted || (owner !== null && owner.current());
  }

  function safeFormatError(caught: unknown): string {
    try {
      return formatError(caught);
    } catch {
      return fallbackError;
    }
  }

  async function load(...args: A): Promise<void> {
    const capturedOwner = options.owner?.(...args) ?? null;
    const nextKey = options.key?.(...args) ?? '';
    const changed =
      queryKey !== nextKey || (options.owner !== undefined && ownerToken !== capturedOwner?.token);
    const requestGeneration = ++generation;
    if (changed) data = null;
    queryKey = nextKey;
    owner = capturedOwner;
    ownerToken = capturedOwner?.token ?? null;
    ownerAttempted = true;
    error = null;

    if (options.owner && (!capturedOwner || !capturedOwner.current())) {
      loading = false;
      status = 'unavailable';
      return;
    }
    if (capturedOwner && options.admit) {
      const rejected = options.admit(capturedOwner, ...args);
      if (rejected) {
        data = null;
        loading = false;
        status = rejected;
        return;
      }
    }

    loading = true;
    status = 'loading';
    try {
      const next = await fetcher(...args);
      if (!isCurrent(requestGeneration, capturedOwner)) return;
      options.beforePublish?.(next, capturedOwner, ...args);
      if (!isCurrent(requestGeneration, capturedOwner)) return;
      data = next;
      status = 'ready';
    } catch (caught) {
      if (!isCurrent(requestGeneration, capturedOwner)) return;
      error = safeFormatError(caught);
      status = 'failed';
    } finally {
      if (isCurrent(requestGeneration, capturedOwner)) loading = false;
    }
  }

  function reset(): void {
    generation++;
    data = null;
    error = null;
    loading = initialLoading;
    status = initialLoading ? 'loading' : 'idle';
    owner = null;
    ownerToken = null;
    ownerAttempted = false;
    queryKey = '';
  }

  return {
    get data() {
      return hasVisibleOwner() ? data : null;
    },
    get loading() {
      return hasVisibleOwner() ? loading : false;
    },
    get error() {
      return hasVisibleOwner() ? error : null;
    },
    get status() {
      return hasVisibleOwner() ? status : 'unavailable';
    },
    load,
    reset,
  };
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
