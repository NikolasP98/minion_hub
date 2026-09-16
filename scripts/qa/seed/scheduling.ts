/**
 * Scheduling — resources, schedules/availability, event kinds/types, links,
 * bookings, and HR (employees/leave/holidays — hub-native HR is filed under
 * scheduling in the spec's matrix, sharing sched_resources).
 */
import { matrixUuid, humanId } from './ids';
import { ORG_BUSINESS, ORG_PERSONAL, userId } from './tenancy';
import { CONTACT_DNI_VERIFIED } from './crm';
import { PRODUCT_SERVICE_PLAIN } from './catalog';
import { GRANT_HALF_USED, PLAN_OPEN } from './pos';
import type { SeedContext } from './db';

export const RESOURCE_LIMA = matrixUuid('sched.resource.staff-lima');
export const RESOURCE_MADRID = matrixUuid('sched.resource.staff-madrid');
export const RESOURCE_ROOM = matrixUuid('sched.resource.room');
export const RESOURCE_EQUIPMENT = matrixUuid('sched.resource.equipment');

export const EVENT_TYPE_PLAIN = matrixUuid('sched.event-type.plain');
export const EVENT_TYPE_CONFIRMATION = matrixUuid('sched.event-type.requires-confirmation');
export const EVENT_TYPE_ROUND_ROBIN = matrixUuid('sched.event-type.round-robin-two-resources');
export const EVENT_TYPE_CUSTOM_SCHEDULE = matrixUuid('sched.event-type.custom-schedule');
export const EVENT_TYPE_LINKED = matrixUuid('sched.event-type.linked-to-service');
export const EVENT_TYPE_PRIVATE = matrixUuid('sched.event-type.private');

export const KIND_DEFAULT = matrixUuid('sched.kind.default');
export const KIND_CUSTOM = matrixUuid('sched.kind.custom');

const FIN_INVOICE_LINKED = matrixUuid('fin.invoice.linked-from-booking');

