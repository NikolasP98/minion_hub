import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  accrueConsumption,
  releaseAccruals,
  resolveDefaultWarehouse,
  realizeAccruals,
  accrualSummaryForSources,
  stockAnchorForBookings,
  stockRecoveryForBookings,
  listRecoveryOpenAccrualsInTx,
  RecoveryPreviewStaleError,
  RecoveryForbiddenError,
  availableToPromise,
} from './stock-accruals.service';

const caps = vi.hoisted(() => ({ granted: new Set<string>(), fresh: vi.fn() }));
vi.mock('./rbac.service', () => ({
  resolveFreshCapabilitiesInTransaction: (...a: unknown[]) => caps.fresh(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  caps.granted = new Set(['scheduling:edit', 'pos:edit', 'stock:view', 'stock:manage']);
  caps.fresh.mockImplementation(async () => ({
    capabilities: { can: (m: string, a: string) => caps.granted.has(`${m}:${a}`) },
  }));
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('resolveDefaultWarehouse', () => {
  it('prefers the flagged default over the earliest-created', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { id: 'w-old', isDefault: false },
        { id: 'w-def', isDefault: true },
      ],
    ]);
    expect(await resolveDefaultWarehouse(ctx(db))).toBe('w-def');
  });
  it('falls back to the earliest-created; null when no warehouses', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'w-old', isDefault: false }], []]);
    expect(await resolveDefaultWarehouse(ctx(db))).toBe('w-old');
    expect(await resolveDefaultWarehouse(ctx(db))).toBeNull();
  });
});

describe('accrueConsumption', () => {
  it('accrues explicit lines with server-side uom conversion and bin-rate cost', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing accruals for source (none)
      [{ id: 'w1', isDefault: true }], // warehouses (default resolution)
      [], // stk_item_components (Slice 1b) — none, so the explosion is the identity
      [{ id: 'i1', unitsPerStockUom: '500' }], // items (500 ml per caja)
      [{ itemId: 'i1', valuationRate: '100' }], // bins (S/100 per caja)
      [], // delete open rows
      [], // insert new rows
    ]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'i1', qtyConsumption: 5 }], // 5 ml → 0.01 caja → est S/1
    });
    expect(n).toBe(1);
    expect(db.insert).toHaveBeenCalled();
  });

  it('computes defaults from stk_consumption when no lines are passed', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing accruals
      [{ id: 'w1', isDefault: false }], // warehouses
      [{ itemId: 'i1', qtyPerUnit: '2' }], // mapping: 2 per unit
      [], // stk_item_components (Slice 1b) — none
      [{ id: 'i1', unitsPerStockUom: null }], // item (no conversion)
      [], // bins (no bin yet → cost 0)
      [], // delete
      [], // insert
    ]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
    });
    expect(n).toBe(1);
  });

  it('is a no-op when the source is already settled (realized rows exist)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'a1', status: 'realized' }]]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'i1', qtyConsumption: 5 }],
    });
    expect(n).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('is a no-op when the org has no warehouses', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]); // no accruals, no warehouses
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'i1', qtyConsumption: 5 }],
    });
    expect(n).toBe(0);
  });

  it('is a no-op for an unmapped product (no lines, empty stk_consumption)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], [{ id: 'w1', isDefault: true }], []]); // no accruals, warehouse, empty mapping
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
    });
    expect(n).toBe(0);
  });

  it('all-unknown item lines → no-op, does NOT wipe the existing open set', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing accruals
      [{ id: 'w1', isDefault: true }], // warehouses
      [], // items lookup — none of the line items exist
      [], // bins
    ]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'ghost', qtyConsumption: 5 }],
    });
    expect(n).toBe(0);
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('releaseAccruals', () => {
  it('flips only open rows and reports the count', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'a1' }, { id: 'a2' }]]); // update(...).returning()
    const n = await releaseAccruals(ctx(db), 'booking', 'b1');
    expect(n).toBe(2);
    expect(db.update).toHaveBeenCalled();
  });
});

const actor = { id: 'u1', name: 'Test User' };

