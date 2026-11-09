import {
  INITIAL_SIMULATION_GENERATION,
  SIMULATION_GENERATION_HEADER,
  type RoleSimulationState,
} from '$lib/role-simulation';
import { retireRecordPeeks } from '$lib/records/peek-authority';
import type { ActionRuntime } from './actions/runtime.svelte';

const ENDPOINT = '/api/me/role-simulation';
const CHANNEL = 'minion:role-simulation';
const FORM_FIELD = '_roleSimulationGeneration';
const QUIET_MS = 500;
const DRAIN_LIMIT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const BODY_READERS = new Set(['json', 'text', 'arrayBuffer', 'blob', 'formData', 'bytes']);

type ClientErrorCode =
  'dirty' | 'pending' | 'attention' | 'busy' | 'stale' | 'rejected' | 'unknown' | 'unavailable';
export class RoleSimulationClientError extends Error {
  constructor(readonly code: ClientErrorCode) {
    super(code);
    this.name = 'RoleSimulationClientError';
  }
}
export interface SimulationClientOptions {
  readState: () => RoleSimulationState;
  readOwner: () => string;
  /** Retire socket/query state before the transition, after pending/dirty admission. */
  onBeforeTransition?: () => void;
  onRejected?: () => void;
  /** Called before replacing the document, so old privileged content can be hidden. */
  onRetire?: () => void;
  navigate?: (location: string) => void;
}
type PendingAuthorityActions = Pick<
  ActionRuntime,
  'foregroundPending' | 'backgroundPending' | 'backgroundJobs' | 'attentionRequired'
>;

export interface AuthorityChangeController {
  /** One admitted mutation while ordinary browser writes are frozen. */
  fetch: typeof fetch;
  isCurrent(): boolean;
  /** Returns false if this controller no longer owns the displayed actor/org. */
  commit(location: string): boolean;
  cancel(): void;
  unknown(location?: string): boolean;
  /** Repeats only the recorded document GET, never the admitted mutation. */
  retryNavigation(): boolean;
}

interface TransitionInput {
  state: RoleSimulationState;
  roleKey?: string;
  returnTo: string;
  actions?: PendingAuthorityActions;
}
interface Client {
  transition(input: TransitionInput): Promise<void>;
  prepareAuthorityChange(actions?: PendingAuthorityActions): Promise<AuthorityChangeController>;
  retryNavigation(): boolean;
  retireDocument(): boolean;
  dispose(): void;
}
let installed: Client | undefined;

function staleRead(): never {
  throw new DOMException('Authority changed before this read completed.', 'AbortError');
}
type RegisterReadRetirement = (cancel: () => void) => () => void;

function staleReadError(): DOMException {
  return new DOMException('Authority changed before this read completed.', 'AbortError');
}

