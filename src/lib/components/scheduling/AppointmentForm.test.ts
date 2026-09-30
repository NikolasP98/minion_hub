// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/svelte';
import { page } from '$app/state';

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

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ slots: [] }) }) as unknown as Response),
  );
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
      props: { eventTypes, resources: [], onbooked: vi.fn(), oncancel: vi.fn() },
    });
    expect(view.getByText('No services yet')).toBeTruthy();
  });

  it('hides a column via the kebab and syncs the preference to the server', async () => {
    const view = render(AppointmentForm, {
      props: {
        eventTypes,
        resources: [],
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
      props: { eventTypes, resources: [], onbooked: vi.fn(), oncancel: vi.fn() },
    });
    await fireEvent.click(view.getByRole('button', { name: /Add service/ }));
    await waitFor(() => expect(view.getByRole('dialog')).toBeTruthy());
  });

  it('renders the customer section before the services section', () => {
    const view = render(AppointmentForm, {
      props: { eventTypes, resources: [], onbooked: vi.fn(), oncancel: vi.fn() },
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