describe('accrueConsumption — 0-qty mappings (spec 033)', () => {
  it('defaults path skips a 0 mapping and accrues the rest', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing accruals
      [{ id: 'w1', isDefault: false }], // warehouses
      [
        { itemId: 'i1', qtyPerUnit: '30' },
        { itemId: 'i2', qtyPerUnit: '0' },
      ], // mapping
      [], // stk_item_components
      [{ id: 'i1', unitsPerStockUom: null }], // items (only i1 survives the filter)
      [], // bins
      [], // delete
      [], // insert
    ]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
    });
    expect(n).toBe(1);
  });

  it('a product mapped only at 0 accrues nothing', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing accruals
      [{ id: 'w1', isDefault: false }], // warehouses
      [{ itemId: 'i2', qtyPerUnit: '0' }], // mapping
    ]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
    });
    expect(n).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('realizeAccruals', () => {
  it('lines: [] with no entry releases the open accruals and books nothing', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        {
          id: 'a1',
          itemId: 'i1',
          qty: '1',
          qtyConsumption: '30',
          finProductId: 'p1',
          warehouseId: 'w1',
        },
      ], // open accruals
      [], // findEntryBySource
      [], // release update
    ]);
    const r = await realizeAccruals(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      lines: [],
      actor,
    });
    expect(r).toEqual({ entry: null, realized: 0, stockWarning: null });
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('no open accruals + no lines → clean no-op', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // open accruals
      [], // findEntryBySource
    ]);
    const r = await realizeAccruals(ctx(db), { source: 'booking', sourceId: 'b1', actor });
    expect(r).toEqual({ entry: null, realized: 0, stockWarning: null });
  });

  it('a pre-existing SUBMITTED entry heals accruals without a second issue (idempotent retry)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        {
          id: 'a1',
          itemId: 'i1',
          qty: '0.01',
          qtyConsumption: '5',
          finProductId: 'p1',
          warehouseId: 'w1',
        },
      ], // open accruals
      [{ id: 'e1', orgId: 'org-1', status: 'submitted', type: 'issue' }], // findEntryBySource
      [{ itemId: 'i1', qtyDelta: '-0.01', valueDelta: '-1' }], // ledger rows for e1
      [], // update accrual a1 → realized
    ]);
    const r = await realizeAccruals(ctx(db), { source: 'booking', sourceId: 'b1', actor });
    expect(r.entry?.id).toBe('e1');
    expect(r.realized).toBe(1);
    expect(r.stockWarning).toBeNull();
  });

  it('a draft that fails to submit returns stockWarning, leaves accruals open (negative-stock completion path)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        {
          id: 'a1',
          itemId: 'i1',
          qty: '10',
          qtyConsumption: '10',
          finProductId: 'p1',
          warehouseId: 'w1',
        },
      ], // open accruals
      [{ id: 'e1', orgId: 'org-1', status: 'draft', type: 'issue' }], // findEntryBySource → draft
      // submitEntry's internal sequence:
      [{ id: 'e1', orgId: 'org-1', status: 'draft', type: 'issue', humanId: null }], // entry for update
      [
        {
          id: 'l1',
          entryId: 'e1',
          itemId: 'i1',
          qty: '10',
          uom: null,
          rate: null,
          fromWarehouseId: 'w1',
          toWarehouseId: null,
          lineNo: 0,
        },
      ], // lines
      [{ id: 'i1' }], // item existence
      [{ id: 'w1' }], // warehouse existence
      [{ qty: '2', valuationRate: '1' }], // bin: only 2 in stock → negative_stock
    ]);
    const r = await realizeAccruals(ctx(db), { source: 'booking', sourceId: 'b1', actor });
    expect(r.stockWarning).toMatchObject({ code: 'negative_stock', draftEntryId: 'e1' });
    expect(r.realized).toBe(0);
    expect(db.update).not.toHaveBeenCalled(); // accruals untouched — still open
  });

  it('a duplicate_source race in the create branch degrades to stockWarning, not a throw', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        {
          id: 'a1',
          itemId: 'i1',
          qty: '0.01',
          qtyConsumption: '5',
          finProductId: 'p1',
          warehouseId: 'w1',
        },
      ], // open accruals
      [], // findEntryBySource → none (the race window)
      // createServiceIssue's internal sequence:
      [{ id: 'p1', name: 'Botox' }], // product lookup
      [{ id: 'e-race' }], // dup guard FINDS the racing entry → StockError('duplicate_source')
    ]);
    const r = await realizeAccruals(ctx(db), { source: 'booking', sourceId: 'b1', actor });
    expect(r.stockWarning).toMatchObject({ code: 'duplicate_source' });
    expect(r.realized).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe('accrualSummaryForSources', () => {
  it('folds per-source status counts and values', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        {
          sourceId: 'b1',
          status: 'open',
          estValue: '10',
          realizedValue: null,
          realizedEntryId: null,
        },
        {
          sourceId: 'b1',
          status: 'open',
          estValue: '5',
          realizedValue: null,
          realizedEntryId: null,
        },
        {
          sourceId: 'b2',
          status: 'realized',
          estValue: '7',
          realizedValue: '8',
          realizedEntryId: 'e1',
        },
      ],
    ]);
    const out = await accrualSummaryForSources(ctx(db), 'booking', ['b1', 'b2']);
    const b1 = out.find((s) => s.sourceId === 'b1')!;
    const b2 = out.find((s) => s.sourceId === 'b2')!;
    expect(b1).toMatchObject({ open: 2, realized: 0, estValue: 15 });
    expect(b2).toMatchObject({ open: 0, realized: 1, realizedValue: 8, realizedEntryId: 'e1' });
  });
  it('returns [] for an empty id list without querying', async () => {
    const { db } = createMockDb();
    expect(await accrualSummaryForSources(ctx(db), 'booking', [])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('availableToPromise', () => {
  it('bin qty minus open committed qty', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ qty: '10' }], // bin
      [{ total: '3' }], // open accruals sum
    ]);
    expect(await availableToPromise(ctx(db), 'i1', 'w1')).toBe(7);
  });
});

