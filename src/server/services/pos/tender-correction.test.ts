import { describe, expect, it } from 'vitest';
import { PosError } from './errors';
import {
  assertTicketMutable,
  effectiveMethod,
  planTenderChange,
  type TicketMutationState,
} from './tender-correction';

const live: TicketMutationState = {
  ticket: { status: 'submitted', invoiceProviderRef: null },
  shiftStatus: 'open',
  emitted: false,
  periodLocked: false,
};

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof PosError) return e.code;
    throw e;
  }
  return 'ok';
};

describe('assertTicketMutable — the shared guard chain (spec T4 order)', () => {
  it('routes a live ticket on its shift state', () => {
    expect(assertTicketMutable(live, { fiscal: false })).toBe('open');
    expect(assertTicketMutable({ ...live, shiftStatus: 'closed' }, { fiscal: false })).toBe(
      'closed',
    );
  });

  it('refuses in order: void → period locked → reconciled → emitted (fiscal only)', () => {
    const everything: TicketMutationState = {
      ticket: { status: 'void', invoiceProviderRef: 'inv-1' },
      shiftStatus: 'closed',
      emitted: true,
      periodLocked: true,
    };
    expect(code(() => assertTicketMutable(everything, { fiscal: true }))).toBe('ticket_void');
    const notVoid = { ...everything, ticket: { ...everything.ticket, status: 'submitted' } };
    expect(code(() => assertTicketMutable(notVoid, { fiscal: true }))).toBe('period_locked');
    const unlocked = { ...notVoid, periodLocked: false };
    expect(code(() => assertTicketMutable(unlocked, { fiscal: true }))).toBe('reconciled');
    const unreconciled = { ...unlocked, ticket: { ...unlocked.ticket, invoiceProviderRef: null } };
    expect(code(() => assertTicketMutable(unreconciled, { fiscal: true }))).toBe('emitted');
    // The CPE carries no tender, so an emitted ticket still takes a method change.
    expect(assertTicketMutable(unreconciled, { fiscal: false })).toBe('closed');
  });

  it('shows the accountant lock verbatim', () => {
    expect(() => assertTicketMutable({ ...live, periodLocked: true }, { fiscal: false })).toThrow(
      'Periodo cerrado por contabilidad',
    );
  });
});

const payment = { id: 'pay-1', method: 'cash', amount: '150.00', metadata: {} };
const input = {
  payment,
  method: 'card',
  reason: 'Error de registro',
  actor: { id: 'u1', name: 'Ana' },
  now: new Date('2026-10-15T15:00:00Z'),
};

describe('planTenderChange', () => {
  it('open shift: corrects the row in place and remembers where it came from', () => {
    const plan = planTenderChange('open', input);
    expect(plan).toEqual({
      kind: 'in_place',
      metadata: {
        changedFrom: 'cash',
        by: 'u1',
        byName: 'Ana',
        at: '2026-10-15T15:00:00.000Z',
        reason: 'Error de registro',
      },
    });
  });

  it('closed shift: writes a zero-net pair tagged with the original row (I1, I2)', () => {
    const plan = planTenderChange('closed', input);
    expect(plan.kind).toBe('correction');
    if (plan.kind !== 'correction') return;
    expect(plan.rows.map((r) => [r.method, r.amount])).toEqual([
      ['cash', '-150.00'],
      ['card', '150.00'],
    ]);
    const net = plan.rows.reduce((sum, r) => sum + Number(r.amount), 0);
    expect(net).toBe(0);
    for (const row of plan.rows)
      expect(row.metadata).toMatchObject({
        kind: 'correction',
        correctionOf: 'pay-1',
        reason: 'Error de registro',
      });
  });

  it('refuses a no-op and refuses to correct a refund or correction row', () => {
    expect(code(() => planTenderChange('open', { ...input, method: 'cash' }))).toBe('same_method');
    expect(
      code(() =>
        planTenderChange('open', {
          ...input,
          payment: { ...payment, metadata: { kind: 'refund' } },
        }),
      ),
    ).toBe('not_found');
    expect(
      code(() =>
        planTenderChange('closed', {
          ...input,
          payment: { ...payment, metadata: { kind: 'correction' } },
        }),
      ),
    ).toBe('not_found');
  });
});

describe('effectiveMethod', () => {
  it("is the row's own method until a correction pair moves it, then the newest positive row", () => {
    expect(effectiveMethod(payment, [])).toBe('cash');
    const t = (iso: string) => new Date(iso);
    expect(
      effectiveMethod(payment, [
        { method: 'yape', amount: '150.00', paidAt: t('2026-10-16T10:00:00Z') },
        { method: 'card', amount: '-150.00', paidAt: t('2026-10-16T10:00:00Z') },
        { method: 'cash', amount: '-150.00', paidAt: t('2026-10-15T10:00:00Z') },
        { method: 'card', amount: '150.00', paidAt: t('2026-10-15T10:00:00Z') },
      ]),
    ).toBe('yape');
  });
});
