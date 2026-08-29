// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import type { BookingCapabilities, BookingsViewData } from './bookings-view';

/**
 * Slice 3 of `2026-08-17-hub-pos-appointments-fork-spec`: `/pos/appointments`
 * stopped being a 732-line fork and now renders the shared `BookingsView` with a
 * POS capability set. These tests pin the capability contract itself — that the
 * POS-only affordances appear only when their capability is on, and that the
 * scheduling surface is unchanged when they are off. A shared view that leaks
 * either way is the feature change the spec forbids.
 */

const navigation = vi.hoisted(() => ({ invalidate: vi.fn(), goto: vi.fn() }));
vi.mock('$lib/navigation', () => navigation);

const access = vi.hoisted(() => ({
  canAct: vi.fn((_module: string, _action: string) => true),
}));
vi.mock('$lib/access/can.svelte', () => ({
  canAct: (module: string, action: string) => access.canAct(module, action),
}));

const { default: BookingsView } = await import('./BookingsView.svelte');

const NOW = new Date('2026-08-18T12:00:00.000Z');
const todayAt = (hhmm: string) => {
  const d = new Date(NOW);
  const [h, min] = hhmm.split(':').map(Number);
  d.setHours(h, min, 0, 0);
  return d.toISOString();
};
const inThreeDays = () => new Date(NOW.getTime() + 3 * 86_400_000).toISOString();

const TODAY_DONE = {
  id: 'b-done',
  status: 'completed',
  startTime: todayAt('09:00'),
  eventTypeId: 'e1',
  resourceId: 'r1',
  attendeeName: 'Jane Doe',
  attendeePhone: '+51999111222',
  partyId: 'party-1',
  productId: 'prod-booking',
};
const TODAY_OPEN = {
  id: 'b-open',
  status: 'accepted',
  startTime: todayAt('11:00'),
  eventTypeId: 'e1',
  resourceId: 'r1',
  attendeeName: 'Ana Ruiz',
  attendeePhone: null,
};
const LATER_OPEN = {
  id: 'b-later',
  status: 'accepted',
  startTime: inThreeDays(),
  eventTypeId: 'e1',
  resourceId: 'r1',
  attendeeName: 'Luis Vega',
  attendeePhone: null,
};

const DATA: BookingsViewData = {
  bookings: [TODAY_DONE, TODAY_OPEN, LATER_OPEN],
  resources: [{ id: 'r1', name: 'Front chair' }],
  eventTypes: [{ id: 'e1', title: 'Haircut', productId: 'prod-event-type' }],
  stockEnabled: false,
  accrualSummaries: [],
};

const POS_CAPABILITIES: BookingCapabilities = {
  createSalesOrder: false,
  chargeToPos: true,
  dayAgenda: true,
  staffOverride: true,
};
const SCHEDULING_CAPABILITIES: BookingCapabilities = { createSalesOrder: true };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  access.canAct.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BookingsView — POS capability set', () => {
  const renderPos = (onCharge = vi.fn()) => ({
    onCharge,
    ...render(BookingsView, {
      props: {
        data: DATA,
        capabilities: POS_CAPABILITIES,
        invalidateKey: 'pos:appointments',
        labelNamespace: 'pos' as const,
        onCharge,
      },
    }),
  });

  it('opens on today only and reveals the rest of the window on the week range', async () => {
    const { queryAllByText, getByText } = renderPos();

    // Day agenda: today's two bookings are bucketed under one day heading; the
    // booking three days out is filtered out client-side until "week" is picked.
    expect(queryAllByText('Jane Doe')).toHaveLength(1);
    expect(queryAllByText('Ana Ruiz')).toHaveLength(1);
    expect(queryAllByText('Luis Vega')).toHaveLength(0);

    await fireEvent.click(getByText(m.pos_appt_week()));
    expect(queryAllByText('Luis Vega')).toHaveLength(1);

    await fireEvent.click(getByText(m.pos_appt_today()));
    expect(queryAllByText('Luis Vega')).toHaveLength(0);
  });

  it('offers the charge hand-off on completed bookings only, and hands the booking back', async () => {
    const { onCharge, getAllByTitle } = renderPos();

    const chargeButtons = getAllByTitle(m.pos_appt_charge());
    expect(chargeButtons).toHaveLength(1); // the completed booking, not the accepted one

    await fireEvent.click(chargeButtons[0]);
    expect(onCharge).toHaveBeenCalledTimes(1);
    expect(onCharge.mock.calls[0][0]).toMatchObject({ id: 'b-done', productId: 'prod-booking' });
  });

  it('never renders the scheduling-only sales-order action', () => {
    const { queryByTitle } = renderPos();
    expect(queryByTitle('Create sales order')).toBeNull();
  });

  it('offers the walk-in staff picker in the new-booking modal', async () => {
    const { getByText, getByRole } = renderPos();
    await fireEvent.click(getByRole('button', { name: new RegExp(m.pos_appt_new()) }));
    expect(getByText(m.sched_nav_resources())).toBeTruthy();
    expect(getByText(m.pos_appt_staff_any())).toBeTruthy();
  });
});

describe('BookingsView — scheduling capability set (POS affordances stay off)', () => {
  const renderScheduling = () =>
    render(BookingsView, {
      props: {
        data: DATA,
        capabilities: SCHEDULING_CAPABILITIES,
        invalidateKey: 'scheduling:data',
        labelNamespace: 'scheduling' as const,
      },
    });

  it('renders the whole loaded window flat — no day filter, no range toggle', () => {
    const { queryAllByText, queryByText } = renderScheduling();

    expect(queryAllByText('Luis Vega')).toHaveLength(1);
    expect(queryAllByText('Jane Doe')).toHaveLength(1);
    expect(queryByText(m.pos_appt_today())).toBeNull();
    expect(queryByText(m.pos_appt_week())).toBeNull();
  });

  it('keeps the sales-order action and offers no charge hand-off', () => {
    const { queryByTitle, getAllByTitle } = renderScheduling();

    expect(queryByTitle(m.pos_appt_charge())).toBeNull();
    // Cancelled/rejected bookings are excluded; all three fixtures qualify.
    expect(getAllByTitle('Create sales order')).toHaveLength(3);
  });

  it('keeps the CRM contact search in the new-booking modal (no walk-in staff picker)', async () => {
    const { getByRole, getByPlaceholderText, queryByText } = renderScheduling();
    await fireEvent.click(getByRole('button', { name: new RegExp(m.sched_bookings_title()) }));

    expect(getByPlaceholderText(m.sched_book_find_client_ph())).toBeTruthy();
    expect(queryByText(m.pos_appt_staff_any())).toBeNull();
  });
});
