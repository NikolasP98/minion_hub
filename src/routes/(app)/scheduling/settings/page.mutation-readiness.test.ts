// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { page } from '$app/state';
import type { PageData } from './$types';
import { createActionRuntime } from '$lib/services/actions/runtime.svelte';
import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$app/navigation', () => ({ invalidate }));
const tryUseActions = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/actions/context', () => ({ tryUseActions }));

const { default: SchedulingSettingsPage } = await import('./+page.svelte');
const emptyData = { kinds: [] } as unknown as PageData;

afterEach(() => {
  cleanup();
  invalidate.mockClear();
  invalidate.mockResolvedValue(undefined);
  page.data = {};
  page.status = 200;
  page.error = null;
  vi.unstubAllGlobals();
  tryUseActions.mockReset();
});

describe('scheduling event-kind mutation readiness', () => {
  it('retires an organization-owned create draft when the action scope changes', async () => {
    const actions = createActionRuntime();
    actions.setScope('org-a');
    tryUseActions.mockReturnValue(actions);
    page.data = { permissions: { permissions: ['scheduling:edit'] } };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const view = render(SchedulingSettingsPage, { props: { data: emptyData } });
    const name = screen.getByRole('textbox') as HTMLInputElement;
    const color = view.container.querySelector('input[type=color]') as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Org A draft' } });
    await fireEvent.input(color, { target: { value: '#123456' } });
    expect(name.value).toBe('Org A draft');
    actions.setScope('org-b');
    await vi.waitFor(() => expect(name.value).toBe(''));
    expect(color.value).toBe(CRM_TAG_COLORS[0]);
    await fireEvent.click(screen.getByRole('button', { name: /add|agregar/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    actions.dispose();
  });

  it('blocks an unknown create until a successful read repair without replaying POST', async () => {
    page.data = { permissions: { permissions: ['scheduling:edit'] } };
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('response lost'));
    vi.stubGlobal('fetch', fetchMock);
    render(SchedulingSettingsPage, { props: { data: emptyData } });
    const name = screen.getByRole('textbox') as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Uncertain kind' } });
    const add = screen.getByRole('button', { name: /add|agregar/i });
    await fireEvent.click(add);
    await screen.findByRole('alert');
    expect(add.hasAttribute('disabled')).toBe(true);
    const reload = screen.getByRole('button', { name: /reload current data/i });
    invalidate.mockRejectedValueOnce(new Error('read unavailable'));
    await fireEvent.click(reload);
    await vi.waitFor(() => expect(reload.hasAttribute('disabled')).toBe(false));
    expect(add.hasAttribute('disabled')).toBe(true);
    expect(name.value).toBe('Uncertain kind');
    await fireEvent.click(reload);
    await vi.waitFor(() => expect(add.hasAttribute('disabled')).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('repairs a committed refresh failure using reads only', async () => {
    page.data = { permissions: { permissions: ['scheduling:edit'] } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    invalidate.mockRejectedValueOnce(new Error('read unavailable'));
    render(SchedulingSettingsPage, { props: { data: emptyData } });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Saved kind' } });
    await fireEvent.click(screen.getByRole('button', { name: /add|agregar/i }));
    await screen.findByRole('alert');
    await fireEvent.click(screen.getByRole('button', { name: /reload current data/i }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('disables every row while the page admits only one mutation', async () => {
    page.data = { permissions: { permissions: ['scheduling:edit'] } };
    let acknowledge!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            acknowledge = resolve;
          }),
      ),
    );
    render(SchedulingSettingsPage, {
      props: {
        data: {
          kinds: [
            { id: 'a', name: 'Kind A', color: '#112233', isDefault: false },
            { id: 'b', name: 'Kind B', color: '#445566', isDefault: false },
          ],
        } as unknown as PageData,
      },
    });
    await fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    expect((screen.getByDisplayValue('Kind B') as HTMLInputElement).disabled).toBe(true);
    acknowledge(new Response(null, { status: 204 }));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect((screen.getByDisplayValue('Kind B') as HTMLInputElement).disabled).toBe(false);
  });

  it('preserves a newer create draft when the earlier submission acknowledges', async () => {
    page.data = { permissions: { permissions: ['scheduling:edit'] } };
    let acknowledge!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          acknowledge = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(SchedulingSettingsPage, { props: { data: emptyData } });
    const name = screen.getByRole('textbox') as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'First kind' } });
    await fireEvent.click(screen.getByRole('button', { name: /add|agregar/i }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).name).toBe('First kind');
    await fireEvent.input(name, { target: { value: 'Next kind draft' } });
    acknowledge(new Response(null, { status: 201 }));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(name.value).toBe('Next kind draft');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
