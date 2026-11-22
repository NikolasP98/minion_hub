// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages';

const context = vi.hoisted(() => ({
  can: true,
  page: {
    url: new URL('http://localhost/pos/sell'),
    data: {
      posSettings: {
        methods: [{ id: 'cash', label: 'Cash', enabled: true, takesTendered: true }],
      },
      openShift: null,
      openerName: 'Cashier',
      openShifts: [],
    } as Record<string, unknown>,
  },
}));
vi.mock('$app/state', () => ({ page: context.page }));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}) }));
vi.mock('$lib/access/can.svelte', () => ({
  canAct: () => context.can,
  canViewPath: () => true,
}));
vi.mock('$lib/state/ui/toast.svelte', () => ({
  toastAsync: <T>(operation: Promise<T>) => operation,
}));

import Host from './ShiftDialogs.fixture.svelte';
import ShiftBanner from './ShiftBanner.svelte';

const openShift = {
  shift: { id: 's1', openedAt: new Date().toISOString(), openingFloat: { cash: 10 } },
  summary: { ticketCount: 0, voidCount: 0, gross: 0, byMethod: {} },
};

afterEach(() => {
  cleanup();
  context.can = true;
  context.page.data.openShift = null;
  vi.unstubAllGlobals();
});

describe('shift dialogs mounted once by the layout', () => {
  it('opens the open-shift dialog from the banner when no shift is open', async () => {
    render(Host);
    await fireEvent.click(screen.getAllByRole('button', { name: m.pos_shift_open_cta() })[0]);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(document.querySelectorAll('dialog[data-part="positioner"]')).toHaveLength(2); // open + close, exactly once
  });

  it('opens the close dialog when a shift is open', async () => {
    context.page.data.openShift = openShift;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    render(Host);
    await fireEvent.click(screen.getAllByRole('button', { name: m.pos_shift_close_cta() })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('data-size')).toBe('lg');
  });

  it('opens nothing without pos:edit', async () => {
    context.can = false;
    render(Host);
    expect(screen.queryAllByRole('button', { name: m.pos_shift_open_cta() })).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders no action buttons without the layout context', () => {
    render(ShiftBanner);
    expect(screen.queryAllByRole('button', { name: m.pos_shift_open_cta() })).toHaveLength(0);
  });
});
