/**
 * The host side of the sandbox: it owns the element list and is the only thing
 * that talks to the API. Elements run at a null origin and can do nothing but
 * `postMessage` to their parent; this router validates that every message came
 * from a frame it registered itself, under that frame's own element id, and
 * performs the query with the user's session (so RBAC is the user's).
 */
import type { LayoutUpdate } from './canvas';

export interface SandboxElementRecord {
  id: string;
  page: string;
  title: string;
  html: string;
  css: string;
  js: string;
  w: number;
  h: number;
  position: number;
  createdBy: string;
  updatedAt: string;
}

export type SandboxElementInput = Partial<
  Pick<SandboxElementRecord, 'id' | 'title' | 'html' | 'css' | 'js' | 'w' | 'h' | 'page'>
> &
  Pick<SandboxElementRecord, 'title'>;

/**
 * Dispatched on `window` by whatever writes an element through the API (the
 * assistant tools) so the open page reloads its list.
 *
 * TODO(handoff): `src/lib/sandbox/tools.ts` declares the same string instead of
 * importing this one (the two slices landed in parallel) — collapse it to this
 * export so the name cannot drift; belongs in the spec-010 POC follow-ups proposal (T015).
 */
export const SANDBOX_CHANGED_EVENT = 'minion:sandbox-changed';

const ELEMENTS_URL = '/api/sandbox/elements';
const QUERY_URL = '/api/sandbox/query';

export interface SandboxMessage {
  minion: 1;
  elementId: string;
  requestId: string | null;
  type: 'query' | 'result' | 'error' | 'ready' | 'resize' | 'theme';
  payload?: unknown;
}

function errorText(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value) {
    const detail = (value as { error?: unknown }).error;
    if (typeof detail === 'string') return detail;
  }
  return fallback;
}

export function createSandboxHost(initial: SandboxElementRecord[] = []) {
  let elements = $state<SandboxElementRecord[]>(initial);
  let loading = $state(false);
  let error = $state<string | null>(null);
  /** Per-element render nonce — `reload(id)` bumps it to rebuild the srcdoc. */
  let versions = $state<Record<string, number>>({});

  const frames = new Map<HTMLIFrameElement, string>();

  function frameFor(source: MessageEventSource | null, elementId: string): Window | null {
    for (const [frame, id] of frames) {
      if (id === elementId && frame.contentWindow === source) return frame.contentWindow;
    }
    return null;
  }

  async function runQuery(target: Window, elementId: string, requestId: string, spec: unknown) {
    const reply = (type: 'result' | 'error', payload: unknown) =>
      target.postMessage({ minion: 1, elementId, requestId, type, payload }, '*');
    try {
      const res = await fetch(QUERY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(spec),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) reply('error', { error: errorText(body, `query failed (${res.status})`) });
      else reply('result', body);
    } catch (err) {
      reply('error', { error: err instanceof Error ? err.message : 'query failed' });
    }
  }

  /**
   * Exported for tests: drops anything that did not come from one of our own
   * registered frames under that frame's own element id.
   */
  function handleMessage(event: MessageEvent<unknown>) {
    const data = event.data as SandboxMessage | null;
    if (!data || typeof data !== 'object' || data.minion !== 1) return false;
    if (typeof data.elementId !== 'string') return false;
    const target = frameFor(event.source, data.elementId);
    if (!target) return false;
    if (data.type === 'query' && typeof data.requestId === 'string') {
      void runQuery(target, data.elementId, data.requestId, data.payload);
      return true;
    }
    return data.type === 'ready';
  }

  async function load() {
    loading = true;
    try {
      const res = await fetch(ELEMENTS_URL, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`could not load elements (${res.status})`);
      const body = (await res.json()) as { elements?: SandboxElementRecord[] };
      elements = body.elements ?? [];
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'could not load elements';
    } finally {
      loading = false;
    }
  }

  async function write(
    method: 'POST' | 'PATCH',
    url: string,
    input: SandboxElementInput | Omit<LayoutUpdate, 'id'>,
  ) {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(errorText(body, `could not save element (${res.status})`));
    }
  }

  return {
    get elements() {
      return elements;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    /** Render nonce for `id` — include it in the srcdoc so `reload` takes effect. */
    versionOf(id: string) {
      return versions[id] ?? 0;
    },
    reload(id: string) {
      versions = { ...versions, [id]: (versions[id] ?? 0) + 1 };
    },
    register(frame: HTMLIFrameElement, elementId: string) {
      frames.set(frame, elementId);
      return () => {
        frames.delete(frame);
      };
    },
    handleMessage,
    load,
    async upsert(input: SandboxElementInput) {
      if (input.id) await write('PATCH', `${ELEMENTS_URL}/${input.id}`, input);
      else await write('POST', ELEMENTS_URL, input);
      await load();
    },
    /** Write only the rows a layout change touched (spec 013 D2), then reload. */
    async arrange(updates: LayoutUpdate[]) {
      if (updates.length === 0) return;
      await Promise.all(
        updates.map(({ id, ...patch }) => write('PATCH', `${ELEMENTS_URL}/${id}`, patch)),
      );
      await load();
    },
    async remove(id: string) {
      const res = await fetch(`${ELEMENTS_URL}/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(errorText(body, `could not remove element (${res.status})`));
      }
      await load();
    },
    /** Window listeners for the page's lifetime; returns the disposer. */
    attach() {
      const onMessage = (event: MessageEvent<unknown>) => void handleMessage(event);
      const onChanged = () => void load();
      window.addEventListener('message', onMessage);
      window.addEventListener(SANDBOX_CHANGED_EVENT, onChanged);
      return () => {
        window.removeEventListener('message', onMessage);
        window.removeEventListener(SANDBOX_CHANGED_EVENT, onChanged);
      };
    },
  };
}

export type SandboxHost = ReturnType<typeof createSandboxHost>;
