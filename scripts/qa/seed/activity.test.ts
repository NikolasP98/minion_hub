import { describe, it, expect } from 'vitest';
import { ACTIVITY_DAYS, generateActivity } from './activity';

const NOW = new Date('2026-10-16T12:00:00Z');
const limaParts = (iso: unknown) => {
  const d = new Date(new Date(iso as string).getTime() - 5 * 60 * 60 * 1000);
  return { dow: d.getUTCDay(), hour: d.getUTCHours(), time: d.getTime() };
};

describe('qa activity generator (spec 015)', () => {
  const rows = generateActivity(NOW);

  it('is deterministic for the same day', () => {
    expect(generateActivity(NOW)).toEqual(rows);
  });

  it('keeps a past day stable when the window slides', () => {
    const later = generateActivity(new Date(NOW.getTime() + 24 * 60 * 60 * 1000));
    const sameDay = (r: Record<string, unknown>) =>
      (r.uid as string).startsWith('ACT-BK-2026-10-01-');
    expect(later.bookings.filter(sameDay)).toEqual(rows.bookings.filter(sameDay));
  });

  it('lands the owner-requested volumes inside the window, Mon–Sat 09:00–19:59 Lima', () => {
    expect(rows.bookings.length).toBeGreaterThanOrEqual(150);
    expect(rows.bookings.length).toBeLessThanOrEqual(250);
    expect(rows.tickets.length).toBeGreaterThanOrEqual(80);
    expect(rows.tickets.length).toBeLessThanOrEqual(160);
    expect(rows.invoices.length).toBeGreaterThanOrEqual(25);
    expect(rows.invoices.length).toBeLessThanOrEqual(60);
    expect(rows.clients).toHaveLength(8);
    const floor = NOW.getTime() - (ACTIVITY_DAYS + 1) * 24 * 60 * 60 * 1000;
    for (const b of rows.bookings) {
      const { dow, hour, time } = limaParts(b.start_time);
      expect(dow).not.toBe(0);
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThanOrEqual(19);
      expect(time).toBeGreaterThan(floor);
      expect(time).toBeLessThan(NOW.getTime());
    }
    expect(new Set(rows.bookings.map((b) => b.status))).toEqual(
      new Set(['completed', 'accepted', 'cancelled', 'no_show']),
    );
  });

  it('keeps money consistent: ticket = Σ lines = payment; invoice = subtotal + tax', () => {
    for (const t of rows.tickets) {
      const sum = rows.lines
        .filter((l) => l.ticket_id === t.id)
        .reduce((s, l) => s + (l.total as number), 0);
      expect(t.total).toBe(sum);
      expect(rows.payments.find((p) => p.ticket_id === t.id)?.amount).toBe(sum);
      expect(rows.shifts.some((s) => s.id === t.shift_id)).toBe(true);
    }
    for (const inv of rows.invoices) {
      expect(inv.total).toBeCloseTo((inv.subtotal as number) + (inv.tax as number), 2);
    }
    expect(rows.tickets.some((t) => t.status === 'voided')).toBe(true);
  });
});
