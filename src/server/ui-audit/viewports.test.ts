import { describe, expect, it } from 'vitest';
import { AUDIT_VIEWPORTS, resolveAuditViewport } from '../../../tests/e2e/ui-audit/viewports';

describe('UI audit viewport matrix', () => {
  it('owns the six certification dimensions from the implementation spec', () => {
    expect(AUDIT_VIEWPORTS).toEqual({
      'compact-360': { width: 360, height: 800, class: 'compact' },
      'compact-390': { width: 390, height: 844, class: 'compact' },
      'medium-portrait': { width: 768, height: 1024, class: 'medium' },
      'medium-landscape': { width: 1024, height: 768, class: 'medium' },
      'wide-1280': { width: 1280, height: 800, class: 'wide' },
      'wide-1440': { width: 1440, height: 900, class: 'wide' },
    });
  });

  it('keeps legacy class aliases deterministic and rejects silent fallback', () => {
    expect(resolveAuditViewport('compact').id).toBe('compact-390');
    expect(resolveAuditViewport('medium').id).toBe('medium-portrait');
    expect(resolveAuditViewport('wide').id).toBe('wide-1440');
    expect(resolveAuditViewport(undefined).id).toBe('wide-1440');
    expect(() => resolveAuditViewport('phone')).toThrow(/Unknown E2E_UI_AUDIT_VIEWPORT=phone/);
  });
});
