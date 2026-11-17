/** GET /api/scheduling/calendar — the versioned window under scheduling scope: no money, sold or stock rows (spec 126). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ window: vi.fn() }));

vi.mock('$server/auth/scheduling-read', () => ({
  requireSchedulingRead: async () => ({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/services/scheduling.service', () => ({
  listResources: async () => [{ id: 'r1', active: true, timezone: 'America/Lima' }],
  listEventTypes: async () => [],
}));
vi.mock('$server/services/calendar-window.service', () => ({
  loadCalendarWindow: (...a: unknown[]) => h.window(...a),
}));

const { GET } = await import('./+server');
const url = new URL('http://x/api/scheduling/calendar?from=2026-09-07&to=2026-09-13');
const call = (headers: Record<string, string> = { 'X-Minion-Booking-Products-Version': '1' }) =>
  GET({ locals: {}, url, request: new Request('http://x', { headers }) } as never);

beforeEach(() => {
  vi.clearAllMocks();
  h.window.mockResolvedValue({
    productProjectionVersion: 1,
    bookings: [],
    tagOptions: [],
    ticketOverlay: { state: 'denied' },
  });
});

describe('GET /api/scheduling/calendar', () => {
  it('409 refresh_required without the version header, and reads nothing', async () => {
    const res = await call({});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'refresh_required' });
    expect(h.window).not.toHaveBeenCalled();
  });

  it('returns the shared projection keys with a denied overlay, never the legacy namespaces', async () => {
    const body = await (await call()).json();
    expect(Object.keys(body).sort()).toEqual([
      'bookings',
      'calendarScope',
      'productProjectionVersion',
      'tagOptions',
      'ticketOverlay',
    ]);
    expect(body.ticketOverlay).toEqual({ state: 'denied' });
    expect(h.window.mock.calls[0]![2]).toMatchObject({ pos: false });
    expect(h.window.mock.calls[0]![2].canReadFinancialFields).toBeUndefined();
  });
});
