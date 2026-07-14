import { describe, expect, it } from 'vitest';
import { needsWorkforceIdentity } from './workforce-route';

describe('needsWorkforceIdentity', () => {
  it.each([
    '/work',
    '/workforce',
    '/workforce/projects/project-1',
    '/api/workforce/factory-intake',
    '/api/pc/events',
    '/agents/autonomous',
  ])('includes %s', (pathname) => {
    expect(needsWorkforceIdentity(pathname)).toBe(true);
  });

  it.each(['/workbench', '/work/rules', '/api/work', '/crm'])(
    'does not broaden to %s',
    (pathname) => {
      expect(needsWorkforceIdentity(pathname)).toBe(false);
    },
  );
});
