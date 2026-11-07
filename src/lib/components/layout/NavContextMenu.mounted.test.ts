// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { EMPTY_NAV_CONFIG, type NavConfig } from '$lib/nav/custom-sections';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  data: {} as Record<string, unknown>,
}));

vi.mock('$app/state', () => ({
  page: {
    get data() {
      return state.data;
    },
    url: new URL('http://localhost/pos/sell'),
  },
}));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn() }));

import NavContextMenu from './NavContextMenu.svelte';
import { navClipboard } from '$lib/nav/nav-edit.svelte';
import { navConfig } from '$lib/nav/nav-config.svelte';

const CONFIG: NavConfig = {
  ...EMPTY_NAV_CONFIG,
  sections: [
    {
      id: 'st4ff1',
      slug: 'staff',
      label: 'Staff',
      pages: [
        { id: 'k3x9q2', kind: 'link', slug: 'sell', label: 'Sell', target: '/pos/sell' },
        { id: 'a1b2c3', kind: 'main', slug: 'appts', label: 'Appts', target: '/pos/appointments' },
      ],
    },
  ],
};

const child = createRawSnippet(() => ({ render: () => '<a href="#x" data-testid="row">row</a>' }));
function mount(props: { kind: 'item' | 'header' | 'area'; href?: string; sectionId?: string }) {
  return render(NavContextMenu, { props: { children: child, label: 'Row', ...props } });
}
const rows = async () => {
  await screen.findByRole('menu');
  return [...document.querySelectorAll('[role^="menuitem"]')].map((r) => r.textContent?.trim());
};

function setup(perms: string[], navConfig: NavConfig = CONFIG) {
  state.perms = new Set(perms);
  // Real permission path: the layout bundle's `permissions.permissions` strings (not a mocked gate).
  state.data = { navConfig, preferences: { preferences: {} }, permissions: { permissions: perms } };
}

