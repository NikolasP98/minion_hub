import { describe, it, expect } from 'vitest';
import { isFlowsNavVisible, gateSections, getSections } from './sections';

describe('isFlowsNavVisible', () => {
  it('visible when map is empty (back-compat)', () => {
    expect(isFlowsNavVisible({})).toBe(true);
  });
  it('visible when flows enabled', () => {
    expect(isFlowsNavVisible({ flows: true })).toBe(true);
  });
  it('hidden when flows explicitly disabled', () => {
    expect(isFlowsNavVisible({ flows: false })).toBe(false);
  });
  it('visible when only other plugins are disabled', () => {
    expect(isFlowsNavVisible({ whatsapp: false })).toBe(true);
  });
});

describe('gateSections', () => {
  it('removes the /flow-editor item from Gateway when flows disabled', () => {
    const gated = gateSections(getSections(), { flows: false });
    const gateway = gated.find((s) => s.id === 'gateway');
    expect(gateway?.items.some((i) => i.href === '/flow-editor')).toBe(false);
  });
  it('keeps /flow-editor when flows enabled', () => {
    const gated = gateSections(getSections(), { flows: true });
    const gateway = gated.find((s) => s.id === 'gateway');
    expect(gateway?.items.some((i) => i.href === '/flow-editor')).toBe(true);
  });
  it('keeps every non-flows item untouched', () => {
    const before = getSections().flatMap((s) => s.items.map((i) => i.href)).filter((h) => h !== '/flow-editor');
    const after = gateSections(getSections(), { flows: false }).flatMap((s) => s.items.map((i) => i.href));
    expect(after).toEqual(before);
  });
});