describe('stockAnchorForBookings (spec 126)', () => {
  it('asks nothing for no anchors and refuses more than 1,000', async () => {
    const { db } = createMockDb();
    expect((await stockAnchorForBookings(ctx(db), [])).size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
    await expect(
      stockAnchorForBookings(
        ctx(db),
        Array.from({ length: 1001 }, (_, i) => `b${i}`),
      ),
    ).rejects.toThrow('capacity');
  });

  it('counts per anchor without any cost field; an anchor with no rows is absent, not zero-filled', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { sourceId: 'a1', status: 'open', realizedEntryId: null },
        { sourceId: 'a1', status: 'released', realizedEntryId: null },
        { sourceId: 'a2', status: 'realized', realizedEntryId: 'e1' },
        { sourceId: 'a2', status: 'realized', realizedEntryId: 'e1' },
      ],
    ]);
    const out = await stockAnchorForBookings(ctx(db), ['a1', 'a2', 'a3']);
    expect(out.get('a1')).toEqual({ open: 1, realized: 0, released: 1, realizedEntryId: null });
    expect(out.get('a2')).toEqual({ open: 0, realized: 2, released: 0, realizedEntryId: 'e1' });
    expect(out.has('a3')).toBe(false);
    expect(JSON.stringify([...out.values()])).not.toMatch(/value|cost|est/i);
  });

  it('never picks an arbitrary first link when several distinct entries realized the anchor', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { sourceId: 'a1', status: 'realized', realizedEntryId: 'e1' },
        { sourceId: 'a1', status: 'realized', realizedEntryId: 'e2' },
      ],
    ]);
    expect((await stockAnchorForBookings(ctx(db), ['a1'])).get('a1')).toEqual({
      open: 0,
      realized: 2,
      released: 0,
      realizedEntryId: null,
    });
  });

  it('lets a failed read throw — the caller maps it to unavailable, never to no accrual', async () => {
    const { db } = createMockDb();
    (db.select as unknown as { mockImplementation: (f: () => never) => void }).mockImplementation(
      () => {
        throw new Error('boom');
      },
    );
    await expect(stockAnchorForBookings(ctx(db), ['a1'])).rejects.toThrow('boom');
  });
});