/** Keep stream readers under the same fence as json/text body consumers. */
function guardedBody(
  body: ReadableStream<Uint8Array>,
  isCurrent: () => boolean,
  registerRetirement: RegisterReadRetirement,
): ReadableStream<Uint8Array> {
  const guarded: ReadableStream<Uint8Array> = new Proxy(body, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property === 'getReader') {
        return (...args: unknown[]) => {
          if (!isCurrent()) staleRead();
          const reader = Reflect.apply(value, target, args) as
            ReadableStreamDefaultReader<Uint8Array> | ReadableStreamBYOBReader;
          let live = true;
          let unregister = () => {};
          const cancel = () => {
            if (!live) return;
            live = false;
            unregister();
            try {
              void reader.cancel(staleReadError()).catch(() => {});
            } catch {
              /* Already released. */
            }
          };
          unregister = registerRetirement(cancel);
          return new Proxy(reader, {
            get(source, key) {
              const method: unknown = Reflect.get(source, key, source);
              if (typeof method !== 'function') return method;
              if (key === 'read')
                return async (...readArgs: unknown[]) => {
                  if (!isCurrent()) {
                    cancel();
                    staleRead();
                  }
                  let result: unknown;
                  try {
                    result = await Reflect.apply(method, source, readArgs);
                  } catch (error) {
                    if (!isCurrent()) {
                      cancel();
                      staleRead();
                    }
                    throw error;
                  }
                  if (!isCurrent()) {
                    cancel();
                    staleRead();
                  }
                  if (
                    result &&
                    typeof result === 'object' &&
                    'done' in result &&
                    result.done === true
                  ) {
                    live = false;
                    unregister();
                  }
                  return result;
                };
              if (key === 'cancel' || key === 'releaseLock')
                return (...releaseArgs: unknown[]) => {
                  live = false;
                  unregister();
                  return Reflect.apply(method, source, releaseArgs);
                };
              return method.bind(source);
            },
          });
        };
      }
      if (property === 'pipeThrough')
        return (...args: unknown[]) => {
          if (!isCurrent()) staleRead();
          return guardedBody(
            Reflect.apply(value, target, args) as ReadableStream<Uint8Array>,
            isCurrent,
            registerRetirement,
          );
        };
      if (property === 'tee')
        return (...args: unknown[]) => {
          if (!isCurrent()) staleRead();
          return (Reflect.apply(value, target, args) as ReadableStream<Uint8Array>[]).map(
            (branch) => guardedBody(branch, isCurrent, registerRetirement),
          );
        };
      if (property === 'values' || property === Symbol.asyncIterator)
        return (options?: { preventCancel?: boolean }): AsyncIterableIterator<Uint8Array> => {
          // Use the guarded reader rather than the native iterator's internal
          // reader, so retirement can cancel a next() that is still pending.
          const reader = guarded.getReader();
          let finished = false;
          const release = async (cancel: boolean, reason?: unknown) => {
            if (finished) return;
            finished = true;
            try {
              if (cancel && !options?.preventCancel) await reader.cancel(reason);
            } finally {
              reader.releaseLock();
            }
          };
          const iterator: AsyncIterableIterator<Uint8Array> = {
            async next(): Promise<IteratorResult<Uint8Array>> {
              if (finished) return { done: true, value: undefined };
              try {
                const result = await reader.read();
                if (result.done) {
                  await release(false);
                  return { done: true, value: undefined };
                }
                return { done: false, value: result.value };
              } catch (error) {
                try {
                  await release(false);
                } catch {
                  /* Preserve the read result. */
                }
                throw error;
              }
            },
            async return() {
              await release(true);
              return { done: true, value: undefined };
            },
            async throw(reason?: unknown) {
              await release(true, reason);
              throw reason;
            },
            [Symbol.asyncIterator]() {
              return iterator;
            },
          };
          return iterator;
        };
      if (property === 'pipeTo')
        return async (destination: WritableStream<Uint8Array>, options?: StreamPipeOptions) => {
          if (!isCurrent()) staleRead();
          const controller = new AbortController();
          const forwardAbort = () => controller.abort(options?.signal?.reason);
          if (options?.signal?.aborted) forwardAbort();
          else options?.signal?.addEventListener('abort', forwardAbort, { once: true });
          const unregister = registerRetirement(() => controller.abort(staleReadError()));
          try {
            await Reflect.apply(value, target, [
              destination,
              { ...options, signal: controller.signal },
            ]);
            if (!isCurrent()) staleRead();
          } finally {
            unregister();
            options?.signal?.removeEventListener('abort', forwardAbort);
          }
        };
      return value.bind(target);
    },
  });
  return guarded;
}

