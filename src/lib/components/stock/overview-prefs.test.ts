import { describe, it, expect } from 'vitest';
import { visibleProperties, toggleHidden } from './overview-prefs';

const ALL = [
  { key: 'uom', label: 'UoM' },
  { key: 'itemGroup', label: 'Group' },
  { key: 'moq', label: 'MOQ' },
];

describe('visibleProperties', () => {
  it('keeps every property when nothing is hidden', () => {
    expect(visibleProperties(ALL, new Set(), new Set())).toEqual(ALL);
  });

  it('drops org-hidden fields regardless of the user toggle', () => {
    const out = visibleProperties(ALL, new Set(['moq']), new Set());
    expect(out.map((p) => p.key)).toEqual(['uom', 'itemGroup']);
  });

  it('drops user-hidden fields on top of org-hidden ones, preserving order', () => {
    const out = visibleProperties(ALL, new Set(['moq']), new Set(['uom']));
    expect(out.map((p) => p.key)).toEqual(['itemGroup']);
  });
});

describe('toggleHidden', () => {
  it('adds a key that is not yet hidden', () => {
    expect(toggleHidden([], 'uom')).toEqual(['uom']);
    expect(toggleHidden(['moq'], 'uom')).toEqual(['moq', 'uom']);
  });

  it('removes a key that is already hidden', () => {
    expect(toggleHidden(['moq', 'uom'], 'uom')).toEqual(['moq']);
  });
});
