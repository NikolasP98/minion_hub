import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import {
  schedResources,
  schedSchedules,
  schedAvailability,
  schedEventTypes,
  schedEventTypeResources,
  schedBookings,
  schedLinks,
} from './pg-scheduling-schema';

describe('pg-scheduling-schema', () => {
  it('sched_resources carries org tenancy + staff fields', () => {
    const cols = Object.keys(getTableColumns(schedResources));
    for (const c of ['orgId', 'kind', 'profileId', 'name', 'timezone', 'color', 'active', 'metadata'])
      expect(cols).toContain(c);
  });

  it('sched_schedules belongs to a resource and has a timezone', () => {
    const cols = Object.keys(getTableColumns(schedSchedules));
    for (const c of ['orgId', 'resourceId', 'name', 'timezone', 'isDefault']) expect(cols).toContain(c);
  });

  it('sched_availability supports weekly rules + single-date overrides', () => {
    const cols = Object.keys(getTableColumns(schedAvailability));
    for (const c of ['orgId', 'scheduleId', 'days', 'startTime', 'endTime', 'date']) expect(cols).toContain(c);
  });

  it('sched_event_types ports the cal.diy EventType knobs + bridges to fin_products', () => {
    const cols = Object.keys(getTableColumns(schedEventTypes));
    for (const c of [
      'orgId', 'slug', 'title', 'length', 'slotInterval', 'beforeBuffer', 'afterBuffer',
      'minimumBookingNotice', 'periodType', 'periodDays', 'schedulingType', 'requiresConfirmation',
      'public', 'productId', 'active',
    ])
      expect(cols).toContain(c);
  });

  it('sched_event_type_resources links event types to resources (M:N)', () => {
    const cols = Object.keys(getTableColumns(schedEventTypeResources));
    for (const c of ['orgId', 'eventTypeId', 'resourceId']) expect(cols).toContain(c);
  });

  it('sched_bookings holds the appointment + CRM/finance bridges + idempotency uid', () => {
    const cols = Object.keys(getTableColumns(schedBookings));
    for (const c of [
      'orgId', 'uid', 'eventTypeId', 'resourceId', 'startTime', 'endTime', 'status',
      'attendeeName', 'attendeeEmail', 'attendeePhone', 'crmContactId', 'productId',
      'source', 'rescheduledFromId',
    ])
      expect(cols).toContain(c);
  });

  it('sched_links aggregates event types behind a shareable slug', () => {
    const cols = Object.keys(getTableColumns(schedLinks));
    for (const c of ['orgId', 'slug', 'title', 'eventTypeIds', 'resourceId', 'active', 'expiresAt'])
      expect(cols).toContain(c);
  });
});
