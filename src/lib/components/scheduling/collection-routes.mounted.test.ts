// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { tick } from 'svelte';
import { page } from '$app/state';

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('$app/state', async (original) => {
  const actual = await original<typeof import('$app/state')>();
  const { reactivePage } = await import('./__fixtures__/reactive-page.svelte');
  return { ...actual, page: reactivePage({ ...actual.page }) };
});
vi.mock('$app/navigation', async (original) => ({
  ...(await original<typeof import('$app/navigation')>()),
  invalidate,
}));
const { default: Links } = await import('../../../routes/(app)/scheduling/links/+page.svelte');
const { default: EventTypes } =
  await import('../../../routes/(app)/scheduling/event-types/+page.svelte');

const fetchMock = vi.fn();
const link = {
  id: 'link-a',
  title: 'Consultation',
  slug: 'consultation',
  eventTypeIds: ['event-a'],
};
const eventType = {
  id: 'event-a',
  title: 'Consultation',
  slug: 'consultation',
  length: 30,
  resourceIds: [],
  productId: null,
};
const linkData = () =>
  ({
    links: [link],
    eventTypes: [eventType],
    resources: [],
    origin: 'http://localhost',
  }) as unknown as ComponentProps<typeof Links>['data'];
const eventData = () =>
  ({
    eventTypes: [eventType],
    services: [],
    resources: [],
    kinds: [],
    tags: [],
    eventTypeTags: {},
  }) as unknown as ComponentProps<typeof EventTypes>['data'];
function mount(kind: 'links' | 'event-types') {
  return kind === 'links'
    ? render(Links, { data: linkData() })
    : render(EventTypes, { data: eventData() });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  page.data = {
    activeOrgId: 'org-a',
    user: { id: 'user-a' },
    permissions: {
      permissions: [
        'scheduling:manage',
        'scheduling:create',
        'scheduling:edit',
        'scheduling:delete',
      ],
    },
  };
  page.status = 200;
  page.error = null;
  fetchMock.mockReset();
  invalidate.mockReset();
  invalidate.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  page.data = {};
});

describe.each(['links', 'event-types'] as const)('%s production collection route', (kind) => {
  it.each([403, 409, 500])(
    'shows rejection for %s and keeps the row without refreshing',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('', { status }));
      const view = mount(kind);
      await fireEvent.click(view.getByRole('button', { name: 'Delete' }));
      expect((await view.findByRole('alert')).textContent).toContain('The change was rejected.');
      expect(view.getByText('Consultation')).toBeTruthy();
      expect(invalidate).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('serializes repeat clicks and offers read-only repair after a committed refresh error', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    invalidate.mockRejectedValueOnce(new Error('read failed'));
    const view = mount(kind);
    const remove = view.getByRole('button', { name: 'Delete' });
    await fireEvent.click(remove);
    await fireEvent.click(remove);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending.resolve(new Response(null, { status: 204 }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Saved. Refreshing'));
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(view.getByRole('button', { name: 'Reload current data' }));
    await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('treats a resolved route error as committed-refreshing', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    invalidate.mockImplementation(async () => {
      page.status = 500;
    });
    const view = mount(kind);
    await fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Saved. Refreshing'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps an uncertain delete locked until an explicit projection refresh', async () => {
    fetchMock.mockRejectedValue(new TypeError('response lost'));
    const view = mount(kind);
    const remove = view.getByRole('button', { name: 'Delete' });
    await fireEvent.click(remove);
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toContain('outcome is unknown'),
    );
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(view.getByRole('button', { name: 'Reload current data' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toContain('record is still present'),
    );
    expect((remove as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not offer a deletion with verb authority but without manage authority', () => {
    page.data = { permissions: { permissions: ['scheduling:delete', 'scheduling:create'] } };
    const view = mount(kind);
    expect(view.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'matches the server collection POST authority (manage+edit=%s)',
    (hasEdit) => {
      page.data = {
        permissions: {
          permissions: [
            'scheduling:manage',
            'scheduling:create',
            ...(hasEdit ? ['scheduling:edit'] : []),
          ],
        },
      };
      const view = mount(kind);
      const action = view.getByRole('button', {
        name: kind === 'links' ? 'New link' : 'Add service',
      });
      expect((action as HTMLButtonElement).disabled).toBe(!hasEdit);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('aborts observation on unmount and never refreshes after the late response', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const view = mount(kind);
    await fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve(new Response(null, { status: 204 }));
    await tick();
    await Promise.resolve();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('fences the old request when the organization changes while the page stays mounted', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const view = mount(kind);
    await fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    page.data = { ...page.data, activeOrgId: 'org-b' };
    await tick();
    expect(signal.aborted).toBe(true);
    pending.resolve(new Response(null, { status: 204 }));
    await tick();
    await Promise.resolve();
    expect(invalidate).not.toHaveBeenCalled();
    expect(view.queryByRole('alert')).toBeNull();
    expect((view.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('exposes a deadline as unknown and suppresses a late acknowledgement', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const view = mount(kind);
    vi.useFakeTimers();
    await fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    await vi.advanceTimersByTimeAsync(15_001);
    await tick();
    expect(view.getByRole('alert').textContent).toContain('outcome is unknown');
    expect((view.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
    pending.resolve(new Response(null, { status: 204 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('link creation from the production route', () => {
  async function draft() {
    const view = render(Links, { data: linkData() });
    await fireEvent.click(view.getByRole('button', { name: 'New link' }));
    await fireEvent.input(view.getByRole('textbox', { name: 'Title' }), {
      target: { value: '  Follow up  ' },
    });
    await fireEvent.click(view.getByRole('button', { name: 'Consultation' }));
    return view;
  }
  it('submits canonical intent once and preserves the draft on known rejection', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 403 }));
    const view = await draft();
    await fireEvent.click(view.getByRole('button', { name: 'Save' }));
    await view.findByRole('alert');
    expect((view.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
      '  Follow up  ',
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      title: 'Follow up',
      slug: 'follow-up',
      eventTypeIds: ['event-a'],
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'reconciles an uncertain create using exact title and ID-set identity (match=%s)',
    async (matches) => {
      fetchMock.mockRejectedValue(new TypeError('lost acknowledgement'));
      const view = await draft();
      await fireEvent.click(view.getByRole('button', { name: 'Save' }));
      await view.findByRole('alert');
      expect((view.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).disabled).toBe(
        true,
      );
      const refreshed = linkData();
      refreshed.links = [
        ...refreshed.links,
        {
          ...refreshed.links[0],
          id: 'new-link',
          title: matches ? 'Follow up' : 'Other title',
          slug: 'follow-up',
        },
      ];
      invalidate.mockImplementation(async () => {
        await view.rerender({ data: refreshed });
      });
      await fireEvent.click(view.getByRole('button', { name: 'Reload current data' }));
      if (matches)
        await waitFor(() => expect(view.queryByRole('textbox', { name: 'Title' })).toBeNull());
      else {
        const discard = await view.findByRole('button', {
          name: 'Discard this draft and start a new link',
        });
        expect((view.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).disabled).toBe(
          true,
        );
        await fireEvent.click(discard);
        expect((view.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('');
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('does not submit a selection removed from the refreshed authorized projection', async () => {
    const view = await draft();
    await view.rerender({ data: { ...linkData(), eventTypes: [] } });
    await fireEvent.click(view.getByRole('button', { name: 'Save' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
