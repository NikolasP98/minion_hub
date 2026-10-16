import { describe, expect, it } from 'vitest';
import { parseDataView, type DataViewCatalog } from './data-view';
describe('DataView catalog', () => {
  it('keeps allowed choices and falls back to the first', () => {
    expect(parseDataView('board', ['table', 'board'])).toBe('board');
    expect(parseDataView('calendar', ['table'])).toBe('table');
  });
  it('rejects empty runtime catalogs rather than rendering undefined', () => {
    expect(() => parseDataView(null, [] as unknown as DataViewCatalog)).toThrow(
      'at least one view',
    );
  });
});

it('rejects duplicate and unsupported runtime views', () => {
  expect(() => parseDataView(null, ['table', 'table'])).toThrow('unique supported');
  expect(() => parseDataView(null, ['unknown'] as unknown as DataViewCatalog)).toThrow(
    'unique supported',
  );
});
