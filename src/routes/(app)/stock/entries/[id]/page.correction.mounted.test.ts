// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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
    data: {
      user: { id: 'actor-a', supabaseId: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b' },
      activeOrgId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a',
    },
  },
}));
const invalidate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$app/navigation', () => ({ invalidate, goto: vi.fn(), afterNavigate: vi.fn() }));
const can = vi.hoisted(() => ({ manage: true }));
vi.mock('$lib/access/can.svelte', () => ({
  canAct: (_m: string, a: string) => (a === 'manage' ? can.manage : true),
  canViewPath: () => true,
}));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ENTRY = U(10);
const line = (id: string, itemId: string, label: string) => ({
  id,
  itemId,
  itemLabel: label,
  itemUom: 'box',
  uom: null,
  qty: '10.0000',
  rate: '5.0000',
  fromWarehouseId: null,
  fromWarehouseName: null,
  toWarehouseId: U(30),
  toWarehouseName: 'Main',
});
const base = {
  entry: {
    id: ENTRY,
    humanId: 'REC-1',
    type: 'receipt',
    status: 'submitted',
    note: null,
    metadata: {},
    createdAt: new Date('2026-11-01T10:00:00Z'),
    postedAt: new Date('2026-11-01T10:00:00Z'),
  },
  replacementEntryId: null,
  partyName: null,
  lines: [line(U(21), U(41), 'A-1 — Gauze'), line(U(22), U(42), 'B-2 — Tape')],
};
const data = base as unknown as ComponentProps<typeof Entry>['data'];

const PREVIEW = {
  schemaVersion: 1,
  eligible: true,
  blockers: [],
  previewHash: 'a'.repeat(64),
  payloadHash: 'b'.repeat(64),
  quantityEffects: [{ itemId: U(41), before: '10.0000', after: '8' }],
  cost: { lines: [{ lineId: U(21), kind: 'qty', before: '10.0000', after: '8' }] },
};
let preview: () => Response;
let apply: (b: Record<string, unknown>) => Response;
const defaultFetch = async (url: string, init?: RequestInit) =>
  init?.method !== 'POST'
    ? String(url).startsWith('/api/stock/corrections')
      ? Response.json({ outcome: 'not_found' })
      : Response.json({ attachments: [] })
    : url.endsWith('/preview')
      ? preview()
      : apply(JSON.parse(String(init.body)));
const fetchMock = vi.fn(defaultFetch);

