// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
vi.mock('$app/state', async () => ({
  page: (await import('./__fixtures__/preference-owner.svelte')).testPage,
}));
import { testPage } from './__fixtures__/preference-owner.svelte';
import {
  syncPreferenceToServer,
  preferenceSyncState,
  reconcilePreference,
  reconciledPreference,
} from './preference-sync.svelte';
let n = 0;
beforeEach(() => {
  vi.useFakeTimers();
  flushSync(() => {
    testPage.data.user.id = `actor-${++n}`;
    testPage.data.activeOrgId = 'org-a';
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('preference synchronization outcomes', () => {
  it('does not dispatch a queued preference after identity rotation', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    syncPreferenceToServer('dailyDashboard', { order: ['a'] });
    flushSync(() => {
      testPage.data.activeOrgId = 'org-b';
    });
    await vi.advanceTimersByTimeAsync(1001);
    expect(fetcher).not.toHaveBeenCalled();
    expect(preferenceSyncState('dailyDashboard')).toBe('idle');
  });
  it('reports a rejected HTTP response instead of success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 400 })),
    );
    syncPreferenceToServer('dailyDashboard', {});
    await vi.advanceTimersByTimeAsync(1001);
    expect(preferenceSyncState('dailyDashboard')).toBe('error');
  });
  it('blocks unknown writes and uses only GET for reconciliation', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValue(new Response('{"preferences":{}}'));
    vi.stubGlobal('fetch', fetcher);
    syncPreferenceToServer('dailyDashboard', {});
    await vi.advanceTimersByTimeAsync(1001);
    expect(preferenceSyncState('dailyDashboard')).toBe('unknown');
    syncPreferenceToServer('dailyDashboard', { changed: true });
    await vi.advanceTimersByTimeAsync(1001);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await reconcilePreference('dailyDashboard')).toBe(true);
    expect(fetcher.mock.calls[1]).toEqual(['/api/me/preferences']);
    expect(preferenceSyncState('dailyDashboard')).toBe('checked');
  });
  it('rejects malformed reconciliation and keeps uncertain writes blocked', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce(new Response('{"preferences":[]}'));
    vi.stubGlobal('fetch', fetcher);
    syncPreferenceToServer('dailyDashboard', {});
    await vi.advanceTimersByTimeAsync(1001);
    expect(await reconcilePreference('dailyDashboard')).toBe(false);
    expect(preferenceSyncState('dailyDashboard')).toBe('unknown');
    expect(reconciledPreference('dailyDashboard')).toBeUndefined();
  });
  it('keeps canonical reads attached to the owner that requested them', async () => {
    const canonical = { version: 1, organizationId: 'org-a', order: ['activity'], hidden: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ preferences: { dailyDashboard: canonical } })),
      ),
    );
    expect(await reconcilePreference('dailyDashboard')).toBe(true);
    expect(reconciledPreference('dailyDashboard')).toEqual(canonical);
    flushSync(() => {
      testPage.data.activeOrgId = 'org-b';
    });
    expect(reconciledPreference('dailyDashboard')).toBeUndefined();
    expect(preferenceSyncState('dailyDashboard')).toBe('idle');
    flushSync(() => {
      testPage.data.activeOrgId = 'org-a';
    });
    expect(reconciledPreference('dailyDashboard')).toEqual(canonical);
  });
  it('does not show an old owner acknowledgement in the new scope', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    syncPreferenceToServer('dailyDashboard', {});
    await vi.advanceTimersByTimeAsync(1001);
    flushSync(() => {
      testPage.data.activeOrgId = 'org-b';
    });
    resolve(new Response('{}'));
    await Promise.resolve();
    await Promise.resolve();
    expect(preferenceSyncState('dailyDashboard')).toBe('idle');
  });
});
