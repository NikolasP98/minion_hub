// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/svelte';
import { page } from '$app/state';
import { tick } from 'svelte';

vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const syncPreferenceToServer = vi.fn();
vi.mock('$lib/state/ui/preference-sync.svelte', () => ({
  syncPreferenceToServer,
}));

const { default: AppointmentForm } = await import('./AppointmentForm.svelte');

const eventTypes = [
  { id: 'e1', title: 'Consulta', length: 30 },
  { id: 'e2', title: 'Limpieza', length: 45 },
];
const temporalProps = { timeZone: 'America/Lima', mutationScope: 'pos:org-1' } as const;
const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ slots: [] }),
  } as unknown as Response);
});

afterEach(() => {
  cleanup();
  syncPreferenceToServer.mockClear();
  page.data = {};
});

describe('AppointmentForm — picked services table', () => {
  it('renders the services table with the picked rows', () => {
    const view = render(AppointmentForm, {
      props: {
        eventTypes,
        resources: [],
        ...temporalProps,
        eventTypeId: 'e1',
        extraEventTypeIds: ['e2'],
        onbooked: vi.fn(),
        oncancel: vi.fn(),
      },
    });
    expect(view.getByText('Consulta')).toBeTruthy();
    expect(view.getByText('Limpieza')).toBeTruthy();
  });

  it('shows the quiet empty caption instead of the table when nothing is picked', () => {
    const view = render(AppointmentForm, {
      props: {
        eventTypes,
        resources: [],
        ...temporalProps,
        onbooked: vi.fn(),
        oncancel: vi.fn(),
      },
    });
    expect(view.getByText('No services yet')).toBeTruthy();
  });

  it('hides a column via the kebab and syncs the preference to the server', async () => {
    const view = render(AppointmentForm, {
      props: {
        eventTypes,
        resources: [],
        ...temporalProps,
        eventTypeId: 'e1',
        onbooked: vi.fn(),
        oncancel: vi.fn(),
      },
    });
    const kebab = view.getByRole('button', { name: 'Table columns' });
    await fireEvent.click(kebab);
    const priceItem = await view.findByRole('menuitem', { name: 'Price' });
    // Zag's menu selects the HIGHLIGHTED item on click — a plain click with no
    // preceding pointer move never highlights it, so `onSelect` sees a null
    // value and no-ops (menu.machine.js `invokeOnSelect`).
    await fireEvent.pointerMove(priceItem, { pointerType: 'mouse' });
    await fireEvent.click(priceItem);
    await waitFor(() =>
      expect(syncPreferenceToServer).toHaveBeenCalledWith('appointmentServicesColumns', ['price']),
    );
  });

  it('opens the service picker from the "Add service" button', async () => {
    const view = render(AppointmentForm, {
      props: {
        eventTypes,
        resources: [],
        ...temporalProps,
        onbooked: vi.fn(),
        oncancel: vi.fn(),
      },
    });
    await fireEvent.click(view.getByRole('button', { name: /Add service/ }));
    await waitFor(() => expect(view.getByRole('dialog')).toBeTruthy());
  });

  it('renders the customer section before the services section', () => {
    const view = render(AppointmentForm, {
      props: {
        eventTypes,
        resources: [],
        ...temporalProps,
        onbooked: vi.fn(),
        oncancel: vi.fn(),
      },
    });
    const customerEl = view.container.querySelector('.customer');
    const servicesEl = view.container.querySelector('.svc-section');
    expect(customerEl).toBeTruthy();
    expect(servicesEl).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(
      customerEl!.compareDocumentPosition(servicesEl!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('AppointmentForm — slot lookup failures', () => {
  it('uses the POS slot route and reports a 403 as unavailable instead of no slots', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as unknown as Response);
    const view = render(AppointmentForm, {
      props: {
        eventTypes,
        resources: [],
        ...temporalProps,
        initialDate: '2026-10-03',
        eventTypeId: 'e1',
        bookEndpoint: '/api/pos/tickets/t1/schedule',
        onbooked: vi.fn(),
        oncancel: vi.fn(),
      },
    });

    expect(await view.findByText('Available times could not be loaded.')).toBeTruthy();
    expect(view.queryByText('No times available — try another day.')).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/pos/appointments/slots?eventTypeId=e1&from=2026-10-03T05:00:00.000Z&to=2026-10-04T05:00:00.000Z',
    );
  });

  it('recovers from a network failure when Retry succeeds', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network unavailable')).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        slots: [{ start: '2026-10-03T14:00:00.000Z', end: '2026-10-03T14:30:00.000Z' }],
      }),
    } as unknown as Response);
    const view = render(AppointmentForm, {
      props: {
        eventTypes,
        resources: [],
        ...temporalProps,
        initialDate: '2026-10-03',
        eventTypeId: 'e1',
        onbooked: vi.fn(),
        oncancel: vi.fn(),
      },
    });

    await fireEvent.click(await view.findByRole('button', { name: 'Retry' }));
    expect(await view.findByRole('button', { name: '09:00' })).toBeTruthy();
    expect(view.queryByText('Available times could not be loaded.')).toBeNull();
  });

  it('blocks a nonexistent manual wall time before the booking request', async () => {
    const view = render(AppointmentForm, {
      props: {
        eventTypes,
        resources: [{ id: 'r1', name: 'Room 1' }],
        timeZone: 'America/New_York',
        mutationScope: 'pos:org-1',
        initialDate: '2026-03-08',
        initialResourceId: 'r1',
        initialCustomerName: 'Synthetic client',
        eventTypeId: 'e1',
        canBook: true,
        onbooked: vi.fn(),
        oncancel: vi.fn(),
      },
    });

    await view.findByText('No times available — try another day.');
    await fireEvent.click(view.container.querySelector('input[type="checkbox"]')!);
    const override = view.container.querySelector('input[type="time"]') as HTMLInputElement;
    await fireEvent.input(override, { target: { value: '02:30' } });
    await fireEvent.click(view.getByRole('button', { name: 'Confirm booking' }));

    expect(
      await view.findByText(
        'That local time does not exist in this timezone. Choose another time.',
      ),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes('/slots?'))).toBe(true);
  });

  it('cancels a manual override captured before the organization scope changes', async () => {
    const baseProps = {
      eventTypes,
      resources: [{ id: 'r1', name: 'Room 1' }],
      initialDate: '2026-10-03',
      initialResourceId: 'r1',
      initialCustomerName: 'Synthetic client',
      eventTypeId: 'e1',
      canBook: true,
      onbooked: vi.fn(),
      oncancel: vi.fn(),
    };
    const view = render(AppointmentForm, {
      props: { ...baseProps, timeZone: 'America/Lima', mutationScope: 'pos:org-1' },
    });

    await view.findByText('No times available — try another day.');
    await fireEvent.click(view.container.querySelector('input[type="checkbox"]')!);
    const override = view.container.querySelector('input[type="time"]') as HTMLInputElement;
    await fireEvent.input(override, { target: { value: '09:00' } });
    await tick();

    await view.rerender({
      ...baseProps,
      timeZone: 'Asia/Tokyo',
      mutationScope: 'pos:org-2',
    });
    const confirm = view.getByRole('button', { name: 'Confirm booking' }) as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(false));
    await fireEvent.click(confirm);

    expect(
      await view.findByText(
        'The organization or timezone changed while you were working on this appointment. Try again.',
      ),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes('/slots?'))).toBe(true);
  });

  it('keeps a booking submit gated when a concurrent slot reload settles', async () => {
    let resolvePost!: (response: Response) => void;
    const post = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    fetchMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') return post;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ slots: [] }),
      } as unknown as Response);
    });
    const onbooked = vi.fn();
    const view = render(AppointmentForm, {
      props: {
        eventTypes,
        resources: [{ id: 'r1', name: 'Room 1' }],
        ...temporalProps,
        initialDate: '2026-10-03',
        initialResourceId: 'r1',
        initialCustomerName: 'Synthetic client',
        eventTypeId: 'e1',
        canBook: true,
        onbooked,
        oncancel: vi.fn(),
      },
    });

    await view.findByText('No times available — try another day.');
    await fireEvent.click(view.container.querySelector('input[type="checkbox"]')!);
    await fireEvent.input(view.container.querySelector('input[type="time"]')!, {
      target: { value: '09:00' },
    });
    const confirm = view.getByRole('button', { name: 'Confirm booking' }) as HTMLButtonElement;
    await fireEvent.click(confirm);
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
    );

    await fireEvent.change(view.container.querySelector('input[type="date"]')!, {
      target: { value: '2026-10-04' },
    });
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST')).toHaveLength(2),
    );
    expect(confirm.disabled).toBe(true);
    await fireEvent.click(confirm);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);

    resolvePost({
      ok: true,
      status: 200,
      json: async () => ({
        booking: { id: 'b1', startTime: '2026-10-03T14:00:00.000Z' },
        created: true,
      }),
    } as unknown as Response);
    await waitFor(() => expect(onbooked).toHaveBeenCalledTimes(1));
  });

  it('does not apply an acknowledged booking result after the scope changes mid-POST', async () => {
    let resolvePost!: (response: Response) => void;
    const post = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    fetchMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') return post;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          slots: [{ start: '2026-10-03T14:00:00.000Z', end: '2026-10-03T14:30:00.000Z' }],
        }),
      } as unknown as Response);
    });
    const oldCallback = vi.fn();
    const newCallback = vi.fn();
    const baseProps = {
      eventTypes,
      resources: [{ id: 'r1', name: 'Room 1' }],
      initialDate: '2026-10-03',
      initialResourceId: 'r1',
      initialCustomerName: 'Synthetic client',
      eventTypeId: 'e1',
      canBook: true,
      oncancel: vi.fn(),
    };
    const view = render(AppointmentForm, {
      props: {
        ...baseProps,
        timeZone: 'America/Lima',
        mutationScope: 'pos:org-1',
        onbooked: oldCallback,
      },
    });

    await fireEvent.click(await view.findByRole('button', { name: '09:00' }));
    await fireEvent.click(view.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
    );
    await view.rerender({
      ...baseProps,
      timeZone: 'Asia/Tokyo',
      mutationScope: 'pos:org-2',
      bookEndpoint: '/api/pos/appointments',
      onbooked: newCallback,
    });

    resolvePost({
      ok: true,
      status: 200,
      json: async () => ({
        booking: { id: 'old-b', startTime: '2026-10-03T14:00:00.000Z' },
        created: true,
      }),
    } as unknown as Response);
    await waitFor(() =>
      expect((view.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(oldCallback).not.toHaveBeenCalled();
    expect(newCallback).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
