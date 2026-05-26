import { describe, test, expect, vi } from 'vitest';

vi.mock('$app/state', () => ({
  page: { data: { user: { role: 'admin' }, permissions: { permissions: ['marketplace:publish'] } } },
}));

describe('canClient', () => {
  test('reads role + permissions from page.data', async () => {
    const { canClient } = await import('./can.svelte');
    expect(canClient('users.manage')).toBe(true);
    expect(canClient('reliability.monitor')).toBe(true);
    expect(canClient('agents.publish')).toBe(true);
  });
});
