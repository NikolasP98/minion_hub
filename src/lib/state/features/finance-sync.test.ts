import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/paraglide/messages', () => ({
  fin_sync_status_unavailable: () => 'Sync status could not be confirmed.',
  fin_sync_unknown: () => 'Sync submission could not be confirmed.',
  fin_sync_error: () => 'Sync failed',
}));

describe('financeSync HTTP failure behavior', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('does not enter the running state when start is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Sync denied' }, { status: 403 })),
    );
    const { financeSync } = await import('./finance-sync.svelte');

    await financeSync.start('susii');

    expect(financeSync.active).toBe(false);
    expect(financeSync.status).toBe('error');
    expect(financeSync.error).toBe('Sync denied');
  });

  test('only enters the running state after a successful start response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({ active: true, status: 'running', total: 2, processed: 0 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { financeSync } = await import('./finance-sync.svelte');

    await financeSync.start('susii');

    expect(financeSync.active).toBe(true);
    expect(financeSync.status).toBe('running');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    financeSync.stop();
  });
});

describe('finance sync action tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function setup() {
    const { createFinanceSync } = await import('./finance-sync.svelte');
    const { createActionRuntime } = await import('$lib/services/actions/runtime.svelte');
    const sync = createFinanceSync();
    const actions = createActionRuntime();
    actions.setScope('org-a');
    return { sync, actions };
  }
  const running = () =>
    Response.json({ jobId: 'job-a', active: true, status: 'running', total: 2, processed: 1 });

  test('acceptance becomes one job; polls do not create foreground actions', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'job-a' }))
      .mockImplementationOnce(async () => running())
      .mockResolvedValueOnce(
        Response.json({
          jobId: 'job-a',
          active: false,
          status: 'succeeded',
          total: 2,
          processed: 3,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { sync, actions } = await setup();
    await sync.start('susii', actions);
    await vi.advanceTimersByTimeAsync(0);
    expect(actions.foregroundPending).toBe(0);
    expect(actions.backgroundJobs).toBe(1);
    expect(actions.size).toBe(1);
    expect(sync.percent).toBe(50);
    await vi.advanceTimersByTimeAsync(1500);
    expect(actions.backgroundJobs).toBe(0);
    expect(actions.get(1)?.status).toBe('succeeded');
    expect(sync.percent).toBe(100);
    expect(fetchMock.mock.calls[2][0]).toContain('jobId=job-a');
    sync.stop();
    actions.dispose();
  });

  test('transient status errors preserve accepted job and recover on next poll', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ jobId: 'job-a' }))
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockImplementation(async () => running()),
    );
    const { sync, actions } = await setup();
    await sync.start('susii', actions);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.active).toBe(true);
    expect(actions.backgroundJobs).toBe(1);
    expect(sync.error).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1500);
    expect(sync.error).toBeNull();
    expect(actions.size).toBe(1);
    sync.stop();
    actions.dispose();
  });

  test('an explicit server failure settles failed instead of reporting success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ jobId: 'job-a' }))
        .mockResolvedValueOnce(
          Response.json({
            jobId: 'job-a',
            active: false,
            status: 'failed',
            error: 'Provider unavailable',
          }),
        ),
    );
    const { sync, actions } = await setup();
    await sync.start('susii', actions);
    await vi.advanceTimersByTimeAsync(0);
    expect(actions.get(1)?.status).toBe('failed');
    expect(sync.error).toBe('Provider unavailable');
    actions.dispose();
  });

  test('scope change stops local observation without cancelling the server job', async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'job-a' }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { sync, actions } = await setup();
    await sync.start('susii', actions);
    actions.setScope('org-b');
    finish(running());
    await vi.advanceTimersByTimeAsync(5000);
    expect(sync.active).toBe(false);
    expect(sync.status).toBeNull();
    expect(actions.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    actions.dispose();
  });

  test('discovery resumes the accepted durable job without enqueueing another', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => running());
    vi.stubGlobal('fetch', fetchMock);
    const { sync, actions } = await setup();
    await Promise.all([sync.refresh('susii', actions), sync.refresh('susii', actions)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(actions.backgroundJobs).toBe(1);
    expect(actions.foregroundPending).toBe(0);
    expect(actions.size).toBe(1);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(true);
    sync.stop();
    actions.dispose();
  });

  test('unknown submission blocks a second POST, including after unrelated latest-status discovery', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(Response.json({ jobId: 'old-job', active: false, status: 'succeeded' }));
    vi.stubGlobal('fetch', fetchMock);
    const { sync, actions } = await setup();
    await sync.start('susii', actions);
    expect(sync.outcomeUnknown).toBe(true);
    await sync.start('susii', actions);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    await sync.refresh('susii', actions);
    expect(sync.outcomeUnknown).toBe(true);
    await sync.start('susii', actions);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    sync.reset();
    actions.dispose();
  });

  test('missing accepted identity is unknown, not a completed job', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));
    const { sync, actions } = await setup();
    await sync.start('susii', actions);
    await vi.advanceTimersByTimeAsync(0);
    expect(actions.get(1)?.status).toBe('unknown');
    expect(actions.backgroundJobs).toBe(0);
    actions.dispose();
  });
});
