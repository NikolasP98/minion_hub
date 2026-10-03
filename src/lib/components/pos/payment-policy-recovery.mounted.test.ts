// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PaymentPolicyRecoveryHarness from './__fixtures__/PaymentPolicyRecoveryHarness.svelte';

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

afterEach(cleanup);

describe('mounted POS payment policy recovery', () => {
  it('retains drafts, blocks a failed reload and requires a second explicit Finish after review', async () => {
    const failedReload = vi.fn().mockRejectedValue(new Error('offline'));
    const successfulReload = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ error: 'Policy changed.', code: 'pos_settings_changed' }, 409),
      )
      .mockResolvedValueOnce(
        response(
          {
            ok: true,
            ticket: { id: 'ticket-1', humanId: 'T-1' },
            stockWarning: null,
          },
          201,
        ),
      );
    const view = render(PaymentPolicyRecoveryHarness, {
      props: {
        actorId: 'actor-a',
        orgId: 'org-a',
        revision: REVISION_A,
        reload: failedReload,
        fetcher,
      },
    });

    await fireEvent.click(view.getByRole('button', { name: 'Finish sale' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('reload failed'));
    expect((view.getByRole('button', { name: 'Finish sale' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(view.getByTestId('cart').textContent).toBe('Service A');
    expect(view.getByTestId('tender').textContent).toBe('10.00');
    expect(fetcher).toHaveBeenCalledTimes(1);

    await view.rerender({
      actorId: 'actor-a',
      orgId: 'org-a',
      revision: REVISION_B,
      reload: successfulReload,
      fetcher,
    });
    await fireEvent.click(view.getByRole('button', { name: 'Retry policy' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Review'));
    expect((view.getByRole('button', { name: 'Finish sale' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);

    await fireEvent.click(view.getByRole('button', { name: 'Finish sale' }));
    await waitFor(() => expect(view.getByText('Ticket committed')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(view.getByTestId('policy-state').textContent).toBe('idle');
  });

  it('suppresses an old reload completion after actor and organization replacement', async () => {
    const reload = deferred<void>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ error: 'Policy changed.', code: 'pos_settings_changed' }, 409));
    const view = render(PaymentPolicyRecoveryHarness, {
      props: {
        actorId: 'actor-a',
        orgId: 'org-a',
        revision: REVISION_A,
        reload: () => reload.promise,
        fetcher,
      },
    });

    await fireEvent.click(view.getByRole('button', { name: 'Finish sale' }));
    await waitFor(() => expect(view.getByText('Refreshing payment policy')).toBeTruthy());
    await view.rerender({
      actorId: 'actor-b',
      orgId: 'org-b',
      revision: REVISION_B,
      reload: () => reload.promise,
      fetcher,
    });
    await waitFor(() => expect(view.getByTestId('policy-state').textContent).toBe('idle'));

    reload.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(view.getByTestId('owner').textContent).toBe('actor-b:org-b');
    expect(view.getByTestId('policy-state').textContent).toBe('idle');
    expect(view.queryByText('Review payment policy')).toBeNull();
    expect(view.queryByText('Payment policy reload failed')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not reinterpret an old rejection as the replacement owner policy', async () => {
    const transport = deferred<Response>();
    const reload = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => transport.promise);
    const view = render(PaymentPolicyRecoveryHarness, {
      props: {
        actorId: 'actor-a',
        orgId: 'org-a',
        revision: REVISION_A,
        reload,
        fetcher,
      },
    });

    await fireEvent.click(view.getByRole('button', { name: 'Finish sale' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await view.rerender({
      actorId: 'actor-b',
      orgId: 'org-b',
      revision: REVISION_B,
      reload,
      fetcher,
    });
    await waitFor(() =>
      expect(
        (view.getByRole('button', { name: 'Finish sale' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    transport.resolve(response({ error: 'Policy changed.', code: 'pos_settings_changed' }, 409));

    await waitFor(() =>
      expect(view.getByTestId('last-attempt').textContent).toBe('rejected-stale'),
    );
    expect(reload).not.toHaveBeenCalled();
    expect(view.getByTestId('policy-state').textContent).toBe('idle');
    expect(view.queryByText('Review payment policy')).toBeNull();
    expect(view.queryByText('Payment policy reload failed')).toBeNull();
  });

  it('retains a committed receipt but applies no stale effects after A to B to A', async () => {
    const transport = deferred<Response>();
    const reload = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => transport.promise);
    const view = render(PaymentPolicyRecoveryHarness, {
      props: {
        actorId: 'actor-a',
        orgId: 'org-a',
        revision: REVISION_A,
        reload,
        fetcher,
      },
    });

    await fireEvent.click(view.getByRole('button', { name: 'Finish sale' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await view.rerender({
      actorId: 'actor-b',
      orgId: 'org-b',
      revision: REVISION_B,
      reload,
      fetcher,
    });
    await waitFor(() => expect(view.getByTestId('owner').textContent).toBe('actor-b:org-b'));
    expect((view.getByRole('button', { name: 'Finish sale' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    await view.rerender({
      actorId: 'actor-a',
      orgId: 'org-a',
      revision: REVISION_A,
      reload,
      fetcher,
    });
    await waitFor(() => expect(view.getByTestId('owner').textContent).toBe('actor-a:org-a'));

    transport.resolve(
      response(
        {
          ok: true,
          ticket: { id: 'ticket-stale', humanId: 'T-STALE' },
          stockWarning: null,
        },
        201,
      ),
    );

    await waitFor(() =>
      expect(view.getByTestId('last-attempt').textContent).toBe('committed-stale'),
    );
    expect(view.getByTestId('committed-receipt').textContent).toBe('ticket-stale');
    expect(view.queryByText('Ticket committed')).toBeNull();
    expect(view.getByTestId('cart').textContent).toBe('Service A');
    expect(view.getByTestId('tender').textContent).toBe('10.00');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('retires later refresh and navigation effects when scope changes after commit', async () => {
    const firstRefresh = deferred<void>();
    const secondRefresh = vi.fn().mockResolvedValue(undefined);
    const onReady = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          ok: true,
          ticket: { id: 'ticket-a', humanId: 'T-A' },
          stockWarning: null,
        },
        201,
      ),
    );
    const view = render(PaymentPolicyRecoveryHarness, {
      props: {
        actorId: 'actor-a',
        orgId: 'org-a',
        revision: REVISION_A,
        reload: vi.fn().mockResolvedValue(undefined),
        fetcher,
        postCommitRefreshes: [() => firstRefresh.promise, secondRefresh],
        onPostCommitReady: onReady,
      },
    });

    await fireEvent.click(view.getByRole('button', { name: 'Finish sale' }));
    await waitFor(() => expect(view.getByTestId('committed-receipt').textContent).toBe('ticket-a'));
    await view.rerender({
      actorId: 'actor-b',
      orgId: 'org-b',
      revision: REVISION_B,
      reload: vi.fn().mockResolvedValue(undefined),
      fetcher,
      postCommitRefreshes: [() => firstRefresh.promise, secondRefresh],
      onPostCommitReady: onReady,
    });
    firstRefresh.resolve();

    await waitFor(() => expect(view.getByTestId('repair-status').textContent).toBe('stale'));
    expect(secondRefresh).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(view.queryByRole('alert')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports a committed refresh failure without replay or navigation', async () => {
    const onReady = vi.fn();
    const refreshError = new Error('route failed after commit');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          ok: true,
          ticket: { id: 'ticket-committed', humanId: 'T-COMMITTED' },
          stockWarning: null,
        },
        201,
      ),
    );
    const view = render(PaymentPolicyRecoveryHarness, {
      props: {
        actorId: 'actor-a',
        orgId: 'org-a',
        revision: REVISION_A,
        reload: vi.fn().mockResolvedValue(undefined),
        fetcher,
        postCommitRefreshes: [vi.fn().mockRejectedValue(refreshError)],
        onPostCommitReady: onReady,
      },
    });

    await fireEvent.click(view.getByRole('button', { name: 'Finish sale' }));
    await waitFor(() =>
      expect(view.getByTestId('repair-status').textContent).toBe('committed-refreshing'),
    );
    expect(view.getByTestId('committed-receipt').textContent).toBe('ticket-committed');
    expect(view.getByRole('alert').textContent).toContain('Do not submit again');
    expect(onReady).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
