import { describe, expect, it } from 'vitest';
import { readReliabilityFilters, writeReliabilityFilters } from './filter-storage';
const storage = (raw: string) => ({ getItem: () => raw }) as unknown as Storage;
describe('reliability filter persistence', () => {
  it.each(['getter', 'read', 'parse'])(
    'contains %s failures with deterministic defaults',
    (kind) => {
      const read = () => {
        if (kind === 'getter') throw new Error('blocked');
        return kind === 'read'
          ? ({
              getItem: () => {
                throw new Error('blocked');
              },
            } as unknown as Storage)
          : storage('{bad');
      };
      expect(readReliabilityFilters(read)).toEqual({
        filters: { categories: [], severities: [], datePreset: '24h' },
        unavailable: true,
      });
    },
  );
  it('rejects malformed fields and accepts a custom range beginning at epoch zero', () => {
    expect(
      readReliabilityFilters(() =>
        storage(
          JSON.stringify({
            categories: 'abc',
            severities: [null, 1, 'high', 'high'],
            tab: 'foreign',
            scope: 'foreign',
            datePreset: 'foreign',
            customFrom: 0,
            customTo: 1,
          }),
        ),
      ).filters,
    ).toEqual({
      categories: [],
      severities: ['high'],
      failureModes: [],
      datePreset: null,
      customFrom: 0,
      customTo: 1,
      tab: 'overview',
      scope: 'all',
    });
    expect(
      readReliabilityFilters(() => storage('{"customFrom":10,"customTo":1}')).filters.datePreset,
    ).toBe('24h');
  });
  it('contains storage access and quota failures when saving', () => {
    const filters = { categories: [], severities: [], datePreset: '24h' };
    expect(
      writeReliabilityFilters(filters, () => {
        throw new Error('blocked');
      }),
    ).toBe(false);
    expect(
      writeReliabilityFilters(
        filters,
        () =>
          ({
            setItem: () => {
              throw new Error('quota');
            },
          }) as unknown as Storage,
      ),
    ).toBe(false);
  });
});
