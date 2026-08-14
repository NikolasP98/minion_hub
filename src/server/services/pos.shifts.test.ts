import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  getPosSettings,
  updatePosSettings,
  normalizeMethods,
  DEFAULT_POS_SETTINGS,
  openShift,
  closeShift,
  shiftSummary,
  computeExpected,
} from './pos.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const actor = { id: 'u1', name: 'Test User' };

describe('normalizeMethods', () => {
  it('upgrades a legacy string[] row — takesTendered guessed true only for cash', () => {
    expect(normalizeMethods(['cash', 'card'])).toEqual([
      { id: 'cash', label: 'Cash', enabled: true, takesTendered: true, documentDefault: null },
      { id: 'card', label: 'Card', enabled: true, takesTendered: false, documentDefault: null },
    ]);
  });

  it('passes an already-object PaymentMethod[] row through unchanged', () => {
    const methods = [
      { id: 'culqi', label: 'Culqi', enabled: true, takesTendered: false, surcharge: { type: 'percent' as const, amount: 2.56 } },
    ];
    expect(normalizeMethods(methods)).toEqual(methods);
  });

  it('non-array input yields an empty list', () => {
    expect(normalizeMethods(null)).toEqual([]);
    expect(normalizeMethods(undefined)).toEqual([]);
  });
});

