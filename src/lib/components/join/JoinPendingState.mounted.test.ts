// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import JoinPendingState from './JoinPendingState.svelte';
import type { OwnPendingRequests } from '$server/services/join/pending.repository';
afterEach(cleanup);
const request = (id: string, organizationName: string) => ({
  id,
  organizationName,
  createdAt: '2026-10-03T10:00:00Z',
});
describe('actual join waiting state', () => {
  it('shows no-pending instead of a fabricated sent state', () => {
    const view = render(JoinPendingState, {
      pending: { kind: 'none', requests: [], hasMore: false },
      onrefresh: vi.fn(),
    });
    expect(view.getByRole('heading', { name: 'No pending requests' })).toBeTruthy();
    expect(view.getByRole('link', { name: 'Request access' }).getAttribute('href')).toBe('/join');
    expect(view.queryByText('Request sent')).toBeNull();
  });
  it('renders each own organization and escapes its display name', () => {
    const pending: OwnPendingRequests = {
      kind: 'many',
      requests: [request('a', 'Workspace A'), request('b', '<script>private()</script>')],
      hasMore: true,
    };
    const view = render(JoinPendingState, { pending, onrefresh: vi.fn() });
    expect(view.getAllByRole('listitem')).toHaveLength(2);
    expect(view.getByText('<script>private()</script>')).toBeTruthy();
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.getByText(/first 50/)).toBeTruthy();
  });
  it('refreshes once while pending and permits deliberate retry after a visible safe failure', async () => {
    let reject!: (reason: Error) => void;
    const onrefresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(undefined);
    const view = render(JoinPendingState, {
      pending: { kind: 'one', requests: [request('a', 'Workspace A')], hasMore: false },
      onrefresh,
    });
    const button = view.getByRole('button', { name: 'Check status' });
    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(onrefresh).toHaveBeenCalledTimes(1);
    reject(new Error('PRIVATE_PROVIDER'));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe(
        'Status could not be refreshed. Please try again.',
      ),
    );
    expect(view.container.textContent).not.toContain('PRIVATE_PROVIDER');
    await fireEvent.click(button);
    await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
    expect(onrefresh).toHaveBeenCalledTimes(2);
  });
});
