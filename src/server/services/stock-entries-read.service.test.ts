import { describe, it, expect } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  listEntryLineSummaries,
  buildEntriesPage,
  buildLedgerPage,
  listEntriesPage,
  listItemLedgerPage,
  makeMovementQ,
  MovementError,
  type MovementAdmission,
} from './stock-entries-read.service';
import type { CoreTx } from '$server/db/with-org-core';
import type { SQL } from 'drizzle-orm';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('listEntryLineSummaries', () => {
  it('returns an empty map without a query when no ids are given', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([]);
    const out = await listEntryLineSummaries(ctx(db), []);
    expect(out.size).toBe(0);
  });

  it('pairs the grouped count with the first line (by lineNo) per entry', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { entryId: 'e1', count: 2 },
        { entryId: 'e2', count: 1 },
      ],
      [
        { entryId: 'e1', fromWarehouseId: 'w1', toWarehouseId: null },
        { entryId: 'e1', fromWarehouseId: 'w2', toWarehouseId: null },
        { entryId: 'e2', fromWarehouseId: null, toWarehouseId: 'w3' },
      ],
    ]);
    const out = await listEntryLineSummaries(ctx(db), ['e1', 'e2']);
    expect(out.get('e1')).toEqual({
      lineCount: 2,
      firstFromWarehouseId: 'w1',
      firstToWarehouseId: null,
    });
    expect(out.get('e2')).toEqual({
      lineCount: 1,
      firstFromWarehouseId: null,
      firstToWarehouseId: 'w3',
    });
  });

  it('defaults an entry with no line rows to a zero count', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]);
    const out = await listEntryLineSummaries(ctx(db), ['e9']);
    expect(out.get('e9')).toEqual({
      lineCount: 0,
      firstFromWarehouseId: null,
      firstToWarehouseId: null,
    });
  });
});

// ── spec 125 movement readers ────────────────────────────────────────────────
const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const I1 = '33333333-3333-4333-8333-333333333333';
const I2 = '44444444-4444-4444-8444-444444444444';
const W1 = '55555555-5555-4555-8555-555555555555';
const adm: MovementAdmission = {
  ctx: { db: {} as never, tenantId: 'org-1' },
  source: { ticket: false, invoice: false, purchase: false, booking: false },
  crm: false,
  partyScope: {},
};
const fakeQ = (results: unknown[][], max?: number) => {
  const sqls: SQL[] = [];
  const q = makeMovementQ(
    async (query) => {
      sqls.push(query);
      return results.shift() ?? [];
    },
    0,
    max,
  );
  return { q, sqls };
};
const tx = {} as CoreTx;
const entryRow = (id: string, extra = {}) => ({
  id,
  type: 'issue',
  status: 'submitted',
  partyId: null,
  createdAt: '2026-11-10T10:00:00.000001Z',
  postedAt: null,
  octets: 0,
  md: {},
  ...extra,
});

describe('buildEntriesPage', () => {
  const happy = (lineTotal = 3) => [
    [entryRow(E1), entryRow(E2)],
    [{ n: 2 }],
    [{ entryId: E1, n: lineTotal, from: W1, to: null, uom: 4 }],
    [{ id: E1, n: 2 }],
    [
      {
        id: 'l1',
        entryId: E1,
        lineNo: 0,
        itemId: I1,
        qty: '2',
        uom: 'caja',
        rate: '12.3456789',
        from: W1,
        to: null,
      },
      {
        id: 'l2',
        entryId: E1,
        lineNo: 1,
        itemId: I2,
        qty: '1.500',
        uom: null,
        rate: null,
        from: W1,
        to: null,
      },
      {
        id: 'l3',
        entryId: E1,
        lineNo: 2,
        itemId: I1,
        qty: '1',
        uom: null,
        rate: null,
        from: W1,
        to: null,
      },
    ],
    [{ n: 40 }],
    [{ n: 10 }],
    [
      { id: I1, code: 'FAJ-M', name: 'Faja M' },
      { id: I2, code: 'FAJ-L', name: 'Faja L' },
    ],
    [{ id: W1, name: 'Main' }],
    [
      { id: E1, humanId: 'STE-1', note: 'hi' },
      { id: E2, humanId: null, note: null },
    ],
  ];

  it('full projection: first item, additional count, search text, dictionaries only for admitted ids', async () => {
    const { q } = fakeQ(happy());
    const { movements, warehouseCount } = await buildEntriesPage(q, tx, adm, {
      after: null,
      partyId: null,
    });
    expect(warehouseCount).toBe(2);
    if (movements.projection !== 'full') throw new Error('expected full');
    const row = movements.rows[0];
    expect(row.itemSummary.first?.name).toBe('Faja M');
    expect(row.itemSummary.additionalItemCount).toBe(1); // repeated line for I1 is not a new item
    expect(row.itemSearchText).toContain('FAJ-L');
    expect(row.lines.map((l) => l.qty)).toEqual(['2', '1.500', '1']); // exact strings
    expect(Object.keys(movements.itemsById).sort()).toEqual([I1, I2].sort());
    expect(row.partyState).toBe('missing');
    expect(row.sourceState).toBe('missing');
    expect(movements.nextCursor).toBeNull();
    expect(movements.rows[1].lines).toEqual([]);
  });

  it('51st row yields nextCursor from the 50th and trims the page', async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      entryRow(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    );
    const { q } = fakeQ([rows, [{ n: 1 }], [], []]);
    const { movements } = await buildEntriesPage(q, tx, adm, { after: null, partyId: null });
    expect(movements.projection).toBe('full');
    expect(movements.rows).toHaveLength(50);
    expect(JSON.parse(Buffer.from(movements.nextCursor!, 'base64url').toString())).toMatchObject({
      id: '00000000-0000-4000-8000-000000000049',
      partyId: null,
    });
  });

  it('falls back to base_values_only above 10000 lines without fetching lines', async () => {
    const r = happy(10001);
    const { q, sqls } = fakeQ(r);
    const { movements } = await buildEntriesPage(q, tx, adm, { after: null, partyId: null });
    expect(movements.projection).toBe('base_values_only');
    expect(movements.enrichmentAvailability).toBe('unavailable');
    expect(movements).not.toHaveProperty('itemsById');
    expect(Object.keys(movements.rows[0]).sort()).toEqual([
      'attachmentCount',
      'createdAt',
      'entryHref',
      'entryId',
      'firstFromWarehouseId',
      'firstToWarehouseId',
      'lineCount',
      'postedAt',
      'status',
      'type',
    ]);
    expect(sqls).toHaveLength(4);
  });

  it('falls back above 1048576 selected-string octets (note bytes count)', async () => {
    const r = happy();
    r[0] = [entryRow(E1, { octets: 1048577 })];
    const { q } = fakeQ(r);
    const { movements } = await buildEntriesPage(q, tx, adm, { after: null, partyId: null });
    expect(movements.projection).toBe('base_values_only');
  });

  it('refuses the 41st statement before executing it', async () => {
    const { q } = fakeQ([], 3);
    await q({} as SQL);
    await q({} as SQL);
    await q({} as SQL);
    await expect(q({} as SQL)).rejects.toMatchObject({ code: 'movement_statement_budget' });
  });
});

