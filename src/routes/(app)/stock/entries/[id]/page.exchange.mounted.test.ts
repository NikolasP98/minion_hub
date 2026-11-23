// @vitest-environment happy-dom
// Spec 142 — a registered canje reads as two tables: what left ("Entregas")
// and what came in ("Recibes"), each with quantity, unit cost and value.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import Entry from './PageBody.svelte';
import * as m from '$lib/paraglide/messages';

vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/stock'),
    params: {},
    route: { id: '/(app)/stock' },
    state: {},
    data: { user: { id: 'actor-a' }, activeOrgId: 'org-a' },
  },
}));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(), goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true, canViewPath: () => true }));

const line = (id: string, label: string, side: 'out' | 'in') => ({
  id,
  itemId: `item-${id}`,
  itemLabel: label,
  itemUom: 'unit',
  uom: null,
  qty: '20',
  rate: '250',
  fromWarehouseId: side === 'out' ? 'wh' : null,
  fromWarehouseName: side === 'out' ? 'Main' : null,
  toWarehouseId: side === 'in' ? 'wh' : null,
  toWarehouseName: side === 'in' ? 'Main' : null,
});
const data = {
  entry: {
    id: 'entry-1',
    humanId: 'STE-2026-00712',
    type: 'exchange',
    status: 'submitted',
    partyId: 'party-1',
    note: 'Canje de rellenos',
    metadata: {},
    createdAt: new Date('2026-11-25T10:00:00Z'),
    postedAt: new Date('2026-11-25T10:00:00Z'),
  },
  replacementEntryId: null,
  partyName: 'Laboratorio Ejemplo SAC',
  lines: [line('l1', 'FIL — HA Saypha Filler', 'out'), line('l2', 'VOL — HA Saypha Volume', 'in')],
} as unknown as ComponentProps<typeof Entry>['data'];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ attachments: [] })),
  );
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows the canje label, the supplier and both sides with unit cost and value', () => {
  render(Entry, { data });
  expect(screen.getByText(m.stock_type_exchange())).toBeTruthy();
  expect(screen.getByText('Laboratorio Ejemplo SAC')).toBeTruthy();
  const out = screen.getByText(m.stock_exchange_out()).closest('.card') as HTMLElement;
  const inn = screen.getByText(m.stock_exchange_in()).closest('.card') as HTMLElement;
  expect(within(out).getByText('FIL — HA Saypha Filler')).toBeTruthy();
  expect(within(out).queryByText('VOL — HA Saypha Volume')).toBeNull();
  expect(within(inn).getByText('VOL — HA Saypha Volume')).toBeTruthy();
  expect(out.textContent).toMatch(/−20/);
  expect(out.textContent).toMatch(/−S\/\s?5,000\.00/);
  expect(inn.textContent).toMatch(/\+S\/\s?5,000\.00/);
  expect(inn.textContent).toMatch(/250\.00/);
  // The generic lines table is replaced, not duplicated.
  expect(screen.queryByText(m.stock_entry_lines_title())).toBeNull();
});
