import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `POST /api/pos/tickets/:id/schedule` — the ONE write the sell flow's schedule
 * step makes.
 *
 * Under test here is the `created` flag, not the booking engine: a double-submit
 * is an idempotent REPLAY that returns the SAME appointment, and the operator
 * must be able to tell that apart from a fresh booking (§31.3). The flag is what
 * `AppointmentForm` now hands to `ScheduleStep.onbooked`, so it has to survive
 * the route unchanged.
 */
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1', profileId: 'p-1' }),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(true),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: () => Promise.resolve(null),
}));

const bookMock = vi.fn<() => Promise<{ booking: unknown; created: boolean }>>(async () => ({
  booking: { id: 'b-1', startTime: '2026-09-21T15:00:00.000Z' },
  created: true,
}));
vi.mock('$server/services/scheduling-bookings.service', () => ({
  bookAndLinkTicketLine: () => bookMock(),
  SlotUnavailableError: class SlotUnavailableError extends Error {},
}));

const LINE = '11111111-2222-4333-8444-555555555555';

async function call() {
  const { POST } = await import('./+server');
  return POST({
    locals: { user: { displayName: 'Cashier' } } as unknown as App.Locals,
    params: { id: 'ticket-1' },
    request: new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lineId: LINE,
        eventTypeId: 'et-1',
        start: '2026-09-21T15:00:00.000Z',
      }),
    }),
  } as unknown as Parameters<typeof POST>[0]);
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/pos/tickets/[id]/schedule', () => {
  it('reports a fresh booking as created', async () => {
    const res = await call();
    expect(await res.json()).toMatchObject({ created: true, booking: { id: 'b-1' } });
  });

  it('reports an idempotent replay as NOT created, with the same appointment', async () => {
    bookMock.mockImplementation(async () => ({
      booking: { id: 'b-1', startTime: '2026-09-21T15:00:00.000Z' },
      created: false,
    }));
    const body = (await (await call()).json()) as { created: boolean; booking: { id: string } };
    // The UI reads exactly this pair: same appointment, no second one made.
    expect(body.created).toBe(false);
    expect(body.booking).toMatchObject({ id: 'b-1', startTime: '2026-09-21T15:00:00.000Z' });
  });
});
