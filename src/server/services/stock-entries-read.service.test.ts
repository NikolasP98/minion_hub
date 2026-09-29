import { describe, it, expect } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { listEntryLineSummaries } from './stock-entries-read.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('listEntryLineSummaries', () => {
  it('returns an empty map without a query when no ids are given', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([]);
    const out = await listEntryLineSummaries(ctx(db), []);
    expect(out.size).toBe(0);
  });

  it('pairs the grouped count with the first line (by lineNo) per entry', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { entryId: 'e1', count: 2 },
        { entryId: 'e2', count: 1 },
      ],
      [
        { entryId: 'e1', fromWarehouseId: 'w1', toWarehouseId: null },
        { entryId: 'e1', fromWarehouseId: 'w2', toWarehouseId: null },
        { entryId: 'e2', fromWarehouseId: null, toWarehouseId: 'w3' },
      ],
    ]);
    const out = await listEntryLineSummaries(ctx(db), ['e1', 'e2']);
    expect(out.get('e1')).toEqual({
      lineCount: 2,
      firstFromWarehouseId: 'w1',
      firstToWarehouseId: null,
    });
    expect(out.get('e2')).toEqual({
      lineCount: 1,
      firstFromWarehouseId: null,
      firstToWarehouseId: 'w3',
    });
  });

  it('defaults an entry with no line rows to a zero count', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]);
    const out = await listEntryLineSummaries(ctx(db), ['e9']);
    expect(out.get('e9')).toEqual({
      lineCount: 0,
      firstFromWarehouseId: null,
      firstToWarehouseId: null,
    });
  });
});
