import { describe, expect, it } from 'vitest';
import { canRenderWithoutWorkforce } from './workforce-degradation';

describe('canRenderWithoutWorkforce', () => {
  it.each(['/workforce/inbox', '/workforce/projects', '/workforce/projects/proj-1'])(
    'allows a native workforce shell at %s',
    (pathname) => {
      expect(canRenderWithoutWorkforce(pathname)).toBe(true);
    },
  );

  it.each([
    '/workforce',
    '/workforce/issues',
    '/workforce/settings/agents',
    '/workforce/projects/proj-1/pipelines',
  ])('keeps %s backend-gated', (pathname) => {
    expect(canRenderWithoutWorkforce(pathname)).toBe(false);
  });
});
