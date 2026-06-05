/**
 * Migration + save-coordination tests for the server-backed notes store.
 *
 * This file is `.svelte.test.ts` so the Svelte compiler transforms the `$state`
 * runes in `agent-notes.svelte.ts`. The store is a module singleton, so each
 * test `vi.resetModules()` + re-imports to start fresh. `fetch` and
 * `localStorage` don't exist under the node test env — both are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function mockStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    _map: m,
  };
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[];

function installFetch(getNotes: unknown[] = []) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    if (url === '/api/notes' && method === 'GET') {
      return new Response(JSON.stringify({ notes: getNotes }), { status: 200 });
    }
    if (url === '/api/notes' && method === 'POST') {
      const id = `srv-${calls.filter((c) => c.method === 'POST').length}`;
      return new Response(JSON.stringify({ note: { ...(body as object), id, createdAt: 1, updatedAt: 1 } }), {
        status: 201,
      });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  calls = [];
});

describe('loadNotes migration', () => {
  it('imports legacy localStorage notes, flags migrated, clears the key', async () => {
    const store = mockStorage();
    store.setItem(
      'minion-agent-notes',
      JSON.stringify([
        { id: 'old1', kind: 'note', title: 'Hello', body: 'world', color: 'amber', pinned: true },
        { id: 'old2', kind: 'todo', title: 'List', items: [{ id: 'i1', text: 'a', done: false }] },
      ]),
    );
    vi.stubGlobal('localStorage', store);
    installFetch();

    const mod = await import('./agent-notes.svelte');
    await mod.loadNotes();

    const posts = calls.filter((c) => c.url === '/api/notes' && c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(mod.notesState.notes).toHaveLength(2);
    expect(store.getItem('minion-agent-notes-migrated')).toBe('1');
    expect(store.getItem('minion-agent-notes')).toBeNull();
  });

  it('does not re-migrate when the migrated flag is set', async () => {
    const store = mockStorage();
    store.setItem('minion-agent-notes-migrated', '1');
    store.setItem('minion-agent-notes', JSON.stringify([{ id: 'x', kind: 'note', title: 'T' }]));
    vi.stubGlobal('localStorage', store);
    installFetch();

    const mod = await import('./agent-notes.svelte');
    await mod.loadNotes();

    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('hydrates server notes into client shape', async () => {
    vi.stubGlobal('localStorage', mockStorage());
    installFetch([
      {
        id: 's1',
        kind: 'note',
        title: 'Server',
        color: 'sky',
        pinned: false,
        data: { body: '# hi', attachments: [] },
        createdAt: 5,
        updatedAt: 5,
      },
    ]);

    const mod = await import('./agent-notes.svelte');
    await mod.loadNotes();

    expect(mod.notesState.notes[0]).toMatchObject({ id: 's1', kind: 'note', body: '# hi', color: 'sky' });
  });
});

describe('addNote', () => {
  it('optimistically inserts and POSTs a create', async () => {
    vi.stubGlobal('localStorage', mockStorage());
    installFetch();
    const mod = await import('./agent-notes.svelte');
    await mod.loadNotes();
    calls = [];

    const note = mod.addNote('note');
    expect(mod.notesState.notes[0].id).toBe(note.id);
    // POST fires synchronously (not awaited) — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.some((c) => c.url === '/api/notes' && c.method === 'POST')).toBe(true);
  });
});
