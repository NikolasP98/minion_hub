import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { PosError, getPosSettings, updatePosSettings, DEFAULT_POS_SETTINGS, openShift, closeShift, shiftSummary, computeExpected } from './pos.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const actor = { id: 'u1', name: 'Test User' };

describe('getPosSettings / updatePosSettings', () => {
  it('returns DEFAULT_POS_SETTINGS when no row exists', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    expect(await getPosSettings(ctx(db))).toEqual(DEFAULT_POS_SETTINGS);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects invalid methods', async () => {
    const { db } = createMockDb();
    await expect(updatePosSettings(ctx(db), { methods: [] })).rejects.toMatchObject({ code: 'invalid_methods' });
    await expect(updatePosSettings(ctx(db), { methods: ['Cash'] })).rejects.toMatchObject({ code: 'invalid_methods' });
  });

  it('hands out a defensive copy — mutating the result never corrupts the defaults', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]); // two no-row reads
    const first = await getPosSettings(ctx(db));
    first.methods.push('hacked');
    first.methods[0] = 'stolen';
    const second = await getPosSettings(ctx(db));
    expect(second.methods).toEqual(['cash', 'card', 'yape', 'plin', 'transfer']);
    expect(DEFAULT_POS_SETTINGS.methods).toEqual(['cash', 'card', 'yape', 'plin', 'transfer']);
    // the singleton itself is frozen — direct mutation throws
    expect(() => DEFAULT_POS_SETTINGS.methods.push('nope')).toThrow();
  });
});

describe('computeExpected', () => {
  it('folds the cash float into cash only', () => {
    expect(computeExpected({ cash: 35.5, card: 30 }, { cash: 50 })).toEqual({ cash: 85.5, card: 30 });
  });
  it('cash float with zero cash payments still yields expected.cash = float', () => {
    expect(computeExpected({ card: 30 }, { cash: 50 })).toEqual({ cash: 50, card: 30 });
  });
  it('missing float key → expected.cash is just the payment sum', () => {
    expect(computeExpected({ cash: 12.34 }, {})).toEqual({ cash: 12.34 });
  });
  it('non-cash float keys are NOT folded into their methods', () => {
    expect(computeExpected({ card: 30 }, { card: 100 })).toEqual({ cash: 0, card: 30 });
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
    resolveSequence([[]]); // load open shift → none
    await expect(closeShift(ctx(db), { counted: {}, actor })).rejects.toMatchObject({ code: 'no_open_shift' });
  });

  it('computes expected = float.cash + Σ cash payments (non-void tickets only), persists counted verbatim', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
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