function guardedResponse(
  response: Response,
  isCurrent: () => boolean,
  registerRetirement: RegisterReadRetirement,
): Response {
  let body: ReadableStream<Uint8Array> | null | undefined;
  return new Proxy(response, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property === 'body') {
        if (!isCurrent()) staleRead();
        if (body === undefined)
          body = target.body ? guardedBody(target.body, isCurrent, registerRetirement) : null;
        return body;
      }
      if (property === 'clone')
        return () => guardedResponse(target.clone(), isCurrent, registerRetirement);
      if (
        typeof property === 'string' &&
        BODY_READERS.has(property) &&
        typeof value === 'function'
      ) {
        return async (...args: unknown[]) => {
          if (!isCurrent()) staleRead();
          const result: unknown = await Reflect.apply(value, target, args);
          if (!isCurrent()) staleRead();
          return result;
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
function stateProjection(value: unknown): { generation: string } | null {
  if (!value || typeof value !== 'object') return null;
  const projection = value as Record<string, unknown>;
  return typeof projection.generation === 'string' && UUID.test(projection.generation)
    ? { generation: projection.generation }
    : null;
}
function modeProjection(
  value: unknown,
): Pick<RoleSimulationState, 'generation' | 'active' | 'invalid' | 'orgId' | 'roleKey'> | null {
  const state = stateProjection(value);
  if (!state) return null;
  const mode = value as Record<string, unknown>;
  if (
    typeof mode.active !== 'boolean' ||
    typeof mode.invalid !== 'boolean' ||
    (mode.orgId !== null && typeof mode.orgId !== 'string') ||
    (mode.roleKey !== null && typeof mode.roleKey !== 'string')
  )
    return null;
  return {
    ...state,
    active: mode.active,
    invalid: mode.invalid,
    orgId: mode.orgId as string | null,
    roleKey: mode.roleKey as string | null,
  };
}
function receipt(value: unknown, origin: string): { generation: string; location: string } | null {
  const projection = stateProjection(value);
  if (!projection) return null;
  const path = (value as Record<string, unknown>).location;
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.length > 4096
  )
    return null;
  const target = new URL(path, origin);
  if (target.origin !== origin) return null;
  return { ...projection, location: target.pathname + target.search + target.hash };
}

/** Installs exactly one owner-fenced transport for the authenticated app shell. */
export function installRoleSimulationClient(options: SimulationClientOptions): () => void {
  installed?.dispose();
  const originalFetch = window.fetch;
  const fetchOriginal: typeof fetch = (input, init) => originalFetch.call(window, input, init);
  const navigate = options.navigate ?? ((path: string) => window.location.assign(path));
  const origin = window.location.origin;
  const pendingWrites = new Set<Promise<Response>>();
  const readRetirements = new Set<() => void>();
  const registerReadRetirement: RegisterReadRetirement = (cancel) => {
    readRetirements.add(cancel);
    return () => {
      readRetirements.delete(cancel);
    };
  };
  const retireReads = () => {
    for (const cancel of [...readRetirements]) cancel();
    readRetirements.clear();
  };
  let paused = false;
  let unresolved = false;
  let transitioning = false;
  let retired = false;
  let disposed = false;
  let nativeWritePending = false;
  let lastWrite = Date.now();
  let checking: Promise<void> | undefined;
  let retirementLocation: string | undefined;
  let channel: BroadcastChannel | undefined;

  const owner = () => options.readOwner();
  const generation = () => options.readState().generation ?? INITIAL_SIMULATION_GENERATION;
  function retire(path = window.location.pathname + window.location.search + window.location.hash) {
    if (disposed || retired) return;
    retirementLocation = path;
    retired = true;
    paused = true;
    retireRecordPeeks();
    document.documentElement.setAttribute('data-authority-retiring', '');
    // Native modal inertness would otherwise make a recovery action outside
    // the concealed old shell unreachable after navigation is blocked.
    for (const dialog of document.querySelectorAll('dialog[open]')) {
      if (dialog instanceof HTMLDialogElement) dialog.close();
    }
    retireReads();
    try {
      options.onRetire?.();
    } catch {
      /* Replacing the old document remains mandatory. */
    }
    navigate(path);
  }
  function changed(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    if (
      message.owner === owner() &&
      typeof message.generation === 'string' &&
      UUID.test(message.generation) &&
      message.generation !== generation()
    )
      retire();
  }
  function announce(next: string, capturedOwner: string) {
    const value = { owner: capturedOwner, generation: next };
    try {
      channel?.postMessage(value);
    } catch {
      /* Focus revalidation is independent. */
    }
    try {
      window.localStorage.setItem(CHANNEL, JSON.stringify(value));
    } catch {
      /* Includes a throwing storage accessor. */
    }
  }
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => changed(event.data);
  } catch {
    /* Storage/focus paths remain available. */
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CHANNEL || !event.newValue) return;
    try {
      changed(JSON.parse(event.newValue) as unknown);
    } catch {
      /* Ignore unrelated/corrupt advisory data. */
    }
  };
  const revalidate = () => {
    if (disposed || retired || checking || transitioning) return;
    const capturedOwner = owner();
    const capturedGeneration = generation();
    checking = (async () => {
      try {
        const response = await fetchOriginal(ENDPOINT, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (disposed || owner() !== capturedOwner || generation() !== capturedGeneration) return;
        if (response.status === 401) {
          retire();
          return;
        }
        if (!response.ok) return;
        const current = modeProjection(await response.json());
        const displayed = options.readState();
        if (
          !disposed &&
          owner() === capturedOwner &&
          generation() === capturedGeneration &&
          current &&
          (current.generation !== capturedGeneration ||
            current.active !== displayed.active ||
            current.invalid !== displayed.invalid ||
            current.orgId !== displayed.orgId ||
            current.roleKey !== displayed.roleKey)
        )
          retire();
      } catch {
        /* Failed revalidation grants no authority; server still validates each write. */
      } finally {
        checking = undefined;
      }
    })();
  };
  const onVisible = () => {
    if (document.visibilityState !== 'hidden') revalidate();
  };
  const onInput = () => {
    lastWrite = Date.now();
  };
  const onSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.method.toUpperCase() === 'GET') return;
    if (new URL(form.action, origin).origin !== origin) return;
    if (paused) {
      event.preventDefault();
      return;
    }
    let hidden = form.querySelector<HTMLInputElement>(`input[name="${FORM_FIELD}"]`);
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = FORM_FIELD;
      form.append(hidden);
    }
    hidden.value = generation();
    // Enhanced forms prevent default and enter the tracked fetch path instead.
    queueMicrotask(() => {
      if (!event.defaultPrevented) nativeWritePending = true;
    });
  };
  const onFormData = (event: Event) => {
    if ('formData' in event && event.formData instanceof FormData)
      event.formData.set(FORM_FIELD, generation());
  };
  const onPageShow = () => {
    nativeWritePending = false;
    if (retired) {
      try {
        client.retryNavigation();
      } catch {
        /* The concealed document keeps read-only recovery. */
      }
      return;
    }
    revalidate();
  };

  const wrappedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    const sameOrigin = url.origin === origin;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const mutation = sameOrigin && !SAFE_METHODS.has(method);
    const sessionControl = /^\/api\/auth(?:\/|$)/.test(url.pathname);
    const transition = url.pathname === ENDPOINT;
    const capturedOwner = owner();
    const capturedGeneration = generation();
    if (mutation && paused && !transition && !sessionControl)
      throw new RoleSimulationClientError('busy');
    let requestInit = init;
    if (mutation && !sessionControl) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set(SIMULATION_GENERATION_HEADER, capturedGeneration);
      requestInit = { ...init, headers };
    }
    const task = fetchOriginal(input, requestInit);
    if (mutation) {
      pendingWrites.add(task);
      lastWrite = Date.now();
    }
    let response: Response;
    try {
      response = await task;
    } finally {
      if (mutation) {
        pendingWrites.delete(task);
        lastWrite = Date.now();
      }
    }
    const current = () =>
      !disposed && !retired && owner() === capturedOwner && generation() === capturedGeneration;
    const serverGeneration = response.headers.get(SIMULATION_GENERATION_HEADER);
    if (
      sameOrigin &&
      response.status === 409 &&
      serverGeneration &&
      serverGeneration !== capturedGeneration
    )
      retire();
    if (mutation && !disposed && (owner() !== capturedOwner || generation() !== capturedGeneration))
      retire();
    // An admitted mutation can commit in its captured mode. Preserve its receipt;
    // rejecting it as cancelled would invite unsafe repetition of a real write.
    if (mutation || !sameOrigin) return response;
    if (!current()) staleRead();
    return guardedResponse(response, current, registerReadRetirement);
  };
  window.fetch = wrappedFetch;
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', revalidate);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('formdata', onFormData, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onInput, true);

  function assertClean() {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    if (event.defaultPrevented) throw new RoleSimulationClientError('dirty');
  }
  async function drainAuthorityChanges(
    actions: PendingAuthorityActions | undefined,
    capturedOwner: string,
    capturedGeneration: string,
  ): Promise<void> {
    const start = Date.now();
    // The existing autosave debounce is 500ms. Input/change and every raw
    // mutation restart this interval, including writes not using actions.
    lastWrite = Math.max(lastWrite, start);
    while (true) {
      if (disposed || retired || owner() !== capturedOwner || generation() !== capturedGeneration)
        throw new RoleSimulationClientError('stale');
      const actionsPending = actions ? actions.foregroundPending + actions.backgroundPending : 0;
      if (
        !pendingWrites.size &&
        !nativeWritePending &&
        actionsPending <= 0 &&
        Date.now() - lastWrite >= QUIET_MS
      )
        break;
      if (Date.now() - start >= DRAIN_LIMIT_MS) throw new RoleSimulationClientError('pending');
      await new Promise((done) => setTimeout(done, 25));
    }
    assertClean();
    if (actions?.attentionRequired) throw new RoleSimulationClientError('attention');
  }
  const client: Client = {
    retireDocument() {
      if (disposed) return false;
      retire();
      return true;
    },
    retryNavigation() {
      if (disposed || !retired || !retirementLocation) return false;
      navigate(retirementLocation);
      return true;
    },
    async prepareAuthorityChange(actions) {
      if (disposed || retired || !owner()) throw new RoleSimulationClientError('stale');
      if (transitioning) throw new RoleSimulationClientError('busy');
      assertClean();
      if (actions?.attentionRequired) throw new RoleSimulationClientError('attention');
      const capturedOwner = owner();
      const capturedGeneration = generation();
      transitioning = true;
      try {
        await drainAuthorityChanges(actions, capturedOwner, capturedGeneration);
      } catch (error) {
        transitioning = false;
        throw error;
      }
      paused = true;
      let phase: 'prepared' | 'cancelled' | 'committed' | 'unknown' = 'prepared';
      let issued = false;
      let cancellable = true;
      const ownsScope = () =>
        !disposed && owner() === capturedOwner && generation() === capturedGeneration;
      const release = () => {
        transitioning = false;
        if (!retired) paused = false;
      };
      const localDestination = (location: string) => {
        if (!location.startsWith('/') || location.startsWith('//') || location.length > 4096)
          return null;
        const target = new URL(location, origin);
        return target.origin === origin ? target.pathname + target.search + target.hash : null;
      };
      const controller: AuthorityChangeController = {
        isCurrent: ownsScope,
        async fetch(input, init) {
          if (phase !== 'prepared' || retired || !ownsScope())
            throw new RoleSimulationClientError('stale');
          if (issued) throw new RoleSimulationClientError('busy');
          const url = new URL(input instanceof Request ? input.url : String(input), origin);
          const method = (
            init?.method ?? (input instanceof Request ? input.method : 'GET')
          ).toUpperCase();
          if (url.origin !== origin || SAFE_METHODS.has(method))
            throw new RoleSimulationClientError('rejected');
          issued = true;
          cancellable = false;
          const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined),
          );
          headers.set(SIMULATION_GENERATION_HEADER, capturedGeneration);
          const response = await fetchOriginal(input, { ...init, headers });
          const serverGeneration = response.headers.get(SIMULATION_GENERATION_HEADER);
          if (
            response.status === 409 &&
            serverGeneration &&
            serverGeneration !== capturedGeneration
          ) {
            // This is an obsolete browser authority, not an editable policy
            // revision conflict. The controlled write bypasses wrappedFetch,
            // so retire here even when cross-tab signals are unavailable.
            controller.unknown();
            throw new RoleSimulationClientError('stale');
          }
          // A successful, 5xx, unauthenticated or timed-out request may have a
          // durable effect. Only a definite validation/authorization rejection
          // can reopen the old authority without a fresh document.
          cancellable =
            response.status >= 400 &&
            response.status < 500 &&
            ![401, 408].includes(response.status);
          return response;
        },
        commit(location) {
          if (phase !== 'prepared' || retired) return false;
          if (!ownsScope()) {
            phase = 'cancelled';
            release();
            return false;
          }
          const destination = localDestination(location);
          if (!destination) {
            controller.unknown();
            throw new RoleSimulationClientError('unknown');
          }
          phase = 'committed';
          retire(destination);
          return true;
        },
        cancel() {
          if (phase !== 'prepared') return;
          if (!cancellable) {
            controller.unknown();
            return;
          }
          phase = 'cancelled';
          release();
        },
        unknown(
          location = window.location.pathname + window.location.search + window.location.hash,
        ) {
          if (phase !== 'prepared' || retired) return false;
          if (!ownsScope()) {
            phase = 'cancelled';
            release();
            return false;
          }
          phase = 'unknown';
          unresolved = true;
          retire(
            localDestination(location) ??
              window.location.pathname + window.location.search + window.location.hash,
          );
          return true;
        },
        retryNavigation() {
          if (!ownsScope() || !['committed', 'unknown'].includes(phase)) return false;
          return client.retryNavigation();
        },
      };
      return controller;
    },
    async transition(input) {
      if (disposed || retired || owner() === '') throw new RoleSimulationClientError('stale');
      if (unresolved) {
        retire();
        throw new RoleSimulationClientError('unknown');
      }
      if (transitioning) throw new RoleSimulationClientError('busy');
      if (input.state.generation !== generation()) throw new RoleSimulationClientError('stale');
      assertClean();
      if (input.actions?.attentionRequired) throw new RoleSimulationClientError('attention');
      transitioning = true;
      const capturedOwner = owner();
      const capturedGeneration = generation();
      try {
        await drainAuthorityChanges(input.actions, capturedOwner, capturedGeneration);
        paused = true;
        options.onBeforeTransition?.();
        let response: Response;
        try {
          response = await fetchOriginal(ENDPOINT, {
            method: input.roleKey ? 'POST' : 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              [SIMULATION_GENERATION_HEADER]: capturedGeneration,
            },
            body: JSON.stringify({
              generation: capturedGeneration,
              ...(input.roleKey ? { roleKey: input.roleKey } : {}),
              returnTo: input.returnTo,
            }),
          });
        } catch {
          unresolved = true;
          retire();
          throw new RoleSimulationClientError('unknown');
        }
        if (disposed || owner() !== capturedOwner || generation() !== capturedGeneration)
          throw new RoleSimulationClientError('stale');
        if (!response.ok) {
          if (response.status >= 500) {
            unresolved = true;
            retire();
            throw new RoleSimulationClientError('unknown');
          }
          if (response.status === 401) {
            retire();
            throw new RoleSimulationClientError('stale');
          }
          const serverGeneration = response.headers.get(SIMULATION_GENERATION_HEADER);
          if (
            response.status === 409 &&
            serverGeneration &&
            serverGeneration !== capturedGeneration
          )
            retire();
          throw new RoleSimulationClientError('rejected');
        }
        let committed: ReturnType<typeof receipt>;
        try {
          committed = receipt(await response.json(), origin);
        } catch {
          committed = null;
        }
        if (!committed) {
          unresolved = true;
          retire();
          throw new RoleSimulationClientError('unknown');
        }
        if (disposed || owner() !== capturedOwner || generation() !== capturedGeneration)
          throw new RoleSimulationClientError('stale');
        announce(committed.generation, capturedOwner);
        retire(committed.location);
      } finally {
        transitioning = false;
        if (!retired && !unresolved) {
          paused = false;
          try {
            options.onRejected?.();
          } catch {
            /* A reconnect cannot change the transition result. */
          }
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      retireReads();
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
      try {
        channel?.close();
      } catch {
        /* Browser shutdown. */
      }
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('formdata', onFormData, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('change', onInput, true);
      if (installed === client) {
        document.documentElement.removeAttribute('data-authority-retiring');
        installed = undefined;
      }
    },
  };
  installed = client;
  return client.dispose;
}

export function transitionRoleSimulation(input: TransitionInput): Promise<void> {
  return installed
    ? installed.transition(input)
    : Promise.reject(new RoleSimulationClientError('unavailable'));
}

/** Call before registering the policy write's own action-runtime command. */
export function prepareAuthorityChange(
  actions?: PendingAuthorityActions,
): Promise<AuthorityChangeController> {
  return installed
    ? installed.prepareAuthorityChange(actions)
    : Promise.reject(new RoleSimulationClientError('unavailable'));
}

/** Read-only recovery for the retired application shell. */
export function retryAuthorityNavigation(): boolean {
  return installed?.retryNavigation() ?? false;
}

/** Canonical layout authority changed independently of this tab's controls. */
export function retireAuthorityDocument(): boolean {
  return installed?.retireDocument() ?? false;
}
