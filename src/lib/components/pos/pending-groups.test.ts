import { describe, expect, it } from 'vitest';
import { groupPendingLines, type PendingGroupLine } from './pending-groups';

function line(overrides: Partial<PendingGroupLine> & { lineId: string }): PendingGroupLine {
  return { partyId: null, crmContactId: null, customerName: null, ...overrides };
}

describe('groupPendingLines', () => {
  it('keeps single-line groups flat (one line per customer)', () => {
    const lines = [
      line({ lineId: 'l1', partyId: 'p1', customerName: 'Ana' }),
      line({ lineId: 'l2', partyId: 'p2', customerName: 'Beto' }),
    ];
    const groups = groupPendingLines(lines);
    expect(groups).toHaveLength(2);
    expect(groups[0].lines).toHaveLength(1);
    expect(groups[1].lines).toHaveLength(1);
  });

  it('merges lines that share a partyId into one group, in order', () => {
    const lines = [
      line({ lineId: 'l1', partyId: 'p1', customerName: 'Ana' }),
      line({ lineId: 'l2', partyId: 'p2', customerName: 'Beto' }),
      line({ lineId: 'l3', partyId: 'p1', customerName: 'Ana' }),
    ];
    const groups = groupPendingLines(lines);
    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe('p1');
    expect(groups[0].lines.map((l) => l.lineId)).toEqual(['l1', 'l3']);
    expect(groups[1].lines.map((l) => l.lineId)).toEqual(['l2']);
  });

  it('never merges anonymous lines (no partyId, crmContactId, or name)', () => {
    const lines = [line({ lineId: 'l1' }), line({ lineId: 'l2' })];
    const groups = groupPendingLines(lines);
    expect(groups).toHaveLength(2);
    expect(groups[0].lines).toHaveLength(1);
    expect(groups[1].lines).toHaveLength(1);
  });
});
