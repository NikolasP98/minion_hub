// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import ConfirmDialog from './ConfirmDialog.svelte';
afterEach(cleanup);
describe('confirmation recovery', () => {
  it('retains failure and blocks replay when the result is uncertain', async () => {
    const onconfirm = vi.fn().mockRejectedValue(new Error('Lost response'));
    const view = render(ConfirmDialog, {
      open: true,
      title: 'Delete record',
      message: 'Delete Alpha?',
      confirmLabel: 'Delete Alpha',
      failureMessage: 'Review the record before a new change',
      retryable: true,
      onconfirm,
    });
    const action = view.getByRole('button', { name: 'Delete Alpha' });
    await fireEvent.click(action);
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Review the record'));
    await view.rerender({ retryable: false });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(action);
    expect(onconfirm).toHaveBeenCalledTimes(1);
  });
  it('keeps a rejected operation open and permits a deliberate retry', async () => {
    const onconfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('Rejected'))
      .mockResolvedValue(undefined);
    const done = vi.fn();
    const view = render(ConfirmDialog, {
      open: true,
      title: 'Delete record',
      message: 'Delete Alpha?',
      confirmLabel: 'Delete Alpha',
      failureMessage: 'Try again',
      onconfirm,
      onconfirmed: done,
    });
    await fireEvent.click(view.getByRole('button', { name: 'Delete Alpha' }));
    await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
    expect(done).not.toHaveBeenCalled();
    await fireEvent.click(view.getByRole('button', { name: 'Delete Alpha' }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(onconfirm).toHaveBeenCalledTimes(2);
  });
});
