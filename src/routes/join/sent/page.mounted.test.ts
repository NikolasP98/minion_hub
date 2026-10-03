// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { page } from '$app/state';

const invalidateAll = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$app/navigation', () => ({ invalidateAll }));
const { default: JoinSentPage } = await import('./+page.svelte');

afterEach(() => {
  cleanup();
  invalidateAll.mockReset();
  page.error = null;
  page.status = 200;
});

describe('join waiting route composition and refresh', () => {
  it('renders the shared public shell and checks route status after refreshing', async () => {
    const view = render(JoinSentPage, {
      data: { pending: { kind: 'none', requests: [], hasMore: false } },
    });
    expect(view.getByRole('heading', { name: 'No pending requests' })).toBeTruthy();
    const main = view.getByRole('main');
    expect(main.classList.contains('public-task-scroll')).toBe(true);
    const panel = view.getByRole('region', { name: 'No pending requests' });
    expect(panel.classList.contains('task-panel')).toBe(true);
    expect(main.contains(panel)).toBe(true);
    expect(view.getByRole('link', { name: 'Request access' }).getAttribute('href')).toBe('/join');
    invalidateAll.mockImplementationOnce(async () => {
      page.status = 500;
      page.error = { message: 'PRIVATE_BACKEND_DETAIL' };
    });
    await fireEvent.click(view.getByRole('button', { name: 'Check status' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe(
        'Status could not be refreshed. Please try again.',
      ),
    );
    expect(view.container.textContent).not.toContain('PRIVATE_BACKEND_DETAIL');
    invalidateAll.mockImplementationOnce(async () => {
      page.status = 200;
      page.error = null;
    });
    await fireEvent.click(view.getByRole('button', { name: 'Check status' }));
    await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
    expect(invalidateAll).toHaveBeenCalledTimes(2);
  });
});