describe('getPosSettings / updatePosSettings', () => {
  it('returns DEFAULT_POS_SETTINGS when no row exists', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    expect(await getPosSettings(ctx(db))).toEqual(DEFAULT_POS_SETTINGS);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects an empty methods array', async () => {
    const { db } = createMockDb();
    await expect(updatePosSettings(ctx(db), { methods: [] })).rejects.toMatchObject({
      code: 'invalid_methods',
    });
  });

  it('rejects an uppercase method id', async () => {
    const { db } = createMockDb();
    await expect(
      updatePosSettings(ctx(db), {
        methods: [{ id: 'Cash', label: 'Cash', enabled: true, takesTendered: true }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_methods' });
  });

  it('rejects when every method is disabled', async () => {
    const { db } = createMockDb();
    await expect(
      updatePosSettings(ctx(db), {
        methods: [{ id: 'cash', label: 'Cash', enabled: false, takesTendered: true }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_methods' });
  });

  it('rejects a duplicate method id', async () => {
    const { db } = createMockDb();
    await expect(
      updatePosSettings(ctx(db), {
        methods: [
          { id: 'cash', label: 'Cash', enabled: true, takesTendered: true },
          { id: 'cash', label: 'Cash dup', enabled: true, takesTendered: false },
        ],
      }),
    ).rejects.toMatchObject({ code: 'duplicate_method_id' });
  });

  it('rejects a negative surcharge amount', async () => {
    const { db } = createMockDb();
    await expect(
      updatePosSettings(ctx(db), {
        methods: [
          {
            id: 'card',
            label: 'Card',
            enabled: true,
            takesTendered: false,
            surcharge: { type: 'percent', amount: -1 },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid_surcharge' });
  });

  it('hands out a defensive copy — mutating the result never corrupts the defaults', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]); // two no-row reads
    const first = await getPosSettings(ctx(db));
    first.methods.push({ id: 'hacked', label: 'Hacked', enabled: true, takesTendered: false });
    first.methods[0] = { id: 'stolen', label: 'Stolen', enabled: true, takesTendered: false };
    const second = await getPosSettings(ctx(db));
    expect(second.methods.map((m) => m.id)).toEqual(['cash', 'card', 'yape', 'plin', 'transfer']);
    expect(DEFAULT_POS_SETTINGS.methods.map((m) => m.id)).toEqual([
      'cash',
      'card',
      'yape',
      'plin',
      'transfer',
    ]);
    // the singleton itself is frozen — direct mutation throws
    expect(() =>
      DEFAULT_POS_SETTINGS.methods.push({ id: 'nope', label: 'Nope', enabled: true, takesTendered: false }),
    ).toThrow();
  });
});

describe('computeExpected', () => {
  const methods = DEFAULT_POS_SETTINGS.methods; // cash is the only takesTendered method

  it('folds the cash float into cash only', () => {
    expect(computeExpected({ cash: 35.5, card: 30 }, { cash: 50 }, methods)).toEqual({
      cash: 85.5,
      card: 30,
    });
  });
  it('cash float with zero cash payments still yields expected.cash = float', () => {
    expect(computeExpected({ card: 30 }, { cash: 50 }, methods)).toEqual({ cash: 50, card: 30 });
  });
  it('missing float key → expected.cash is just the payment sum', () => {
    expect(computeExpected({ cash: 12.34 }, {}, methods)).toEqual({ cash: 12.34 });
  });
  it('non-cash float keys are NOT folded into their methods', () => {
    expect(computeExpected({ card: 30 }, { card: 100 }, methods)).toEqual({ cash: 0, card: 30 });
  });
  it('a takesTendered method other than cash also gets its float folded in', () => {
    const custom = [{ id: 'till2', label: 'Till 2', enabled: true, takesTendered: true }];
    expect(computeExpected({ till2: 10 }, { till2: 5 }, custom)).toEqual({ till2: 15 });
  });
  it('a non-takesTendered method never gets a float folded in', () => {
    const custom = [{ id: 'card', label: 'Card', enabled: true, takesTendered: false }];
    expect(computeExpected({ card: 10 }, { card: 999 }, custom)).toEqual({ card: 10 });
  });
});

describe('openShift', () => {
  it('opens a shift when none is open', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // pre-check: no open shift
      [{ id: 's1', orgId: 'org-1', status: 'open', openedBy: 'u1', openingFloat: { cash: 100 } }], // insert returning
    ]);
    const shift = await openShift(ctx(db), { openingFloat: { cash: 100 }, actor });
    expect(shift.id).toBe('s1');
    expect(db.insert).toHaveBeenCalled();
  });

  it('throws shift_already_open when one is already open', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 's0', status: 'open' }]]);
    await expect(openShift(ctx(db), { openingFloat: {}, actor })).rejects.toMatchObject({ code: 'shift_already_open' });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('closeShift', () => {
  it('throws no_open_shift when there is nothing to close', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]); // settings (defaults), load open shift → none
    await expect(closeShift(ctx(db), { counted: {}, actor })).rejects.toMatchObject({ code: 'no_open_shift' });
  });

  it('computes expected = float.cash + Σ cash payments (non-void tickets only), persists counted verbatim', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // settings lookup (defaults — cash is the only takesTendered method)
      [{ id: 's1', orgId: 'org-1', status: 'open', openingFloat: { cash: 50 } }], // load open shift
      [
        { method: 'cash', amount: '25.50' },
        { method: 'cash', amount: '10.00' },
        { method: 'card', amount: '30.00' },
      ], // payments joined to non-void tickets, grouped by method (rows pre-group for the mock)
      [{ id: 's1', orgId: 'org-1', status: 'closed', expected: { cash: 85.5, card: 30 }, counted: { cash: 84, card: 30 } }], // update returning
    ]);
    const closed = await closeShift(ctx(db), { counted: { cash: 84, card: 30 }, note: 'short', actor });
    expect(closed.expected).toEqual({ cash: 85.5, card: 30 });
    expect(closed.counted).toEqual({ cash: 84, card: 30 });
  });
});

describe('shiftSummary', () => {
  it('aggregates byMethod/gross/ticketCount/voidCount — void tickets excluded from money, counted in ticketCount+voidCount', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { method: 'cash', amount: '20.00' },
        { method: 'card', amount: '15.00' },
      ], // payments joined to non-void tickets, grouped by method
      [
        { status: 'submitted', total: '20.00' },
        { status: 'submitted', total: '15.00' },
        { status: 'void', total: '99.00' },
      ], // all tickets for this shift (2 submitted + 1 void)
    ]);
    const summary = await shiftSummary(ctx(db), 's1');
    expect(summary.byMethod).toEqual({ cash: 20, card: 15 });
    expect(summary.gross).toBe(35);
    expect(summary.ticketCount).toBe(3);
    expect(summary.voidCount).toBe(1);
  });
});
