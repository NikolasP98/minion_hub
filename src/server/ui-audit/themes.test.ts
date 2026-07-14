import { describe, expect, it } from 'vitest';
import { AUDIT_THEMES, resolveAuditTheme } from '../../../tests/e2e/ui-audit/themes';

describe('UI audit representative themes', () => {
  it('owns the required dark, light, CRT and Voxelized presets', () => {
    expect(AUDIT_THEMES).toEqual({
      dark: { presetId: 'new-york', accentId: 'blue' },
      light: { presetId: 'github-light', accentId: 'blue' },
      crt: { presetId: 'crt', accentId: 'amber' },
      voxelized: { presetId: 'voxelized', accentId: 'cyan' },
    });
  });

  it('does not mutate theme by default and rejects unknown capture themes', () => {
    expect(resolveAuditTheme(undefined)).toBeUndefined();
    expect(resolveAuditTheme('light')).toEqual({
      id: 'light',
      presetId: 'github-light',
      accentId: 'blue',
    });
    expect(() => resolveAuditTheme('sepia')).toThrow(/Unknown E2E_UI_AUDIT_THEME=sepia/);
  });
});
