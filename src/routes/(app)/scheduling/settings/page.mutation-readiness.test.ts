// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { page } from '$app/state';
import type { PageData } from './$types';

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$app/navigation', () => ({ invalidate }));

const { default: SchedulingSettingsPage } = await import('./+page.svelte');
const emptyData = { kinds: [] } as unknown as PageData;

afterEach(() => {
  cleanup();
  invalidate.mockClear();
  page.data = {};
  page.status = 200;
  page.error = null;
  vi.unstubAllGlobals();
});

describe('scheduling event-kind mutation readiness', () => {
  it('keeps a rejected create draft and clears it only after acknowledged retry', async () => {
    page.data = { permissions: { permissions: ['scheduling:edit'] } };
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ error: 'Kind already exists' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(null, { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(SchedulingSettingsPage, { props: { data: emptyData } });

    const name = screen.getByRole('textbox') as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Follow-up' } });
    const add = screen.getByRole('button', { name: /add|agregar/i });
    await fireEvent.click(add);

    await screen.findByRole('alert');
    expect(name.value).toBe('Follow-up');
    expect(invalidate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(add.hasAttribute('disabled')).toBe(false));

    await fireEvent.click(add);
    await vi.waitFor(() => expect(name.value).toBe(''));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
