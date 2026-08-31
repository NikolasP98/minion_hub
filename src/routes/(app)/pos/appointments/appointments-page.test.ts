// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import { chargeHandoff, chargeStorageKey } from './charge-handoff';

/**
 * Slice 3 of `2026-08-17-hub-pos-appointments-fork-spec`: `/pos/appointments`
 * is now a wrapper over the shared `BookingsView`. The two things the wrapper
 * still owns are asserted here — the booking→ticket hand-off (the contract
 * `/pos/sell` reads: `(app)/pos/sell/+page.svelte`, `CHARGE_KEY`) and the POS
 * party picker it feeds into the shared view's new-booking call.
 */

const navigation = vi.hoisted(() => ({ invalidate: vi.fn(), goto: vi.fn() }));
vi.mock('$lib/navigation', () => navigation);

const access = vi.hoisted(() => ({
  canAct: vi.fn((_module: string, _action: string) => true),
}));
vi.mock('$lib/access/can.svelte', () => ({
  canAct: (module: string, action: string) => access.canAct(module, action),
}));

vi.mock('$app/state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/state')>();
  return { ...actual, page: { ...actual.page, data: { activeOrgId: 'org-9' } } };
});

const { default: AppointmentsPage } = await import('./+page.svelte');

const EVENT_TYPES = [
  { id: 'e1', title: 'Haircut', productId: 'prod-event-type' },
  { id: 'e2', title: 'Colour', productId: null },
];

// The page opens on its "today" range, so the fixture sits at 14:00 of the
// frozen clock's own day.
const NOW = new Date('2026-08-18T12:00:00.000Z');
const TODAY_AT_14 = new Date(new Date(NOW).setHours(14, 0, 0, 0)).toISOString();

const COMPLETED = {
  id: 'b-done',
  status: 'completed',
  startTime: TODAY_AT_14,
  eventTypeId: 'e1',
  resourceId: 'r1',
  attendeeName: 'Jane Doe',
  attendeePhone: '+51999111222',
  partyId: 'party-1',
  productId: null,
};

const DATA = {
  bookings: [COMPLETED],
  resources: [{ id: 'r1', name: 'Front chair' }],
  eventTypes: EVENT_TYPES,
  stockEnabled: false,
  accrualSummaries: [],
};

describe('chargeHandoff payload', () => {
  it("prefers the booking's own product over its event type's", () => {
    const rebooked = { ...COMPLETED, productId: 'prod-booked' };
    expect(chargeHandoff(rebooked, EVENT_TYPES)).toEqual({
      bookingId: 'b-done',
      productId: 'prod-booked',
      partyId: 'party-1',
      customerName: 'Jane Doe',
      phone: '+51999111222',
    });
  });

  it("falls back to the event type's product, then to null", () => {
    expect(chargeHandoff(COMPLETED, EVENT_TYPES).productId).toBe('prod-event-type');
    expect(chargeHandoff({ ...COMPLETED, eventTypeId: 'e2' }, EVENT_TYPES).productId).toBeNull();
    expect(chargeHandoff({ ...COMPLETED, eventTypeId: 'gone' }, EVENT_TYPES).productId).toBeNull();
  });

  it('scopes the hand-off key per org, with a default for an org-less session', () => {
    expect(chargeStorageKey('org-9')).toBe('pos-charge-org-9');
    expect(chargeStorageKey(null)).toBe('pos-charge-default');
    expect(chargeStorageKey(undefined)).toBe('pos-charge-default');
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  access.canAct.mockReturnValue(true);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('/pos/appointments — the collapsed page still charges a booking', () => {
  it('stages the hand-off under the active org key and lands on /pos/sell', async () => {
    const { getByTitle } = render(AppointmentsPage, { props: { data: DATA as never } });

    await fireEvent.click(getByTitle(m.pos_appt_charge()));

    expect(JSON.parse(localStorage.getItem('pos-charge-org-9') ?? 'null')).toEqual({
      bookingId: 'b-done',
      productId: 'prod-event-type',
      partyId: 'party-1',
      customerName: 'Jane Doe',
      phone: '+51999111222',
    });
    expect(navigation.goto).toHaveBeenCalledWith('/pos/sell');
  });

  it('hides the charge action from a user without pos:edit', () => {
    access.canAct.mockImplementation((module: string) => module !== 'pos');
    const { queryByTitle } = render(AppointmentsPage, { props: { data: DATA as never } });
    expect(queryByTitle(m.pos_appt_charge())).toBeNull();
  });
});

describe('/pos/appointments — the POS party picker drives the shared booking call', () => {
  it("round-trips a quick-added customer through the shared view's attendee state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/crm/parties')) {
        return new Response(JSON.stringify({ party: { id: 'party-new', phone9: '987654321' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ slots: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByRole, getByText, getByPlaceholderText } = render(AppointmentsPage, {
      props: { data: DATA as never },
    });
    await fireEvent.click(getByRole('button', { name: new RegExp(m.pos_appt_new()) }));

    // The wrapper renders the POS picker in place of the scheduling contact search.
    await fireEvent.click(getByText(m.pos_sell_customer_quick_add()));
    await fireEvent.input(getByPlaceholderText(m.pos_sell_customer_name_ph()), {
      target: { value: 'Rita Walk-in' },
    });
    await fireEvent.click(getByText(m.common_add()));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/crm/parties', expect.anything()),
    );

    // The chip is rendered from the value the picker reads *back* out of the
    // shared view: the name and the CRM-resolved phone made the round trip
    // through `BookingsView`'s own attendee state, which is what the booking
    // POST sends. A broken control handle would leave the chip unrendered.
    await vi.waitFor(() => expect(getByText('Rita Walk-in')).toBeTruthy());
    expect(getByText('987654321')).toBeTruthy();

    vi.unstubAllGlobals();
  });
});
