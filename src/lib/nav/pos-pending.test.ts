import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPage: { data: Record<string, unknown> } = { data: {} };
vi.mock('$app/state', () => ({
  get page() {
    return mockPage;
  },
}));

import { posPendingWork } from './pos-pending';
import { notifications } from '$lib/state/features/notifications.svelte';

beforeEach(() => {
  mockPage.data = {};
  notifications.posPendingWork = null;
});

/**
 * The badge used to read `page.data.posPendingWork` alone, which only
 * `/pos/+layout.server.ts` supplies — so it vanished on every page outside
 * /pos while the sidebar still showed the POS module (owner 2026-10-14).
 */
describe('posPendingWork', () => {
  it('prefers the POS layout value, which is the one invalidation refreshes', () => {
    mockPage.data = { posPendingWork: 196 };
    notifications.posPendingWork = 5;
    expect(posPendingWork()).toBe(196);
  });

  it('falls back to the polled count off the POS subtree, where that layout never runs', () => {
    notifications.posPendingWork = 196;
    expect(posPendingWork()).toBe(196);
  });

  it('keeps a real 0 from the layout instead of falling through to a stale poll', () => {
    mockPage.data = { posPendingWork: 0 };
    notifications.posPendingWork = 196;
    expect(posPendingWork()).toBe(0);
  });

  it('reports nothing to show when neither source knows yet or pos:view is denied', () => {
    expect(posPendingWork()).toBeUndefined();
  });
});
