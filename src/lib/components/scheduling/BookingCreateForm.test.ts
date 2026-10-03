// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { page } from '$app/state';

vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const gotoMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/components/scheduling/ServicePickerField.svelte', async () => ({
  default: (await import('./__fixtures__/BookingCreateServiceFieldStub.svelte')).default,
}));

const { default: BookingCreateForm } = await import('./BookingCreateForm.svelte');

const eventTypes = [
  {
    id: 'e1',
    title: 'Consulta',
    productId: 'p1',
    active: true,
    length: 30,
    kindId: null,
  },
];
const contact = {
  id: 'c1',
  partyId: 'party-1',
  name: 'Synthetic client',
  phone: '999999999',
};
const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
});

beforeEach(() => {
  page.data = { permissions: { permissions: ['scheduling:edit'] } };
  page.url = new URL(
    'http://localhost/scheduling/bookings/new?date=2026-10-03',
  ) as unknown as typeof page.url;
  fetchMock.mockReset();
  gotoMock.mockClear();
});

afterEach(() => {
  cleanup();
  page.data = {};
});

function slotResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      slots: [{ start: '2026-10-03T14:00:00.000Z', end: '2026-10-03T14:30:00.000Z' }],
    }),
  } as unknown as Response;
}

describe('BookingCreateForm — submit readiness', () => {
  it('keeps one primary write in flight while a slot reload settles', async () => {
    let resolvePost!: (response: Response) => void;
    const post = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    fetchMock.mockImplementation((_input, init) =>
      init?.method === 'POST' ? post : Promise.resolve(slotResponse()),
    );
    const view = render(BookingCreateForm, {
      props: {
        eventTypes,
        contact,
        timeZone: 'America/Lima',
        mutationScope: 'scheduling:org-1',
      },
    });
    await fireEvent.click(view.getByRole('button', { name: 'Select Consulta' }));
    await fireEvent.click(await view.findByRole('button', { name: '09:00' }));

    const confirm = view.getByRole('button', { name: 'Confirm booking' }) as HTMLButtonElement;
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
    );

    const readsBeforeReload = fetchMock.mock.calls.filter(
      ([, init]) => init?.method !== 'POST',
    ).length;
    await fireEvent.change(view.container.querySelector('input[type="date"]')!, {
      target: { value: '2026-10-04' },
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST').length,
      ).toBeGreaterThan(readsBeforeReload),
    );
    expect(confirm.disabled).toBe(true);

    resolvePost({
      ok: true,
      status: 201,
      json: async () => ({ booking: { id: 'b1' } }),
    } as unknown as Response);
    await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
    expect(confirm.disabled).toBe(true);
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('does not navigate an acknowledged old-scope booking into the new scope', async () => {
    let resolvePost!: (response: Response) => void;
    const post = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    fetchMock.mockImplementation((_input, init) =>
      init?.method === 'POST' ? post : Promise.resolve(slotResponse()),
    );
    const baseProps = { eventTypes, contact };
    const view = render(BookingCreateForm, {
      props: {
        ...baseProps,
        timeZone: 'America/Lima',
        mutationScope: 'scheduling:org-1',
      },
    });
    await fireEvent.click(view.getByRole('button', { name: 'Select Consulta' }));
    await fireEvent.click(await view.findByRole('button', { name: '09:00' }));
    await fireEvent.click(view.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
    );

    await view.rerender({
      ...baseProps,
      timeZone: 'Asia/Tokyo',
      mutationScope: 'scheduling:org-2',
    });
    resolvePost({
      ok: true,
      status: 201,
      json: async () => ({ booking: { id: 'old-b' } }),
    } as unknown as Response);

    await waitFor(() =>
      expect(view.getByRole('link', { name: 'Cancel' }).getAttribute('aria-disabled')).not.toBe(
        'true',
      ),
    );
    expect(gotoMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
