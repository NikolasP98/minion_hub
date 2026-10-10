// @vitest-environment happy-dom
/**
 * HC-037 — owned workspace lifecycle for the Workshop state module.
 *
 * Three acceptance items, each red on the pre-fix module:
 *  (1) a rejected create after a workspace is loaded preserves state/selection,
 *      surfaces the failure and never autosaves reset data;
 *  (2) open A/B races and actor/org rotation publish only the current owner;
 *  (3) a rejected or lost autosave reports failed/unknown and recovers only on
 *      an explicit retry — never by silently replaying the mutation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const page = vi.hoisted(() => ({
  data: { user: { id: 'actor-1', email: 'a@x', role: 'user' }, activeOrgId: 'org-1' } as Record<
    string,
    unknown
  >,
  params: {} as Record<string, string>,
  url: new URL('http://localhost/'),
}));
vi.mock('$app/state', () => ({ page }));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn() }));
vi.mock('$lib/auth', () => ({ authClient: { signOut: vi.fn(async () => {}) } }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_AUTH_PROVIDER: 'better-auth' } }));
vi.mock('$lib/supabase/client', () => ({
  supabaseBrowser: () => ({ auth: { signOut: vi.fn(async () => {}) } }),
}));
vi.mock('$lib/state/features/hosts.svelte', () => ({ hostsState: { activeHostId: 'host-1' } }));
vi.mock('./workshop.memory.svelte', () => ({ loadMemory: vi.fn() }));

import {
  workshopState,
  saveSync,
  openSave,
  createBlankSave,
  addAgentInstance,
  resetWorkshop,
  retryDbSave,
} from './workshop.svelte';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function saveBody(id: string, agentIds: string[]) {
  const agents: Record<string, unknown> = {};
  for (const a of agentIds)
    agents[a] = { instanceId: a, agentId: 'x', position: { x: 0, y: 0 }, behavior: 'stationary' };
  return {
    save: {
      id,
      name: id,
      state: {
        camera: { x: 1, y: 2, zoom: 1 },
        agents,
        relationships: {},
        elements: {},
        settings: {},
      },
    },
  };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number) => new Response('{}', { status });

const fetchMock = vi.fn<typeof fetch>();
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`);
const putBodies = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(JSON.parse(String(init!.body)).state));

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  localStorage.clear();
  page.data = { user: { id: 'actor-1', email: 'a@x', role: 'user' }, activeOrgId: 'org-1' };
  resetWorkshop();
  saveSync.activeSaveId = null;
});
afterEach(() => {
  vi.useRealTimers();
});

const agentIds = () => Object.keys(workshopState.agents).sort();

describe('(1) create after an existing workspace is loaded', () => {
  it('rejected create preserves state + selection, reports failure, autosaves nothing reset', async () => {
    fetchMock.mockResolvedValueOnce(ok(saveBody('A', ['a1'])));
    await openSave('A');
    expect(saveSync.activeSaveId).toBe('A');
    const local = addAgentInstance('agent-local', 3, 4);

    fetchMock.mockResolvedValueOnce(fail(500));
    await expect(createBlankSave('Blank')).rejects.toThrow();

    // selection + state survive the rejection
    expect(saveSync.activeSaveId).toBe('A');
    expect(agentIds()).toEqual(['a1', local].sort());
    expect(workshopState.camera).toEqual({ x: 1, y: 2, zoom: 1 });

    // no autosave of reset data: every persisted write still carries A's agents
    fetchMock.mockResolvedValue(ok({ ok: true }));
    await vi.advanceTimersByTimeAsync(5_000);
    const stored = JSON.parse(localStorage.getItem('workshop:autosave:host-1:agents') ?? '{}');
    expect(Object.keys(stored).sort()).toEqual(['a1', local].sort());
    for (const body of putBodies())
      expect(Object.keys(body.agents).sort()).toEqual(['a1', local].sort());
    expect(calls().filter((c) => c.startsWith('PUT'))).toEqual(['PUT /api/workshop/saves/A']);
  });

  it('acknowledged create switches to the new blank workspace', async () => {
    fetchMock.mockResolvedValueOnce(ok(saveBody('A', ['a1'])));
    await openSave('A');
    fetchMock.mockResolvedValueOnce(ok({ id: 'N' }));
    await expect(createBlankSave('Blank')).resolves.toBe('N');
    expect(saveSync.activeSaveId).toBe('N');
    expect(agentIds()).toEqual([]);
    // the POST body was the blank state, built without touching the live one
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(Object.keys(JSON.parse(JSON.parse(String(post[1]!.body)).state).agents)).toEqual([]);
  });
});

describe('(2) open A/B race + actor/org rotation', () => {
  it('a late A completion cannot publish over B', async () => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    fetchMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const pA = openSave('A');
    const pB = openSave('B');
    b.resolve(ok(saveBody('B', ['b1'])));
    await pB;
    expect(saveSync.activeSaveId).toBe('B');
    a.resolve(ok(saveBody('A', ['a1'])));
    const lateA = await pA;
    expect(saveSync.activeSaveId).toBe('B');
    expect(agentIds()).toEqual(['b1']);
    expect(localStorage.getItem('workshop:activeSaveId')).toBe('B');
    expect(lateA).toBe(false);
    await pB.then((published) => expect(published).toBe(true));
  });

  it.each([
    ['actor', () => ((page.data.user as { id: string }).id = 'actor-2')],
    ['org', () => (page.data.activeOrgId = 'org-2')],
  ])('%s rotated between dispatch and completion drops the completion', async (_, rotate) => {
    fetchMock.mockResolvedValueOnce(ok(saveBody('A', ['a1'])));
    await openSave('A');
    const b = deferred<Response>();
    fetchMock.mockReturnValueOnce(b.promise);
    const pB = openSave('B');
    rotate();
    b.resolve(ok(saveBody('B', ['b1'])));
    const published = await pB;
    expect(saveSync.activeSaveId).toBe('A');
    expect(agentIds()).toEqual(['a1']);
    expect(published).toBe(false);
  });

  it('a save owned by a rotated actor is not sent', async () => {
    fetchMock.mockResolvedValueOnce(ok(saveBody('A', ['a1'])));
    await openSave('A');
    addAgentInstance('agent-local', 0, 0);
    (page.data.user as { id: string }).id = 'actor-2';
    fetchMock.mockResolvedValue(ok({ ok: true }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls().filter((c) => c.startsWith('PUT'))).toEqual([]);
  });
});

describe('(3) rejected or lost autosave', () => {
  async function loadAndMutate() {
    fetchMock.mockResolvedValueOnce(ok(saveBody('A', ['a1'])));
    await openSave('A');
    expect(saveSync.status).toBe('saved');
    addAgentInstance('agent-local', 0, 0);
    expect(saveSync.status).toBe('unsaved');
  }

  it('rejected PUT → failed; retry is explicit, bounded, and sends the current state', async () => {
    await loadAndMutate();
    fetchMock.mockResolvedValueOnce(fail(500));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saveSync.status).toBe('failed');
    expect(saveSync.lastSavedAt).toBeNull();
    expect(calls().filter((c) => c.startsWith('PUT'))).toHaveLength(1);

    // no silent replay while idle
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls().filter((c) => c.startsWith('PUT'))).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    await retryDbSave();
    expect(saveSync.status).toBe('saved');
    expect(saveSync.lastSavedAt).not.toBeNull();
    expect(calls().filter((c) => c.startsWith('PUT'))).toHaveLength(2);
    expect(Object.keys(putBodies()[1].agents)).toHaveLength(2);
  });

  it('lost response → unknown (not saved, not failed)', async () => {
    await loadAndMutate();
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saveSync.status).toBe('unknown');
    expect(saveSync.lastSavedAt).toBeNull();
  });

  it('a mutation during the flight keeps the status truthful (unsaved, then saved by its own save)', async () => {
    await loadAndMutate();
    const put = deferred<Response>();
    fetchMock.mockReturnValueOnce(put.promise);
    await vi.advanceTimersByTimeAsync(2_400);
    expect(saveSync.status).toBe('saving');
    addAgentInstance('agent-late', 0, 0);
    put.resolve(ok({ ok: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSync.status).toBe('unsaved');
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saveSync.status).toBe('saved');
    expect(Object.keys(putBodies().at(-1)!.agents)).toHaveLength(3);
  });
});
