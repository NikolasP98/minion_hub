import { describe, expect, it } from 'vitest';
import {
  assertCriticalRuntimeDiagnostics,
  type RuntimeUiDiagnostics,
} from '../../../tests/e2e/ui-audit/runtime-diagnostics';

const clean: RuntimeUiDiagnostics = {
  documentOverflowPx: 0,
  documentOverflowAllowed: false,
  duplicateIds: [],
  unnamedInteractiveElements: [],
  unnamedDialogs: [],
  buttonsMissingTypeInForms: [],
  invalidLocalLinks: [],
  visibleRouteTitles: ['Settings'],
  undersizedInteractiveElements: [],
};

describe('runtime UI diagnostics gate', () => {
  it('accepts a clean route and an explicitly allowlisted document surface', () => {
    expect(() => assertCriticalRuntimeDiagnostics(clean, 'settings')).not.toThrow();
    expect(() =>
      assertCriticalRuntimeDiagnostics(
        { ...clean, documentOverflowPx: 320, documentOverflowAllowed: true },
        'workshop',
      ),
    ).not.toThrow();
  });

  it('reports every critical invariant with the route ID', () => {
    expect(() =>
      assertCriticalRuntimeDiagnostics(
        {
          ...clean,
          documentOverflowPx: 12,
          duplicateIds: ['dialog-title'],
          unnamedInteractiveElements: ['button:nth-of-type(2)'],
          unnamedDialogs: ['[role="dialog"]'],
          buttonsMissingTypeInForms: ['form button:nth-of-type(1)'],
          invalidLocalLinks: ['a:nth-of-type(3)'],
        },
        'settings',
      ),
    ).toThrowError(
      /settings: document overflow 12px; duplicate IDs: dialog-title; unnamed controls: button:nth-of-type\(2\); unnamed dialogs: \[role="dialog"\]; form buttons missing type: form button:nth-of-type\(1\); invalid local links: a:nth-of-type\(3\)/,
    );
  });

  it('records small targets without failing the critical gate', () => {
    expect(() =>
      assertCriticalRuntimeDiagnostics(
        { ...clean, undersizedInteractiveElements: ['canvas button:nth-of-type(1)'] },
        'workshop',
      ),
    ).not.toThrow();
  });
});
