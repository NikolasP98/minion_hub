// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
vi.mock('$lib/paraglide/messages', () => ({
  fin_sync_status_unavailable: () => 'Sync status could not be confirmed.',
  fin_sync_unknown: () => 'Sync submission could not be confirmed.',
  fin_sync_error: () => 'Sync failed',
}));
import Harness from './__fixtures__/FinanceSyncMonitorHarness.svelte';
import { financeSync } from '$lib/state/features/finance-sync.svelte';
import { createActionRuntime } from '$lib/services/actions/runtime.svelte';

afterEach(() => {
  cleanup();
  financeSync.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('persistent finance monitor', () => {
  it('keeps one accepted job alive while the keyed route module is replaced', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () =>
      Response.json({
        jobId: 'job-a',
        active: true,
        status: 'running',
        processed: 0,
        total: 2,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const actions = createActionRuntime();
    actions.setScope('org-a');
    const view = render(Harness, { actions, scope: 'org-a', module: 'finances' });
    await tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(actions.backgroundJobs).toBe(1);
    expect(actions.size).toBe(1);
    const callsBeforeNavigation = fetchMock.mock.calls.length;
    await view.rerender({ actions, scope: 'org-a', module: 'stock' });
    await tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(actions.backgroundJobs).toBe(1);
    expect(actions.attentionRequired).toBe(0);
    expect(actions.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeNavigation);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeNavigation + 1);
    expect(actions.size).toBe(1);
    actions.dispose();
  });
});
