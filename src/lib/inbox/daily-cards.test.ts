import { describe, expect, it } from 'vitest';
import {
  DAILY_CARDS,
  mergeDailyLayout,
  moveCard,
  serverLayoutToAdopt,
  type DailyCard,
} from './daily-cards';

describe('mergeDailyLayout', () => {
  it('gives a viewer who never configured anything the full catalog, in order', () => {
    const l = mergeDailyLayout(null);
    expect(l.order).toEqual([...DAILY_CARDS]);
    expect(l.hidden.size).toBe(0);
  });

  it('keeps the stored order and drops keys that are no longer cards', () => {
    const l = mergeDailyLayout({ order: ['openShifts', 'retired-card', 'kpis'], hidden: ['nope'] });
    expect(l.order.slice(0, 2)).toEqual(['openShifts', 'kpis']);
    expect(l.order).toHaveLength(DAILY_CARDS.length);
    expect(l.hidden.size).toBe(0);
  });

  it('shows a card added after the layout was stored instead of dropping it', () => {
    const l = mergeDailyLayout({ order: ['kpis'] });
    expect(l.order).toContain('appointments');
    expect(new Set(l.order).size).toBe(DAILY_CARDS.length);
  });

  it('round-trips a hidden card', () => {
    expect(mergeDailyLayout({ hidden: ['openShifts'] }).hidden.has('openShifts')).toBe(true);
  });
});

describe('moveCard', () => {
  const order = [...DAILY_CARDS] as DailyCard[];

  it('drops the dragged card into the target slot', () => {
    expect(moveCard(order, 'openShifts', 'kpis')[0]).toBe('openShifts');
  });

  it('moves a card down without losing or duplicating any', () => {
    const next = moveCard(order, 'kpis', 'openShifts');
    expect(next).toHaveLength(order.length);
    expect(new Set(next).size).toBe(order.length);
    expect(next.indexOf('kpis')).toBeGreaterThan(0);
  });

  it('is a no-op when a card is dropped on itself or on an unknown target', () => {
    expect(moveCard(order, 'kpis', 'kpis')).toBe(order);
    expect(moveCard(order, 'kpis', 'ghost' as DailyCard)).toBe(order);
  });
});

import { mergeScopedDailyLayout } from './daily-cards';
it('does not import another organization canonical layout or unscoped legacy data', () => {
  const saved = { version: 1, organizationId: 'org-a', order: ['openShifts'], hidden: ['kpis'] };
  expect(mergeScopedDailyLayout(saved, 'org-a').order[0]).toBe('openShifts');
  expect(mergeScopedDailyLayout(saved, 'org-b').order).toEqual([...DAILY_CARDS]);
  expect(mergeScopedDailyLayout(saved, 'org-b').hidden.size).toBe(0);
  expect(mergeScopedDailyLayout({ order: ['openShifts'] }, 'org-b').order).toEqual([
    ...DAILY_CARDS,
  ]);
});

describe('serverLayoutToAdopt', () => {
  const base = {
    version: 1,
    organizationId: 'org-a',
    order: ['kpis', 'appointments'],
    hidden: ['openShifts'],
  };
  it('adopts a changed server layout for the same organization', () => {
    const next = serverLayoutToAdopt({ ...base, hidden: [] }, 'org-a', false, base);
    expect(next?.hidden).toEqual([]);
    expect(next?.organizationId).toBe('org-a');
  });
  it('never adopts another organization, a pending write, or an identical value', () => {
    expect(
      serverLayoutToAdopt({ ...base, organizationId: 'org-b' }, 'org-a', false, base),
    ).toBeNull();
    expect(serverLayoutToAdopt({ ...base, hidden: [] }, 'org-a', true, base)).toBeNull();
    const same = serverLayoutToAdopt(
      base,
      'org-a',
      false,
      serverLayoutToAdopt(base, 'org-a', false, null),
    );
    expect(same).toBeNull();
    expect(serverLayoutToAdopt('garbage', 'org-a', false, base)).toBeNull();
  });
});
