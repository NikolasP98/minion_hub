import { describe, expect, it } from 'vitest';
import { groupRows, isGroupRow, orderByList, type TreeRow } from './group-by';

type Row = { id: string; bucket: string };

const rows: Row[] = [
  { id: 'a', bucket: 'beta' },
  { id: 'b', bucket: 'alpha' },
  { id: 'c', bucket: 'beta' },
  { id: 'd', bucket: 'gamma' },
];

describe('groupRows', () => {
  it('buckets by the axis and keeps row order inside a bucket', () => {
    const groups = groupRows(rows, { of: (r) => r.bucket });
    expect(groups.map((g) => g.key)).toEqual(['beta', 'alpha', 'gamma']);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('drops empty buckets — only keys present in the rows produce a group', () => {
    const groups = groupRows(rows, {
      of: (r) => r.bucket,
      order: orderByList(['alpha', 'beta', 'gamma', 'delta', 'epsilon']),
    });
    expect(groups.map((g) => g.key)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('labels a bucket from the key and its rows, defaulting to the key', () => {
    expect(groupRows(rows, { of: (r) => r.bucket })[0].label).toBe('beta');
    const labelled = groupRows(rows, {
      of: (r) => r.bucket,
      label: (key, group) => `${key} (${group.length})`,
    });
    expect(labelled[0].label).toBe('beta (2)');
  });

  it('ranks known keys by the canonical order and sorts unknown ones after them', () => {
    const order = orderByList(['gamma', 'beta']);
    const groups = groupRows(rows, { of: (r) => r.bucket, order });
    expect(groups.map((g) => g.key)).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('breaks a tie between two unknown keys alphabetically', () => {
    const order = orderByList([]);
    const groups = groupRows(
      [
        { id: '1', bucket: 'zulu' },
        { id: '2', bucket: 'alpha' },
      ],
      { of: (r) => r.bucket, order },
    );
    expect(groups.map((g) => g.key)).toEqual(['alpha', 'zulu']);
  });

  it('returns no groups for no rows', () => {
    expect(groupRows([] as Row[], { of: (r) => r.bucket })).toEqual([]);
  });
});

describe('isGroupRow', () => {
  it('tells a synthetic header apart from a real record of the same type', () => {
    const record: TreeRow<Row> = { id: 'a', bucket: 'beta' };
    const header: TreeRow<Row> = {
      id: '__group:beta',
      bucket: 'beta',
      __group: { key: 'beta', label: 'Beta', count: 2 },
    };
    expect(isGroupRow(record)).toBe(false);
    expect(isGroupRow(header)).toBe(true);
  });
});
