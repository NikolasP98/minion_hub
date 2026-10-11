import { describe, expect, it } from 'vitest';
import { dayGroup, groupByDay, kindLabel } from './feed';

const now = new Date(2026, 9, 10, 15, 0, 0); // local 2026-10-10 15:00

describe('dayGroup', () => {
  it('buckets by local calendar day, not by 24h windows', () => {
    expect(dayGroup(new Date(2026, 9, 10, 0, 0, 1), now)).toBe('today');
    expect(dayGroup(new Date(2026, 9, 9, 23, 59), now)).toBe('yesterday');
    expect(dayGroup(new Date(2026, 9, 9, 0, 0), now)).toBe('yesterday');
    expect(dayGroup(new Date(2026, 9, 8, 23, 59), now)).toBe('earlier');
    expect(dayGroup(new Date(2026, 9, 10, 14, 0).toISOString(), now)).toBe('today');
  });
});

describe('groupByDay', () => {
  it('keeps feed order inside each bucket and drops empty buckets', () => {
    const items = [
      { id: 'a', createdAt: new Date(2026, 9, 10, 14) },
      { id: 'b', createdAt: new Date(2026, 9, 1) },
      { id: 'c', createdAt: new Date(2026, 9, 10, 9) },
    ];
    const groups = groupByDay(items, now);
    expect(groups.map((g) => g.group)).toEqual(['today', 'earlier']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['b']);
  });

  it('returns no groups for an empty feed', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('kindLabel', () => {
  it('maps every evaluator rule kind to a human label and leaves unknown kinds raw', () => {
    for (const kind of [
      'appointment.overdue',
      'visit.unpaid',
      'shift.open_after_hours',
      'stock.low',
      'service.paid_unscheduled',
      'package.expiring',
      'plan.overdue',
      'finance.sync_failed',
      'crm.dni_pending',
      'crm.birthday',
      'daily.feed',
      'app.update',
    ]) {
      expect(kindLabel(kind)).not.toBe(kind);
    }
    expect(kindLabel('some.future_kind')).toBe('some.future_kind');
  });
});