// ── Spec 126 US2 ─────────────────────────────────────────────────────────────

const openRow = (
  id: string,
  over: Record<string, unknown> = {},
  itemName: string | null = 'Faja',
) => ({
  accrual: {
    id,
    itemId: `i-${id}`,
    status: 'open',
    qty: '1',
    qtyConsumption: '30',
    warehouseId: 'w1',
    ...over,
  },
  itemName,
  itemUom: 'u',
  consumptionUom: 'ml',
  unitsPerStockUom: '500',
  subunitsPerStockUom: null,
  diagramEnabled: false,
});

describe('stockRecoveryForBookings', () => {
  const acc = (sourceId: string, status: string) => ({ sourceId, status });
  const entry = (sourceId: string, status: string, id = `e-${sourceId}`) => ({
    id,
    status,
    sourceId,
  });

  it('asks nothing for no members', async () => {
    const { db } = createMockDb();
    expect(await stockRecoveryForBookings(ctx(db), [])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('decides each member from persisted facts only', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        acc('draft', 'open'),
        acc('subopen', 'open'),
        acc('subdone', 'realized'),
        acc('fresh', 'open'),
        acc('fresh', 'open'),
        acc('pending', 'open'),
        acc('dup', 'open'),
        acc('released', 'released'),
      ],
      [
        entry('draft', 'draft'),
        entry('subopen', 'submitted'),
        entry('subdone', 'submitted'),
        entry('dup', 'draft', 'e1'),
        entry('dup', 'submitted', 'e2'),
      ],
      [openRow('a1'), openRow('a2')], // confirm_open set of `fresh`
    ]);
    const out = await stockRecoveryForBookings(
      ctx(db),
      ['draft', 'subopen', 'subdone', 'fresh', 'none', 'pending', 'dup', 'released'].map(
        (bookingId) => ({
          bookingId,
          status: bookingId === 'pending' ? 'accepted' : 'completed',
        }),
      ),
    );
    const by = Object.fromEntries(out.map((r) => [r.bookingId, r]));
    expect(Object.fromEntries(out.map((r) => [r.bookingId, r.eligibility]))).toEqual({
      draft: 'retry_saved',
      subopen: 'retry_saved',
      subdone: 'not_needed',
      fresh: 'confirm_open',
      none: 'manual_review', // no evidence is NOT inferred missing consumption
      pending: 'not_needed', // pending/accepted use the ordinary completion flow
      dup: 'manual_review', // two active source entries: never an arbitrary latest
      released: 'not_needed',
    });
    expect(by.draft!.sourceEntry).toEqual({ id: 'e-draft', status: 'draft' });
    expect(by.fresh!.confirmation).toMatchObject({ state: 'available', value: { openCount: 2 } });
    expect(by.draft!.confirmation).toBeNull();
  });

  it.each([
    ['over 1,000 open rows', Array.from({ length: 1001 }, (_, i) => openRow(`a${i}`)), 1001],
    ['a lost item join', [openRow('a1', {}, null)], 1],
    ['a count that disagrees with the accrual counts', [openRow('a1')], 2],
  ])('does not offer confirmation for %s', async (_n, rows, openAccruals) => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([Array.from({ length: openAccruals }, () => acc('fresh', 'open')), [], rows]);
    const [m] = await stockRecoveryForBookings(ctx(db), [
      { bookingId: 'fresh', status: 'completed' },
    ]);
    expect(m!.eligibility).toBe('manual_review');
    expect(m!.confirmation).toMatchObject({ state: 'unavailable' });
  });
});

