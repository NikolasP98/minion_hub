import { describe, it, expect } from 'vitest';

describe('/settings/plugins +page.server', () => {
  it('exports a load function', async () => {
    const mod = await import('./+page.server');
    expect(typeof mod.load).toBe('function');
  });
});
