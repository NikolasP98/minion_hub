import { describe, expect, it } from 'vitest';
import {
  bookingColor,
  bookingFacet,
  bookingFacets,
  parseColorSource,
  SUBCOLUMN_SOURCES,
  type BookingColorCtx,
} from './booking-color';
import type { CalendarBooking } from './calendar-window';

const ctx: BookingColorCtx = {
  resources: [{ id: 'r1', name: 'Ana', color: '#111111' }],
  eventTypes: [
    { id: 'e1', color: '#222222', kindId: 'k2' },
    { id: 'e2', color: null, kindId: null },
  ],
  kinds: [
    { id: 'k1', color: '#aaaaaa', isDefault: true },
    { id: 'k2', color: '#bbbbbb' },
  ],
};

const booking = (patch: Partial<CalendarBooking> = {}): CalendarBooking => ({
  id: 'b1',
  resourceId: 'r1',
  eventTypeId: 'e1',
  start: '2026-09-25T10:00:00Z',
  end: '2026-09-25T10:30:00Z',
  status: 'accepted',
  attendeeName: 'Cliente',
  ...patch,
});

describe('bookingColor', () => {
  it('leaves status (and none) to the fixed semantic tone ramp', () => {
    expect(bookingColor('status', booking(), ctx)).toBeNull();
    expect(bookingColor('none', booking(), ctx)).toBeNull();
  });

  it('reads staff, service and category colours off their own column', () => {
    expect(bookingColor('staff', booking(), ctx)).toBe('#111111');
    expect(bookingColor('service', booking(), ctx)).toBe('#222222');
    expect(bookingColor('category', booking({ categoryColor: '#3b82f6' }), ctx)).toBe('#3b82f6');
    expect(bookingColor('service', booking({ eventTypeId: 'e2' }), ctx)).toBeNull();
    expect(bookingColor('category', booking(), ctx)).toBeNull();
  });

  it('takes the first tag with a colour, in server order', () => {
    const tags = [
      { id: 't1', name: 'no colour', color: null, origin: 'own' as const },
      { id: 't2', name: 'client', color: '#ec4899', origin: 'contact' as const },
      { id: 't3', name: 'service', color: '#10b981', origin: 'product' as const },
    ];
    expect(bookingColor('tags', booking({ tags }), ctx)).toBe('#ec4899');
    expect(bookingColor('tags', booking({ tags: [] }), ctx)).toBeNull();
    expect(bookingColor('tags', booking(), ctx)).toBeNull();
  });

  it('resolves the kind through booking → service → org default', () => {
    expect(bookingColor('kind', booking({ kindId: 'k1' }), ctx)).toBe('#aaaaaa');
    // No own kind → the service's default kind (e1 → k2).
    expect(bookingColor('kind', booking(), ctx)).toBe('#bbbbbb');
    // Neither → the org's default kind.
    expect(bookingColor('kind', booking({ eventTypeId: 'e2' }), ctx)).toBe('#aaaaaa');
    // No kinds at all (org list failed to load) → no colour, never a throw.
    expect(bookingColor('kind', booking(), { ...ctx, kinds: [] })).toBeNull();
  });
});

describe('parseColorSource', () => {
  it('only honours a known source', () => {
    expect(parseColorSource('kind', 'status')).toBe('kind');
    expect(parseColorSource('nonsense', 'status')).toBe('status');
    expect(parseColorSource(null, 'staff')).toBe('staff');
  });
});

describe('bookingFacet', () => {
  it('returns the grouping value of each source, null when unset', () => {
    expect(bookingFacet('status', booking(), ctx)).toBe('accepted');
    expect(bookingFacet('staff', booking(), ctx)).toBe('r1');
    expect(bookingFacet('service', booking(), ctx)).toBe('e1');
    expect(bookingFacet('staff', booking({ resourceId: '' }), ctx)).toBeNull();
    expect(bookingFacet('none', booking(), ctx)).toBeNull();
  });
  it('groups by the category NAME the window payload now carries (HC-020)', () => {
    expect(bookingFacet('category', booking({ category: 'Facial' }), ctx)).toBe('Facial');
    expect(bookingFacet('category', booking({ category: null }), ctx)).toBeNull();
    expect(bookingFacet('category', booking(), ctx)).toBeNull();
    expect(SUBCOLUMN_SOURCES).toContain('category');
  });
  it('resolves kind through the same own → service → default chain as the colour', () => {
    expect(bookingFacet('kind', booking(), ctx)).toBe('k2');
    expect(bookingFacet('kind', booking({ eventTypeId: 'e2' }), ctx)).toBe('k1');
    expect(bookingFacet('kind', booking({ kindId: 'k1' }), ctx)).toBe('k1');
  });
  it('files a tagged booking under its lowest tag id, whatever the server order', () => {
    const tags = [
      { id: 't2', name: 'Promo', color: '#ff0000', origin: 'contact' as const },
      { id: 't1', name: 'VIP', color: null, origin: 'own' as const },
    ];
    expect(bookingFacet('tags', booking({ tags }), ctx)).toBe('t1');
    expect(bookingFacet('tags', booking({ tags: [...tags].reverse() }), ctx)).toBe('t1');
    expect(bookingFacet('tags', booking(), ctx)).toBeNull();
  });
});

describe('bookingFacets (HC-017: every tag lane a booking belongs to)', () => {
  const own = { id: 't-laser', name: 'Laser', color: null, origin: 'own' as const };
  const contact = { id: 't-vip', name: 'VIP', color: '#ec4899', origin: 'contact' as const };

  it('returns the same tag set for both server orders (own→contact and contact→own)', () => {
    expect(bookingFacets('tags', booking({ tags: [own, contact] }), ctx)).toEqual([
      't-laser',
      't-vip',
    ]);
    expect(bookingFacets('tags', booking({ tags: [contact, own] }), ctx)).toEqual([
      't-laser',
      't-vip',
    ]);
  });

  it('dedupes a tag carried by two origins and files an untagged booking as unclassified', () => {
    expect(
      bookingFacets('tags', booking({ tags: [own, { ...own, origin: 'product' }] }), ctx),
    ).toEqual(['t-laser']);
    expect(bookingFacets('tags', booking({ tags: [] }), ctx)).toEqual([null]);
    expect(bookingFacets('tags', booking(), ctx)).toEqual([null]);
  });

  it('is a one-element array for every single-valued source', () => {
    expect(bookingFacets('status', booking(), ctx)).toEqual(['accepted']);
    expect(bookingFacets('staff', booking(), ctx)).toEqual(['r1']);
    expect(bookingFacets('kind', booking(), ctx)).toEqual(['k2']);
    expect(bookingFacets('category', booking({ category: 'Facial' }), ctx)).toEqual(['Facial']);
    expect(bookingFacets('category', booking(), ctx)).toEqual([null]);
    expect(bookingFacets('none', booking(), ctx)).toEqual([null]);
  });
});