let stored: NavConfig = CONFIG;
let failOverrides = false;
beforeEach(() => {
  navClipboard.item = null;
  stored = CONFIG;
  failOverrides = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/nav/config' && !init?.method)
      return new Response(JSON.stringify(stored), { status: 200 });
    if (url === '/api/roles')
      return new Response(
        JSON.stringify({
          roles: [
            { key: 'owner', name: 'Owner' },
            { key: 'viewer', name: 'Viewer' },
          ],
        }),
      );
    if (url.startsWith('/api/roles/overrides') && !init?.method) return new Response('{}');
    if (url === '/api/roles/overrides' && failOverrides) return new Response('{}', { status: 500 });
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NavContextMenu', () => {
  it('(a) a member without settings:manage gets only Set as home', async () => {
    setup([]);
    mount({ kind: 'item', href: '/pos/sell' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/home/i);
  });

  it('(a2) Access… shows only for users:manage, with or without settings:manage', async () => {
    setup(['users:manage']);
    mount({ kind: 'item', href: '/pos/sell' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    expect((await rows()).join('|')).toContain('Access');
  });

  it('(b) admin on a built-in page: copy/duplicate/move/rename/hide, no delete', async () => {
    setup(['settings:manage']);
    mount({ kind: 'item', href: '/pos/sell' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    const text = (await rows()).join('|');
    for (const w of ['Copy', 'Duplicate', 'Move', 'Rename', 'Hide']) expect(text).toContain(w);
    expect(text).not.toContain('Delete');
    expect(text).not.toContain('Access');
  });

  it('(c) link gets delete, moved main gets restore', async () => {
    setup(['settings:manage']);
    const a = mount({ kind: 'item', href: '/staff/sell~k3x9q2' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    expect((await rows()).join('|')).toContain('Delete');
    cleanup();
    mount({ kind: 'item', href: '/staff/appts~a1b2c3' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    expect((await rows()).join('|')).toContain('Restore to /pos/appointments');
    void a;
  });

  it('(d) Shift+F10 opens the menu with the first row focused; Escape closes', async () => {
    setup([]);
    mount({ kind: 'item', href: '/pos/sell' });
    await fireEvent.keyDown(screen.getByTestId('row'), { key: 'F10', shiftKey: true });
    const first = await screen.findByRole('menuitemcheckbox');
    await waitFor(() => expect(document.activeElement).toBe(first));
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('(e) copy then paste on a header PUTs a new link entry', async () => {
    setup(['settings:manage']);
    mount({ kind: 'item', href: '/pos/sell' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    await fireEvent.click(screen.getByRole('menuitem', { name: /Copy/ }));
    expect(navClipboard.item?.target).toBe('/pos/sell');
    cleanup();

    mount({ kind: 'header', sectionId: 'custom:st4ff1' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    await fireEvent.click(screen.getByRole('menuitem', { name: /Paste/ }));
    await waitFor(() => {
      const put = vi
        .mocked(fetch)
        .mock.calls.find(([u, i]) => u === '/api/nav/config' && i?.method === 'PUT');
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put![1]!.body)) as NavConfig;
      const pages = body.sections[0].pages;
      expect(pages).toHaveLength(3);
      expect(pages[2]).toMatchObject({ kind: 'link', target: '/pos/sell' });
    });
  });

  async function openNewSection() {
    mount({ kind: 'area' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    await fireEvent.click(screen.getByRole('menuitem', { name: /New section/ }));
    return screen.findByLabelText(/Label/);
  }
  const navPuts = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([u, i]) => u === '/api/nav/config' && i?.method === 'PUT')
      .map(([, i]) => JSON.parse(String(i!.body)) as NavConfig);

  it('(f) New section has no slug input; a reserved name saves as pos-2 without an error', async () => {
    setup(['settings:manage']);
    await fireEvent.input(await openNewSection(), { target: { value: 'POS' } });
    expect(screen.queryByLabelText(/slug/i)).toBeNull();
    expect(screen.getByText('URL: /pos-2')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(navPuts()).toHaveLength(1));
    expect(navPuts()[0].sections.at(-1)).toMatchObject({ label: 'POS', slug: 'pos-2' });
  });

  it('(f2) two sections named Staff get staff and staff-2', async () => {
    stored = EMPTY_NAV_CONFIG;
    setup(['settings:manage'], EMPTY_NAV_CONFIG);
    await fireEvent.input(await openNewSection(), { target: { value: 'Staff' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(navPuts()).toHaveLength(1));
    expect(navPuts()[0].sections[0].slug).toBe('staff');
    cleanup();
    stored = navPuts()[0];
    setup(['settings:manage'], stored);
    await fireEvent.input(await openNewSection(), { target: { value: 'Staff' } });
    expect(screen.getByText('URL: /staff-2')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(navPuts()).toHaveLength(2));
    expect(navPuts()[1].sections.map((x) => x.slug)).toEqual(['staff', 'staff-2']);
  });

  const overridePosts = () =>
    vi.mocked(fetch).mock.calls.filter(([u, i]) => u === '/api/roles/overrides' && i?.method);
  async function denyViewer() {
    await fireEvent.click(screen.getByRole('button', { name: /Advanced settings/ }));
    const g = await screen.findByRole('group', { name: 'Viewer' });
    await fireEvent.click(
      [...g.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Deny')!,
    );
  }

  it('(h) Advanced settings: nav PUT first, then the section rows with the pre-generated id', async () => {
    setup(['settings:manage', 'users:manage']);
    await fireEvent.input(await openNewSection(), { target: { value: 'Front desk' } });
    await denyViewer();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(overridePosts()).toHaveLength(1));
    expect(navPuts()).toHaveLength(1);
    const id = navPuts()[0].sections.at(-1)!.id;
    expect(JSON.parse(String(overridePosts()[0][1]!.body))).toEqual({
      roleKey: 'viewer',
      module: `section:${id}`,
      caps: { view: false },
    });
    const order = vi
      .mocked(fetch)
      .mock.calls.filter(([, i]) => i?.method)
      .map(([u]) => String(u));
    expect(order).toEqual(['/api/nav/config', '/api/roles/overrides']);
  });

  it('(i) a failed overrides write keeps the section and the dialog; Save retries only the rows', async () => {
    setup(['settings:manage', 'users:manage']);
    failOverrides = true;
    await fireEvent.input(await openNewSection(), { target: { value: 'Front desk' } });
    await denyViewer();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/access rules were not/)).toBeTruthy();
    expect(navPuts()).toHaveLength(1);
    failOverrides = false;
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
    expect(navPuts()).toHaveLength(1);
    expect(overridePosts()).toHaveLength(2);
  });

  it('(j) without users:manage Advanced settings shows only the Icon field', async () => {
    setup(['settings:manage']);
    await openNewSection();
    await fireEvent.click(screen.getByRole('button', { name: /Advanced settings/ }));
    expect(await screen.findByLabelText('Icon')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Viewer' })).toBeNull();
    expect(screen.queryByText('Who can view')).toBeNull();
  });

  it('(g) a saved New section closes its dialog even while the app reload is still pending', async () => {
    const { invalidate } = await import('$app/navigation');
    vi.mocked(invalidate).mockImplementation(() => new Promise<void>(() => {})); // reload never lands
    setup(['settings:manage']);
    mount({ kind: 'area' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    await fireEvent.click(screen.getByRole('menuitem', { name: /New section/ }));
    await fireEvent.input(await screen.findByLabelText(/Label/), {
      target: { value: 'Front desk' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
    // The optimistic view stays up until the reload lands; the next edit must still be able to copy it.
    expect(() => structuredClone(navConfig())).not.toThrow();
  });

  it('(h) New section shows no duplicate error while its own PUT is still pending', async () => {
    let resolvePut: ((r: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/nav/config' && !init?.method)
        return new Response(JSON.stringify(CONFIG), { status: 200 });
      if (url === '/api/nav/config' && init?.method === 'PUT')
        return new Promise<Response>((r) => (resolvePut = r));
      return new Response('{}', { status: 200 });
    });
    setup(['settings:manage']);
    mount({ kind: 'area' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    await fireEvent.click(screen.getByRole('menuitem', { name: /New section/ }));
    await fireEvent.input(await screen.findByLabelText(/Label/), {
      target: { value: 'this is a test' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // The PUT is in flight and the sidebar already shows the section (optimistic);
    // the dialog must not call its own draft a duplicate.
    await waitFor(() => expect(resolvePut).toBeTypeOf('function'));
    expect(navConfig().sections.some((s) => s.slug === 'this-is-a-test')).toBe(true);
    expect(screen.queryByText(/already exists|Ya existe/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    resolvePut!(new Response('{}', { status: 200 }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
  });
});
