// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import TagsField from './TagsField.svelte';
import { ApiError } from '$lib/api/fetch-json';
import { toastError } from '$lib/state/ui/toast.svelte';
vi.mock('$lib/state/ui/toast.svelte', () => ({ toastError: vi.fn() }));
vi.mock('$lib/records/peek-registry', () => ({ resolvePeekPage: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const tag = { id: 'a', name: 'Alpha', color: '#123456' };
describe('async tag selection', () => {
  it('shows intent immediately, blocks re-entry and restores a rejected selection', async () => {
    let finish!: (value: boolean) => void;
    const view = render(TagsField, {
      scope: 'crm',
      scopeKey: 'one',
      allTags: [tag],
      value: ['a'],
      onchange: () => new Promise<boolean>((resolve) => (finish = resolve)),
    });
    await tick();
    await fireEvent.click(view.getByRole('button', { name: 'Remove tag' }));
    await tick();
    expect(view.container.querySelector('.tag-chip-name')).toBeNull();
    expect(document.querySelector('.tags-field')?.getAttribute('aria-busy')).toBe('true');
    finish(false);
    await waitFor(() =>
      expect(view.container.querySelector('.tag-chip-name')?.textContent).toBe('Alpha'),
    );
    expect(toastError).toHaveBeenCalledOnce();
  });
  it('rolls back a confirmed HTTP rejection, while unknown acknowledgement keeps the draft', async () => {
    const failure = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Denied', 'forbidden', 403))
      .mockRejectedValueOnce(new Error('lost response'));
    const view = render(TagsField, {
      scope: 'crm',
      scopeKey: 'one',
      allTags: [tag],
      value: ['a'],
      onchange: failure,
    });
    await tick();
    await fireEvent.click(view.getByRole('button', { name: 'Remove tag' }));
    await tick();
    await waitFor(() =>
      expect(view.container.querySelector('.tag-chip-name')?.textContent).toBe('Alpha'),
    );
    await tick();
    await fireEvent.click(view.getByRole('button', { name: 'Remove tag' }));
    await tick();
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    expect(view.container.querySelector('.tag-chip-name')).toBeNull();
  });
});