describe('cursor validation', () => {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  it('rejects malformed, extra-key and party-mismatched cursors with 400', async () => {
    const ctx = adm.ctx;
    for (const cursor of [
      'not-json',
      enc({ createdAt: '2026-11-10T10:00:00Z', id: E1, partyId: null }),
      enc({ createdAt: '2026-11-10T10:00:00.000001Z', id: E1, partyId: null, x: 1 }),
      enc({ createdAt: '2026-11-10T10:00:00.000001Z', id: E1, partyId: E2 }),
    ])
      await expect(listEntriesPage(ctx, adm, { cursor })).rejects.toMatchObject({ status: 400 });
    await expect(listEntriesPage(ctx, adm, { partyId: 'nope' })).rejects.toBeInstanceOf(
      MovementError,
    );
  });
  it('rejects a ledger cursor for another item or beyond bigint', async () => {
    const ok = { postedAt: '2026-11-10T10:00:00.000001Z', itemId: I1 };
    await expect(
      listItemLedgerPage(adm.ctx, adm, {
        itemId: I1,
        cursor: enc({ ...ok, seq: '9223372036854775808' }),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listItemLedgerPage(adm.ctx, adm, { itemId: I2, cursor: enc({ ...ok, seq: '5' }) }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('buildLedgerPage', () => {
  const led = (id: string) => ({
    ledgerId: id,
    entryId: E1,
    itemId: I1,
    warehouseId: W1,
    postedAt: '2026-11-10T10:00:00.000001Z',
    qtyDelta: '-2.50',
    qtyAfter: '7.5',
    valuationRate: '1.2000000001',
    valueDelta: '-3.0000000003',
  });
  it('keeps unsafe bigint ids as strings, duplicate entry rows distinct, and current unit separate', async () => {
    const big = '9007199254740993';
    const { q } = fakeQ([
      [led(big), led('9007199254740994')],
      [{ n: 5 }],
      [{ n: 9 }],
      [{ n: 4 }],
      [{ id: E1, humanId: 'STE-1', type: 'transfer', partyId: null, md: {} }],
      [{ id: I1, code: 'C', name: 'N', uom: 'caja' }],
      [{ id: W1, name: 'Main' }],
    ]);
    const res = await buildLedgerPage(q, tx, adm, {
      surface: 'item_ledger',
      itemId: I1,
      after: null,
    });
    if (res.projection !== 'full') throw new Error('full expected');
    expect(res.rows.map((r) => r.ledgerId)).toEqual([big, '9007199254740994']);
    expect(res.rows[0].movementKind).toBe('transfer');
    expect(res.rows[0].qtyDelta).toBe('-2.50');
    expect(res.rows[0].stockUnit).toEqual({
      currentItemUom: 'caja',
      currentState: 'available',
      historicalUom: null,
      historicalState: 'not_recorded',
    });
    expect(res.rows[0].warehouseName).toBe('Main');
  });
  it('falls back to base_values_only keeping numeric strings when text exceeds budget', async () => {
    const { q } = fakeQ([[led('1')], [{ n: 1048577 }], [{ n: 0 }], [{ n: 0 }]]);
    const res = await buildLedgerPage(q, tx, adm, { surface: 'recent', itemId: null, after: null });
    expect(res.projection).toBe('base_values_only');
    expect(res.rows[0]).toMatchObject({ qtyAfter: '7.5', ledgerId: '1' });
    expect(res.rows[0]).not.toHaveProperty('stockUnit');
    expect(res.nextCursor).toBeNull();
  });
});