beforeEach(() => {
  can.manage = true;
  preview = () => Response.json(PREVIEW);
  apply = (b) =>
    Response.json({
      schemaVersion: 1,
      outcome: 'applied',
      replayed: false,
      receipt: { operationKey: b.operationKey, sourceId: ENTRY },
    });
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  localStorage.clear();
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const open = async (d = data) => {
  render(Entry, { data: d });
  await fireEvent.click(screen.getByRole('button', { name: m.stock_corr_receipt_action() }));
};
const type = (label: string, i: number, value: string) =>
  fireEvent.input(screen.getAllByLabelText(label)[i], { target: { value } });
const review = async () => {
  await fireEvent.input(screen.getByLabelText(new RegExp(m.stock_corr_reason_label())), {
    target: { value: 'counted 8' },
  });
  await fireEvent.click(screen.getByRole('button', { name: m.stock_corr_preview() }));
  await waitFor(() => screen.getByRole('button', { name: m.stock_corr_confirm() }));
};
const posts = (suffix?: string) =>
  fetchMock.mock.calls.filter(
    ([u, i]) =>
      i?.method === 'POST' &&
      (suffix ? String(u).endsWith(suffix) : !String(u).endsWith('/preview')),
  );

it('offers the correction only to a stock manager on a standalone submitted receipt', () => {
  can.manage = false;
  expect(
    render(Entry, { data }).queryByRole('button', { name: m.stock_corr_receipt_action() }),
  ).toBeNull();
  cleanup();
  can.manage = true;
  const linked = {
    ...base,
    entry: { ...base.entry, metadata: { source: 'pos', sourceId: 't1' } },
  } as unknown as typeof data;
  expect(
    render(Entry, { data: linked }).queryByRole('button', { name: m.stock_corr_receipt_action() }),
  ).toBeNull();
});

it('previews with the reason, then confirms with the stable key and the previewed hashes', async () => {
  await open();
  // Nothing changed yet: no review possible.
  expect(screen.getByText(m.stock_corr_receipt_nochange())).toBeTruthy();
  await type(m.stock_corr_receipt_qty(), 0, '8');
  // One change per line: the rate of that line is locked.
  expect(
    (screen.getAllByLabelText(m.stock_corr_receipt_rate())[0] as HTMLInputElement).disabled,
  ).toBe(true);
  await review();
  expect(
    screen.getByText(
      m.stock_corr_effect_row({ item: 'A-1 — Gauze', before: '10.0000', after: '8' }),
    ),
  ).toBeTruthy();
  const [, previewInit] = posts('/preview')[0]!;
  const sent = JSON.parse(String(previewInit!.body));
  expect(sent.reason).toBe('counted 8');
  expect(sent.request).toMatchObject({
    mode: 'receipt_replace',
    sourceType: 'stock_receipt',
    sourceId: ENTRY,
  });
  expect(sent.request.replacement.lines[0]).toEqual({
    originalLineId: U(21),
    itemId: U(41),
    qty: '8',
    rate: '5.0000',
    uom: 'box',
    toWarehouseId: U(30),
  });
  await fireEvent.click(screen.getByRole('button', { name: m.stock_corr_confirm() }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith('stock:entry-detail'));
  const body = JSON.parse(String(posts('/api/stock/corrections')[0]![1]!.body));
  expect(body).toMatchObject({
    reason: 'counted 8',
    previewHash: 'a'.repeat(64),
    payloadHash: 'b'.repeat(64),
  });
  expect(body.operationKey).toMatch(/^[0-9a-f-]{36}$/);
});

it('a refusal names its next step and clears the pointer', async () => {
  apply = () =>
    Response.json(
      { code: 'dependent_history', error: 'x', outcome: 'not_applied' },
      { status: 422 },
    );
  await open();
  await type(m.stock_corr_receipt_rate(), 1, '6');
  expect(screen.getByText(m.stock_corr_receipt_owner_only())).toBeTruthy();
  await review();
  await fireEvent.click(screen.getByRole('button', { name: m.stock_corr_confirm() }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(m.stock_corr_err_dependent_history()),
  );
  expect(Object.keys(localStorage).filter((k) => k.startsWith('minion:stock-correction'))).toEqual(
    [],
  );
  expect(invalidate).not.toHaveBeenCalled();
});

it('a cost-hidden preview says so and a blocked one cannot be confirmed', async () => {
  preview = () =>
    Response.json({
      ...PREVIEW,
      cost: null,
      eligible: false,
      blockers: ['cost_visibility_required'],
    });
  await open();
  await type(m.stock_corr_receipt_qty(), 0, '9');
  await review().catch(() => {});
  await waitFor(() => screen.getByText(m.stock_corr_cost_hidden()));
  expect(screen.getByText(m.stock_corr_err_cost_visibility_required())).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: m.stock_corr_confirm() }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('a lost answer keeps the receipt blocked until the server says what happened, with zero second write', async () => {
  apply = () => {
    throw new TypeError('offline');
  };
  await open();
  await type(m.stock_corr_receipt_qty(), 0, '9');
  await review();
  await fireEvent.click(screen.getByRole('button', { name: m.stock_corr_confirm() }));
  await waitFor(() => screen.getByText(m.stock_corr_pending_title()));
  expect(screen.queryByRole('button', { name: m.stock_corr_confirm() })).toBeNull();
  expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/stock/corrections?'))).toBe(
    true,
  );
  expect(posts('/api/stock/corrections')).toHaveLength(1);
});

it('links the corrected receipt to its replacement and the replacement to its original', () => {
  const replaced = { ...base, replacementEntryId: U(11) } as unknown as typeof data;
  const v1 = render(Entry, { data: replaced });
  expect(v1.getByText(m.stock_corr_receipt_replacement_link()).getAttribute('href')).toBe(
    `/stock/entries/${U(11)}`,
  );
  expect(v1.queryByRole('button', { name: m.stock_corr_receipt_action() })).toBeNull();
  cleanup();
  const replacement = {
    ...base,
    entry: { ...base.entry, metadata: { correctionOf: U(9) } },
  } as unknown as typeof data;
  const v2 = render(Entry, { data: replacement });
  expect(v2.getByText(m.stock_corr_receipt_original_link()).getAttribute('href')).toBe(
    `/stock/entries/${U(9)}`,
  );
});

it('a locked receipt shows every reason and who can unlock, and the action is disabled (spec 140)', () => {
  const locked = {
    ...base,
    isOwner: false,
    lock: {
      locked: true,
      unlock: null,
      rules: [
        { rule: 'days', kind: 'days', unlockable: true, days: 60 },
        {
          rule: 'webhook',
          kind: 'webhook_date',
          unlockable: true,
          label: 'Contabilidad',
          upTo: '2026-10-31',
          lockId: 'l1',
          lockedAt: '2026-11-05T14:00:00.000Z',
        },
      ],
    },
  } as unknown as typeof data;
  const v = render(Entry, { data: locked });
  const notice = v.getByTestId('lock-notice');
  expect(notice.textContent).toContain(m.record_locks_reason_days({ days: 60 }));
  expect(notice.textContent).toContain('Contabilidad');
  expect(notice.textContent).toContain(m.record_locks_notice_ask_owner());
  expect(
    (v.getByRole('button', { name: m.stock_corr_receipt_action() }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('a closed current month cannot be unlocked: the notice says to reopen the month', () => {
  const locked = {
    ...base,
    lock: {
      locked: true,
      unlock: null,
      rules: [{ rule: 'month', kind: 'month_current', unlockable: false, period: '2026-11' }],
    },
  } as unknown as typeof data;
  const v = render(Entry, { data: locked });
  expect(v.getByTestId('lock-notice').textContent).toContain(m.record_locks_notice_reopen_month());
});

it('an unlocked receipt shows no notice and keeps the action enabled', () => {
  const free = {
    ...base,
    lock: { locked: false, rules: [], unlock: null },
  } as unknown as typeof data;
  const v = render(Entry, { data: free });
  expect(v.queryByTestId('lock-notice')).toBeNull();
  expect(
    (v.getByRole('button', { name: m.stock_corr_receipt_action() }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it('a refusal that names the locks shows each rule before the next step', async () => {
  preview = () =>
    Response.json(
      {
        code: 'record_locked',
        outcome: 'not_applied',
        locks: [{ rule: 'days', kind: 'days', unlockable: true, days: 60 }],
        unlockBy: 'owner',
      },
      { status: 422 },
    );
  await open();
  await type(m.stock_corr_receipt_qty(), 0, '8');
  await fireEvent.input(screen.getByLabelText(new RegExp(m.stock_corr_reason_label())), {
    target: { value: 'counted 8' },
  });
  await fireEvent.click(screen.getByRole('button', { name: m.stock_corr_preview() }));
  await waitFor(() =>
    screen.getByText((t) => t.includes(m.record_locks_reason_days({ days: 60 }))),
  );
  expect(screen.getByText((t) => t.includes(m.stock_corr_err_record_locked()))).toBeTruthy();
});