const BOOKING_STATUSES = [
  ['sched.booking.accepted', 'accepted'],
  ['sched.booking.pending', 'pending'],
  ['sched.booking.cancelled', 'cancelled'],
  ['sched.booking.rejected', 'rejected'],
  ['sched.booking.completed', 'completed'],
  ['sched.booking.no-show', 'no_show'],
] as const;

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register, now } = ctx;
  const owner = userId('tenancy.user.owner');

  await sql`
    insert into sched_resources (id, org_id, kind, name, timezone, active)
    values
      (${RESOURCE_LIMA}, ${ORG_BUSINESS}, 'staff', 'QA Staff Lima', 'America/Lima', true),
      (${RESOURCE_MADRID}, ${ORG_BUSINESS}, 'staff', 'QA Staff Madrid', 'Europe/Madrid', true),
      (${RESOURCE_ROOM}, ${ORG_BUSINESS}, 'room', 'QA Treatment Room', 'America/Lima', true),
      (${RESOURCE_EQUIPMENT}, ${ORG_BUSINESS}, 'equipment', 'QA Laser Machine', 'America/Lima', true)
    on conflict (id) do update set name = excluded.name
  `;
  register('sched.resource.staff-lima', { table: 'sched_resources', where: { id: RESOURCE_LIMA } });
  register('sched.resource.staff-madrid', {
    table: 'sched_resources',
    where: { id: RESOURCE_MADRID },
  });
  register('sched.resource.room', { table: 'sched_resources', where: { id: RESOURCE_ROOM } });
  register('sched.resource.equipment', {
    table: 'sched_resources',
    where: { id: RESOURCE_EQUIPMENT },
  });

  const scheduleId = matrixUuid('sched.schedule.default-with-override');
  await sql`
    insert into sched_schedules (id, org_id, resource_id, name, timezone, is_default)
    values (${scheduleId}, ${ORG_BUSINESS}, ${RESOURCE_LIMA}, 'QA Working Hours', 'America/Lima', true)
    on conflict (id) do nothing
  `;
  await sql`
    insert into sched_availability (id, org_id, schedule_id, days, start_time, end_time, date)
    values
      (${matrixUuid('sched.schedule.default-with-override', 'weekly')}, ${ORG_BUSINESS}, ${scheduleId}, '{1,2,3,4,5}', '09:00', '18:00', null),
      (${matrixUuid('sched.schedule.default-with-override', 'day-off')}, ${ORG_BUSINESS}, ${scheduleId}, '{}', '00:00', '00:00', '2026-12-25')
    on conflict (id) do nothing
  `;
  register('sched.schedule.default-with-override', {
    table: 'sched_schedules',
    where: { id: scheduleId },
  });

  await sql`
    insert into sched_event_kinds (id, org_id, name, color, is_default)
    values
      (${KIND_DEFAULT}, ${ORG_BUSINESS}, 'Appointment', '#2563eb', true),
      (${KIND_CUSTOM}, ${ORG_BUSINESS}, 'QA Custom Kind', '#f59e0b', false)
    on conflict (id) do nothing
  `;
  register('sched.kind.default', { table: 'sched_event_kinds', where: { id: KIND_DEFAULT } });
  register('sched.kind.custom', { table: 'sched_event_kinds', where: { id: KIND_CUSTOM } });
  // org.personal deliberately gets ZERO sched_event_kinds rows (listEventKinds'
  // lazy-seed path) — registered as an absence, no row to insert.
  register('sched.kind.none-personal', {
    table: 'sched_event_kinds',
    where: { org_id: ORG_PERSONAL },
    expect: 'absent',
  });

  const eventTypes: Array<{
    matrixId: string;
    id: string;
    slug: string;
    title: string;
    length: number;
    schedulingType?: string;
    useCustomSchedule?: boolean;
    requiresConfirmation?: boolean;
    isPublic?: boolean;
    productId?: string;
    kindId?: string;
  }> = [
    {
      matrixId: 'sched.event-type.plain',
      id: EVENT_TYPE_PLAIN,
      slug: 'qa-plain',
      title: 'QA Plain Event',
      length: 30,
      kindId: KIND_DEFAULT,
    },
    {
      matrixId: 'sched.event-type.requires-confirmation',
      id: EVENT_TYPE_CONFIRMATION,
      slug: 'qa-confirm',
      title: 'QA Confirm Event',
      length: 45,
      requiresConfirmation: true,
      kindId: KIND_DEFAULT,
    },
    {
      matrixId: 'sched.event-type.round-robin-two-resources',
      id: EVENT_TYPE_ROUND_ROBIN,
      slug: 'qa-round-robin',
      title: 'QA Round Robin Event',
      length: 60,
      schedulingType: 'round_robin',
      kindId: KIND_DEFAULT,
    },
    {
      matrixId: 'sched.event-type.custom-schedule',
      id: EVENT_TYPE_CUSTOM_SCHEDULE,
      slug: 'qa-custom-schedule',
      title: 'QA Custom Schedule Event',
      length: 30,
      useCustomSchedule: true,
      kindId: KIND_DEFAULT,
    },
    {
      matrixId: 'sched.event-type.linked-to-service',
      id: EVENT_TYPE_LINKED,
      slug: 'qa-linked',
      title: 'QA Plain Service (linked)',
      length: 30,
      productId: PRODUCT_SERVICE_PLAIN,
      kindId: KIND_DEFAULT,
    },
    {
      matrixId: 'sched.event-type.private',
      id: EVENT_TYPE_PRIVATE,
      slug: 'qa-private',
      title: 'QA Private Event',
      length: 30,
      isPublic: false,
      kindId: KIND_DEFAULT,
    },
  ];
  for (const et of eventTypes) {
    await sql`
      insert into sched_event_types (id, org_id, slug, title, length, scheduling_type, use_custom_schedule, requires_confirmation, public, product_id, kind_id)
      values (
        ${et.id}, ${ORG_BUSINESS}, ${et.slug}, ${et.title}, ${et.length}, ${et.schedulingType ?? null},
        ${et.useCustomSchedule ?? false}, ${et.requiresConfirmation ?? false}, ${et.isPublic ?? true},
        ${et.productId ?? null}, ${et.kindId ?? null}
      )
      on conflict (org_id, slug) do update set title = excluded.title
    `;
    register(et.matrixId, { table: 'sched_event_types', where: { id: et.id } });
  }
  // Every seeded event type needs at least one resource with real availability
  // (RESOURCE_LIMA carries the default Mon-Fri 09:00-18:00 schedule) or it has
  // zero bookable slots anywhere in the app; round-robin alone gets a second
  // resource, matching its scheduling_type.
  await sql`
    insert into sched_event_type_resources (org_id, event_type_id, resource_id)
    values
      (${ORG_BUSINESS}, ${EVENT_TYPE_PLAIN}, ${RESOURCE_LIMA}),
      (${ORG_BUSINESS}, ${EVENT_TYPE_CONFIRMATION}, ${RESOURCE_LIMA}),
      (${ORG_BUSINESS}, ${EVENT_TYPE_ROUND_ROBIN}, ${RESOURCE_LIMA}),
      (${ORG_BUSINESS}, ${EVENT_TYPE_ROUND_ROBIN}, ${RESOURCE_MADRID}),
      (${ORG_BUSINESS}, ${EVENT_TYPE_CUSTOM_SCHEDULE}, ${RESOURCE_LIMA}),
      (${ORG_BUSINESS}, ${EVENT_TYPE_LINKED}, ${RESOURCE_LIMA}),
      (${ORG_BUSINESS}, ${EVENT_TYPE_PRIVATE}, ${RESOURCE_LIMA})
    on conflict (event_type_id, resource_id) do nothing
  `;

  // ── Bookings ────────────────────────────────────────────────────────
  let slot = 0;
  function nextSlot(): { start: Date; end: Date } {
    slot += 1;
    const start = new Date(now.getTime() + slot * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    return { start, end };
  }

  async function booking(
    matrixId: string,
    overrides: Partial<{
      status: string;
      resourceId: string;
      eventTypeId: string;
      kindId: string | null;
      crmContactId: string;
      partyId: string;
      invoiceId: string;
      packageGrantId: string;
      paymentPlanId: string;
      seriesId: string;
      seriesIndex: number;
      rescheduledFromId: string;
      source: string;
    }> = {},
  ): Promise<string> {
    const id = matrixUuid(matrixId);
    const { start, end } = nextSlot();
    await sql`
      insert into sched_bookings (
        id, org_id, uid, event_type_id, resource_id, start_time, end_time, status, title,
        crm_contact_id, party_id, invoice_id, kind_id, source, rescheduled_from_id,
        package_grant_id, payment_plan_id, series_id, series_index
      ) values (
        ${id}, ${ORG_BUSINESS}, ${humanId('BK', matrixId)}, ${overrides.eventTypeId ?? EVENT_TYPE_PLAIN},
        ${overrides.resourceId ?? RESOURCE_LIMA}, ${start.toISOString()}, ${end.toISOString()},
        ${overrides.status ?? 'accepted'}, ${humanId('BK', matrixId)},
        ${overrides.crmContactId ?? null}, ${overrides.partyId ?? null}, ${overrides.invoiceId ?? null},
        ${overrides.kindId === undefined ? KIND_DEFAULT : overrides.kindId}, ${overrides.source ?? 'internal'},
        ${overrides.rescheduledFromId ?? null}, ${overrides.packageGrantId ?? null},
        ${overrides.paymentPlanId ?? null}, ${overrides.seriesId ?? null}, ${overrides.seriesIndex ?? null}
      )
      on conflict (id) do update set status = excluded.status
    `;
    register(matrixId, { table: 'sched_bookings', where: { id } });
    return id;
  }

  for (const [matrixId, status] of BOOKING_STATUSES) await booking(matrixId, { status });

  // Recurring course, three FUTURE occurrences INSIDE the current work week
  // (Mon/Wed/Fri) — required by /pos/appointments' default 'workweek' view
  // (calendar-window.ts: current-week-only, Mon-Fri) and satisfied a fortiori
  // by /scheduling/calendar's wider week window. Anchored on `now` at EVERY
  // seed run (not frozen at first-seed time) and always DO UPDATE the times,
  // so a re-seed in a later week snaps the series back into "this week"
  // instead of drifting stale out of the visible window.
  // ponytail: fixed Mon/Wed/Fri @ 15:00/17:00/20:00 UTC (~10am/12pm/3pm Lima,
  // safely daytime in Madrid too) — genuinely "future" whenever seeded before
  // Friday ~15:00 Lima; a later-in-the-week reseed still lands correctly
  // inside the work week, just not strictly future for the already-past slots.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  function mondayOfWeekUtc(d: Date): Date {
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    const diff = (dow + 6) % 7; // days since Monday
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  }
  const seriesId = matrixUuid('sched.booking.series-3');
  const weekMonday = mondayOfWeekUtc(now);
  const seriesSlots = [
    new Date(weekMonday.getTime() + 0 * DAY_MS + 15 * HOUR_MS), // Mon
    new Date(weekMonday.getTime() + 2 * DAY_MS + 17 * HOUR_MS), // Wed
    new Date(weekMonday.getTime() + 4 * DAY_MS + 20 * HOUR_MS), // Fri
  ];
  for (let i = 0; i < 3; i += 1) {
    const matrixId = i === 0 ? 'sched.booking.series-3' : `sched.booking.series-3.${i}`;
    const id = matrixUuid(matrixId);
    const start = seriesSlots[i]!;
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    await sql`
      insert into sched_bookings (id, org_id, uid, event_type_id, resource_id, start_time, end_time, status, title, series_id, series_index)
      values (${id}, ${ORG_BUSINESS}, ${humanId('BK', matrixId)}, ${EVENT_TYPE_PLAIN}, ${RESOURCE_LIMA}, ${start.toISOString()}, ${end.toISOString()}, 'accepted', ${`QA Recurring Course ${i + 1}/3`}, ${seriesId}, ${i})
      on conflict (id) do update set start_time = excluded.start_time, end_time = excluded.end_time, status = excluded.status, title = excluded.title
    `;
  }
  register('sched.booking.series-3', {
    table: 'sched_bookings',
    where: { series_id: seriesId, series_index: 0 },
  });

  await booking('sched.booking.fully-linked', {
    crmContactId: CONTACT_DNI_VERIFIED,
    invoiceId: FIN_INVOICE_LINKED,
    packageGrantId: GRANT_HALF_USED,
    paymentPlanId: PLAN_OPEN,
  });

  const originalId = await booking('sched.booking.accepted');
  await booking('sched.booking.rescheduled-from', { rescheduledFromId: originalId });
  await booking('sched.booking.kind-null', { kindId: null });
  await booking('sched.booking.public-link-source', { source: 'public_link' });

  const linkExpiredId = matrixUuid('sched.link.expired');
  await sql`
    insert into sched_links (id, org_id, slug, title, event_type_ids, active, expires_at)
    values (${linkExpiredId}, ${ORG_BUSINESS}, 'qa-expired-link', 'QA Expired Link', ${sql.array([EVENT_TYPE_PLAIN])}::uuid[], true, '2020-01-01T00:00:00Z')
    on conflict (org_id, slug) do update set expires_at = excluded.expires_at
  `;
  register('sched.link.expired', { table: 'sched_links', where: { id: linkExpiredId } });

  // ── HR ──────────────────────────────────────────────────────────────
  const employeeActive = matrixUuid('hr.employee.active');
  const employeeLeft = matrixUuid('hr.employee.left');
  await sql`
    insert into hr_employees (id, org_id, resource_id, name, status, joined_on, left_on)
    values
      (${employeeActive}, ${ORG_BUSINESS}, ${RESOURCE_LIMA}, 'QA Active Employee', 'active', '2024-01-01', null),
      (${employeeLeft}, ${ORG_BUSINESS}, null, 'QA Former Employee', 'left', '2023-01-01', '2025-06-30')
    on conflict (id) do update set status = excluded.status
  `;
  register('hr.employee.active', { table: 'hr_employees', where: { id: employeeActive } });
  register('hr.employee.left', { table: 'hr_employees', where: { id: employeeLeft } });

  const leaveTypeId = matrixUuid('hr.leave.pending', 'leave-type');
  await sql`
    insert into hr_leave_types (id, org_id, code, name)
    values (${leaveTypeId}, ${ORG_BUSINESS}, 'vacation', 'Vacation')
    on conflict (org_id, code) do nothing
  `;
  const leaveStatuses = [
    ['hr.leave.pending', 'pending'],
    ['hr.leave.approved', 'approved'],
    ['hr.leave.rejected', 'rejected'],
    ['hr.leave.cancelled', 'cancelled'],
  ] as const;
  for (const [matrixId, status] of leaveStatuses) {
    const id = matrixUuid(matrixId);
    await sql`
      insert into hr_leave_requests (id, org_id, employee_id, leave_type_id, from_date, to_date, days, status, decided_by, decided_at)
      values (
        ${id}, ${ORG_BUSINESS}, ${employeeActive}, ${leaveTypeId}, '2026-06-01', '2026-06-03', 3, ${status},
        ${status === 'pending' ? null : owner}, ${status === 'pending' ? null : now.toISOString()}
      )
      on conflict (id) do update set status = excluded.status
    `;
    register(matrixId, { table: 'hr_leave_requests', where: { id } });
  }

  const holidayId = matrixUuid('hr.holiday.manual');
  await sql`
    insert into hr_holidays (id, org_id, date, name, source)
    values (${holidayId}, ${ORG_BUSINESS}, '2026-07-28', 'QA Fiestas Patrias', 'manual')
    on conflict (org_id, date) do update set name = excluded.name
  `;
  register('hr.holiday.manual', { table: 'hr_holidays', where: { id: holidayId } });
}
