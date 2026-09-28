import { describe, expect, it, vi } from 'vitest';
import { createOptimisticCell } from './optimistic-cell';

type Row = { id: string; enabled: boolean };
const row: Row = { id: 'r1', enabled: false };

describe('createOptimisticCell', () => {
  it('shows the intended value while the save is in flight, then the committed one', async () => {
    let resolve!: () => void;
    const cell = createOptimisticCell<Row, boolean>({
      getRowId: (r) => r.id,
      save: () => new Promise<void>((r) => (resolve = r)),
    });

    const run = cell.set(row, true);
    expect(cell.value(row, false)).toBe(true);
    expect(cell.pending('r1')).toBe(true);
    expect(cell.pending('r2')).toBe(false);
    expect(cell.value({ id: 'r2', enabled: false }, false)).toBe(false);

    resolve();
    await run;
    expect(cell.pending('r1')).toBe(false);
    // Post-invalidate the server value wins — unchanged on screen.
    expect(cell.value(row, true)).toBe(true);
  });

  it('rolls back to the committed value and reports the error when save rejects', async () => {
    const boom = new Error('boom');
    const onError = vi.fn();
    const cell = createOptimisticCell<Row, boolean>({
      getRowId: (r) => r.id,
      save: () => Promise.reject(boom),
      onError,
    });

    await cell.set(row, true);
    expect(cell.value(row, false)).toBe(false);
    expect(cell.pending('r1')).toBe(false);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('never throws at the call site even without an onError handler', async () => {
    const cell = createOptimisticCell<Row, boolean>({
      getRowId: (r) => r.id,
      save: () => Promise.reject(new Error('boom')),
    });
    await expect(cell.set(row, true)).resolves.toBeUndefined();
  });

  it('passes the row and the intended value to save, keyed per row', async () => {
    const save = vi.fn(async () => undefined);
    const cell = createOptimisticCell<Row, boolean>({ getRowId: (r) => r.id, save });
    const other: Row = { id: 'r2', enabled: true };

    await Promise.all([cell.set(row, true), cell.set(other, false)]);
    expect(save).toHaveBeenCalledWith(row, true);
    expect(save).toHaveBeenCalledWith(other, false);
    expect(cell.pending('r1')).toBe(false);
    expect(cell.pending('r2')).toBe(false);
  });
});
