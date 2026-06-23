import { describe, it, expect } from 'vitest';
import { computeChanges } from './activity.service';

const FIELDS = [
  { field: 'status', label: 'Status' },
  { field: 'priority', label: 'Priority' },
];

describe('computeChanges', () => {
  it('reports only the fields that changed', () => {
    const out = computeChanges({ status: 'open', priority: 'high' }, { status: 'resolved', priority: 'high' }, FIELDS);
    expect(out).toEqual([{ field: 'status', label: 'Status', old: 'open', new: 'resolved' }]);
  });
  it('returns empty when nothing tracked changed', () => {
    expect(computeChanges({ status: 'open', other: 1 }, { status: 'open', other: 2 }, FIELDS)).toEqual([]);
  });
  it('normalizes undefined to null', () => {
    const out = computeChanges({ status: undefined }, { status: 'open' }, [{ field: 'status', label: 'Status' }]);
    expect(out[0]).toEqual({ field: 'status', label: 'Status', old: null, new: 'open' });
  });
});
