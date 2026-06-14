import { describe, it, expect } from 'vitest';
import { getSections } from './sections';

describe('getSections — Agent Builder is a core nav item', () => {
  it('always includes /flow-editor in the Gateway section', () => {
    const gateway = getSections().find((s) => s.id === 'gateway');
    expect(gateway?.items.some((i) => i.href === '/flow-editor')).toBe(true);
  });
  it('exposes the Agent Builder label (i18n) for /flow-editor', () => {
    const gateway = getSections().find((s) => s.id === 'gateway');
    const item = gateway?.items.find((i) => i.href === '/flow-editor');
    expect(item?.label).toBeTruthy();
  });
});