describe('listRecoveryOpenAccrualsInTx fingerprint', () => {
  const read = async (rows: unknown[]) => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([rows]);
    return listRecoveryOpenAccrualsInTx(db as never, ctx(db), 'b1');
  };

  it('is stable and changes with any reviewed quantity or conversion fact', async () => {
    const a = await read([openRow('a1'), openRow('a2')]);
    const same = await read([openRow('a1'), openRow('a2')]);
    const qty = await read([openRow('a1'), openRow('a2', { qtyConsumption: '31' })]);
    const dropped = await read([openRow('a1')]);
    const conv = await read([openRow('a1'), { ...openRow('a2'), unitsPerStockUom: '250' }]);
    const fp = (r: Awaited<ReturnType<typeof read>>) =>
      r.state === 'available' ? r.value.expectedOpenFingerprint : null;
    expect(fp(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(fp(same)).toBe(fp(a));
    expect(new Set([fp(a), fp(qty), fp(dropped), fp(conv)]).size).toBe(4);
  });

  it('carries quantities only — no cost or rate field', async () => {
    const r = await read([openRow('a1', { estValue: '99', rate: '5' })]);
    expect(JSON.stringify(r)).not.toMatch(/estValue|realizedValue|rate|cost/i);
  });
});

describe('realizeAccruals recovery precondition', () => {
  const run = async (
    sequence: unknown[][],
    recovery = { expectedOpenCount: 1, expectedOpenFingerprint: 'x' },
  ) => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence(sequence);
    const result = realizeAccruals(
      { ...ctx(db), profileId: 'p1' },
      { source: 'booking', sourceId: 'b1', lines: [], actor, recovery },
    );
    return { db, result };
  };
  const fingerprintOf = async (rows: unknown[]) => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([rows]);
    const r = await listRecoveryOpenAccrualsInTx(db as never, ctx(db), 'b1');
    return r.state === 'available' ? r.value.expectedOpenFingerprint : '';
  };

  it.each([
    ['the booking is no longer completed', [[{ status: 'accepted' }]]],
    ['a source entry appeared', [[{ status: 'completed' }], [{ id: 'e1', status: 'draft' }]]],
    ['the open set changed (wrong fingerprint)', [[{ status: 'completed' }], [], [openRow('a1')]]],
  ])('refuses with no effect when %s', async (_n, seq) => {
    const { db, result } = await run(seq);
    await expect(result).rejects.toBeInstanceOf(RecoveryPreviewStaleError);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('proceeds (a confirmed zero releases the reviewed set) only when count and fingerprint match', async () => {
    const rows = [openRow('a1')];
    const fingerprint = await fingerprintOf(rows);
    const { db, result } = await run(
      [
        [{ status: 'completed' }],
        [], // no source entry
        rows, // current open set
        [
          {
            id: 'a1',
            itemId: 'i-a1',
            qty: '1',
            qtyConsumption: '30',
            finProductId: 'p1',
            warehouseId: 'w1',
          },
        ],
        [], // findEntryBySource
        [], // release update
      ],
      { expectedOpenCount: 1, expectedOpenFingerprint: fingerprint, host: 'scheduling' },
    );
    expect(await result).toEqual({ entry: null, realized: 0, stockWarning: null });
    expect(db.update).toHaveBeenCalled();
  });

  it.each([
    ['scheduling', 'pos:edit', 'scheduling'],
    ['pos', 'scheduling:edit', 'pos'],
  ] as const)(
    'refuses with no effect when the %s host edit right was lost in the transaction (%s alone does not count)',
    async (_h, _other, host) => {
      caps.granted = new Set([_other, 'stock:view', 'stock:manage']);
      const { db, result } = await run([[{ status: 'completed' }]], {
        expectedOpenCount: 1,
        expectedOpenFingerprint: 'x',
        host,
      });
      await expect(result).rejects.toBeInstanceOf(RecoveryForbiddenError);
      expect(db.update).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    },
  );

  it.each(['stock:view', 'stock:manage'])('refuses without %s, with no effect', async (missing) => {
    caps.granted.delete(missing);
    const { db, result } = await run([[{ status: 'completed' }]]);
    await expect(result).rejects.toBeInstanceOf(RecoveryForbiddenError);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('a platform admin skips the capability read (the booking is still re-read)', async () => {
    const { result } = await run([[{ status: 'accepted' }]], {
      expectedOpenCount: 1,
      expectedOpenFingerprint: 'x',
      host: 'pos',
      platformAdmin: true,
    });
    await expect(result).rejects.toBeInstanceOf(RecoveryPreviewStaleError); // reached the booking read
    expect(caps.fresh).not.toHaveBeenCalled();
  });
});
