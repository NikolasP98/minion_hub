// @vitest-environment happy-dom
/**
 * HC-037 — the workspace list route wires create/open/delete to the owned
 * lifecycle: failures are visible, pending admission blocks double activation,
 * and navigation follows only the completion that published.
 * Markup/role semantics stay exactly as HC-026 qualified them
 * (card-actions.mounted.test.ts keeps guarding those).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

const { page, gotos, toasts } = vi.hoisted(() => ({
  page: {
    data: { user: { id: 'actor-1', email: 'a@x', role: 'user' }, activeOrgId: 'org-1' } as Record<
      string,
      unknown
    >,
    params: {} as Record<string, string>,
    url: new URL('http://localhost/'),
  },
  gotos: [] as string[],
  toasts: [] as string[],
}));
vi.mock('$app/state', () => ({ page }));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn() }));
vi.mock('$lib/navigation', () => ({ goto: vi.fn(async (u: string) => void gotos.push(u)) }));
vi.mock('$lib/auth', () => ({ authClient: { signOut: vi.fn(async () => {}) } }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_AUTH_PROVIDER: 'better-auth' } }));
vi.mock('$lib/supabase/client', () => ({
  supabaseBrowser: () => ({ auth: { signOut: vi.fn(async () => {}) } }),
}));
vi.mock('$lib/state/features/hosts.svelte', () => ({ hostsState: { activeHostId: 'host-1' } }));
vi.mock('$lib/state/workshop/workshop.memory.svelte', () => ({ loadMemory: vi.fn() }));
vi.mock('$lib/state/ui/toast.svelte', () => ({
  toastError: vi.fn((title: string) => void toasts.push(title)),
}));

import Workshop from './+page.svelte';
import { saveSync, workshopState, resetWorkshop } from '$lib/state/workshop/workshop.svelte';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => (resolve = yes));
  return { promise, resolve };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number) => new Response('{}', { status });
const save = (id: string, agent: string) => ({
  save: {
    id,
    name: id,
    state: {
      camera: { x: 0, y: 0, zoom: 1 },
      agents: { [agent]: { instanceId: agent, agentId: 'x', position: { x: 0, y: 0 } } },
      relationships: {},
      elements: {},
      settings: {},
    },
  },
});
const list = {
  saves: ['A', 'B'].map((id) => ({
    id,
    name: `Workspace ${id}`,
    updatedAt: 0,
    createdAt: 0,
    thumbnail: null,
    agentCount: 1,
    elementCount: 0,
  })),
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  gotos.length = 0;
  toasts.length = 0;
  resetWorkshop();
  saveSync.activeSaveId = null;
});
afterEach(cleanup);

describe('workspace list lifecycle wiring', () => {
  it('rejected create shows failure, keeps the loaded workspace, navigates nowhere', async () => {
    fetchMock.mockResolvedValueOnce(ok(save('A', 'a1')));
    const { openSave } = await import('$lib/state/workshop/workshop.svelte');
    await openSave('A');
    fetchMock.mockResolvedValueOnce(ok(list));
    const view = render(Workshop);
    const create = await view.findByRole('button', { name: '+ Create Blank' });
    fetchMock.mockResolvedValueOnce(fail(500));
    await fireEvent.click(create);
    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(gotos).toEqual([]);
    expect(saveSync.activeSaveId).toBe('A');
    expect(Object.keys(workshopState.agents)).toEqual(['a1']);
  });

  it('open A then B: only B publishes identity and navigation; cards are admitted once', async () => {
    fetchMock.mockResolvedValueOnce(ok(list));
    const view = render(Workshop);
    const openA = await view.findByRole('button', { name: 'Workspace A' });
    const openB = view.getByRole('button', { name: 'Workspace B' });
    const a = deferred<Response>();
    const b = deferred<Response>();
    fetchMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await fireEvent.click(openA);
    await fireEvent.click(openB);
    b.resolve(ok(save('B', 'b1')));
    await waitFor(() => expect(gotos).toEqual(['/agents/workshop/B']));
    a.resolve(ok(save('A', 'a1')));
    await new Promise((r) => setTimeout(r, 0));
    expect(gotos).toEqual(['/agents/workshop/B']);
    expect(saveSync.activeSaveId).toBe('B');
    expect(localStorage.getItem('workshop:activeSaveId')).toBe('B');
    expect(Object.keys(workshopState.agents)).toEqual(['b1']);
  });

  it('rejected delete keeps the card and reports', async () => {
    fetchMock.mockResolvedValueOnce(ok(list));
    const view = render(Workshop);
    const del = await view.findByRole('button', { name: 'Delete Workspace A' });
    fetchMock.mockResolvedValueOnce(fail(500));
    await fireEvent.click(del);
    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(view.getByRole('button', { name: 'Workspace A' })).toBeTruthy();
  });
});
