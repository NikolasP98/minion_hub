/**
 * HC-020 — the window payload carries the product category NAME next to its
 * colour, resolved through the same product (own, else the service's) so the
 * calendar can subdivide by category, not only colour by it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  bookings: [] as Array<Record<string, unknown>>,
  categories: new Map<string, { name: string; color: string }>(),
  categoryCalls: [] as string[][],
}));

vi.mock('$server/services/rbac.service', () => ({
  shouldMaskSensitive: () => Promise.resolve(false),
}));
vi.mock('$server/services/scheduling-bookings.service', () => ({
  listBookings: () => Promise.resolve(state.bookings),
}));
vi.mock('$server/services/finance-products.service', () => ({
  categoryColorsForProducts: (_ctx: unknown, ids: string[]) => {
    state.categoryCalls.push(ids);
    return Promise.resolve(state.categories);
  },
}));
vi.mock('$server/services/stock-accruals.service', () => ({
  accrualSummaryForSources: () => Promise.resolve([]),
}));
vi.mock('$server/services/tag-links.service', () => ({
  getTagLinks: () => Promise.resolve(new Map()),
  getContactTagsBulk: () => Promise.resolve(new Map()),
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  listTags: () => Promise.resolve([]),
}));
vi.mock('$server/services/pos-accounts.service', () => ({
  listTicketsForCalendar: () => Promise.resolve([]),
}));

const booking = (id: string, patch: Record<string, unknown>) => ({
  id,
  resourceId: 'r1',
  eventTypeId: 'e-plain',
  startTime: new Date('2026-09-08T13:00:00Z'),
  endTime: new Date('2026-09-08T13:30:00Z'),
  status: 'accepted',
  attendeeName: 'A',
  attendeePhone: null,
  partyId: null,
  productId: null,
  notes: null,
  metadata: null,
  kindId: null,
  crmContactId: null,
  ...patch,
});

const ctx = { db: {}, tenantId: 'org-1' } as never;
const locals = {} as App.Locals;
const eventTypes = [
  { id: 'e-plain', productId: null, kindId: null },
  { id: 'e-svc', productId: 'p-service', kindId: null },
];

beforeEach(() => {
  state.bookings = [];
  state.categories = new Map();
  state.categoryCalls = [];
});

describe('loadCalendarWindow category payload (HC-020)', () => {
  it('emits the category name and colour for a product with a category, null/null without', async () => {
    const { loadCalendarWindow } = await import('./calendar-window.service');
    state.bookings = [
      booking('b-own', { productId: 'p-own' }),
      booking('b-svc', { eventTypeId: 'e-svc' }),
      booking('b-uncat', { productId: 'p-uncat' }),
      booking('b-none', {}),
    ];
    state.categories = new Map([
      ['p-own', { name: 'Laser', color: '#aa0000' }],
      ['p-service', { name: 'Facial', color: '#00aa00' }],
    ]);

    const { bookings } = await loadCalendarWindow(ctx, locals, {
      from: new Date('2026-09-07T05:00:00Z'),
      to: new Date('2026-09-14T05:00:00Z'),
      eventTypes,
      pos: false,
    });
    const byId = Object.fromEntries(
      bookings.map((b) => [b.id, { category: b.category, categoryColor: b.categoryColor }]),
    );
    expect(byId).toEqual({
      'b-own': { category: 'Laser', categoryColor: '#aa0000' },
      'b-svc': { category: 'Facial', categoryColor: '#00aa00' },
      'b-uncat': { category: null, categoryColor: null },
      'b-none': { category: null, categoryColor: null },
    });
    // ONE lookup over the distinct products — no second query for the name.
    expect(state.categoryCalls).toEqual([['p-own', 'p-service', 'p-uncat']]);
  });

  it('fails soft when the category lookup throws: both fields null, calendar still answers', async () => {
    const { loadCalendarWindow } = await import('./calendar-window.service');
    state.bookings = [booking('b-own', { productId: 'p-own' })];
    state.categories = {
      // A rejected promise from the finance module (POS off) must not cost the grid.
      then: (_ok: unknown, fail: (e: Error) => unknown) => fail(new Error('pos off')),
    } as never;
    const { bookings } = await loadCalendarWindow(ctx, locals, {
      from: new Date('2026-09-07T05:00:00Z'),
      to: new Date('2026-09-14T05:00:00Z'),
      eventTypes,
      pos: false,
    });
    expect(bookings[0]).toMatchObject({ id: 'b-own', category: null, categoryColor: null });
  });
});
