import { describe, expect, it } from 'vitest';
import {
  assertEmissionsGate,
  BOOKING_STEPS,
  DELETE_ORDER,
  parseArgs,
  stepsFor,
} from './sweep-hub-transactions';

function indexOf(steps: { table: string }[], table: string): number {
  const i = steps.findIndex((s) => s.table === table);
  if (i < 0) throw new Error(`${table} missing from step list`);
  return i;
}

describe('DELETE_ORDER dependency order', () => {
  it('deletes pos_package_redemptions before pos_package_grants (grant_id restrict)', () => {
    expect(indexOf(DELETE_ORDER, 'pos_package_redemptions')).toBeLessThan(
      indexOf(DELETE_ORDER, 'pos_package_grants'),
    );
  });

  it('deletes pos_package_grants and pos_emissions before pos_tickets (restrict FKs)', () => {
    const tickets = indexOf(DELETE_ORDER, 'pos_tickets');
    expect(indexOf(DELETE_ORDER, 'pos_package_grants')).toBeLessThan(tickets);
    expect(indexOf(DELETE_ORDER, 'pos_emissions')).toBeLessThan(tickets);
  });

  it('deletes pos_tickets before pos_shifts (pos_tickets.shift_id restrict)', () => {
    expect(indexOf(DELETE_ORDER, 'pos_tickets')).toBeLessThan(indexOf(DELETE_ORDER, 'pos_shifts'));
  });

  it('deletes stk_ledger before stk_entries (no cascade on stk_ledger.entry_id)', () => {
    expect(indexOf(DELETE_ORDER, 'stk_ledger')).toBeLessThan(indexOf(DELETE_ORDER, 'stk_entries'));
  });

  it('keeps stk_entries imported from the FACES CSV seed out of scope', () => {
    const step = DELETE_ORDER.find((s) => s.table === 'stk_entries')!;
    expect(step.scopeSql).toContain('seed-faces-csv');
  });

  it('never deletes prod-accepted SUNAT emissions', () => {
    const step = DELETE_ORDER.find((s) => s.table === 'pos_emissions')!;
    expect(step.scopeSql).toContain("environment = 'prod'");
    expect(step.scopeSql).toContain("status = 'accepted'");
  });

  it('only sweeps hub-manual fin_purchases, never SUNAT-synced ones', () => {
    const step = DELETE_ORDER.find((s) => s.table === 'fin_purchases')!;
    expect(step.scopeSql).toBe("source = 'manual'");
  });

  it('deletes sched_booking_status_log before sched_bookings', () => {
    expect(indexOf(BOOKING_STEPS, 'sched_booking_status_log')).toBeLessThan(
      indexOf(BOOKING_STEPS, 'sched_bookings'),
    );
  });

  it('stepsFor omits booking steps by default and includes them with the flag', () => {
    expect(stepsFor(false).some((s) => s.table === 'sched_bookings')).toBe(false);
    expect(stepsFor(true).some((s) => s.table === 'sched_bookings')).toBe(true);
    // booking steps always come after the base order (still children-first within themselves)
    expect(stepsFor(true).slice(0, DELETE_ORDER.length)).toEqual(DELETE_ORDER);
  });
});

describe('assertEmissionsGate', () => {
  it('refuses to apply while prod-accepted emissions are un-voided', () => {
    expect(() => assertEmissionsGate({ prodAcceptedCount: 2, forceEmissions: false })).toThrow(
      /refusing --apply/,
    );
  });

  it('allows --force-emissions to proceed despite un-voided prod emissions', () => {
    expect(() => assertEmissionsGate({ prodAcceptedCount: 2, forceEmissions: true })).not.toThrow();
  });

  it('never blocks when there are no prod-accepted emissions', () => {
    expect(() =>
      assertEmissionsGate({ prodAcceptedCount: 0, forceEmissions: false }),
    ).not.toThrow();
  });
});

describe('parseArgs', () => {
  it('defaults to dry-run, every org, no bookings, no force', () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      org: null,
      includeBookings: false,
      forceEmissions: false,
    });
  });

  it('parses every flag', () => {
    expect(
      parseArgs(['--apply', '--org', 'abc-123', '--include-bookings', '--force-emissions']),
    ).toEqual({
      apply: true,
      org: 'abc-123',
      includeBookings: true,
      forceEmissions: true,
    });
  });
});
