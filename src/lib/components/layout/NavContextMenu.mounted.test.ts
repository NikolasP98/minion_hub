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
vi.mock('$lib/access/can.svelte', () => ({ canClient: (k: string) => state.perms.has(k) }));

import NavContextMenu from './NavContextMenu.svelte';
import { navClipboard } from '$lib/nav/nav-edit.svelte';

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
  state.data = { navConfig, preferences: { preferences: {} } };
}

beforeEach(() => {
  navClipboard.item = null;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/nav/config' && !init?.method)
      return new Response(JSON.stringify(CONFIG), { status: 200 });
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

  it('(f) New section rejects the reserved slug pos and keeps Save disabled', async () => {
    setup(['settings:manage']);
    mount({ kind: 'area' });
    await fireEvent.contextMenu(screen.getByTestId('row'));
    await fireEvent.click(screen.getByRole('menuitem', { name: /New section/ }));
    const label = await screen.findByLabelText(/Label/);
    await fireEvent.input(label, { target: { value: 'pos' } });
    await waitFor(() => expect(screen.getByText('This name is reserved')).toBeTruthy());
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
