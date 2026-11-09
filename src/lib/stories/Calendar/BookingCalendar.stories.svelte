<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import BookingCalendar from '$lib/components/scheduling/BookingCalendar.svelte';
  import type {
    CalendarBooking,
    CalendarInvoice,
    CalendarResource,
  } from '$lib/components/scheduling/calendar-window';
  import type { CalendarWindowState } from '$lib/components/scheduling/kit/window-cache.svelte';

  // Lima = UTC-5, no DST: a fixed week so the grid renders the same every time.
  const TZ = 'America/Lima';
  const MON = '2026-09-07';
  const DAYS = [
    '2026-09-07',
    '2026-09-08',
    '2026-09-09',
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13',
  ];

  const resources: CalendarResource[] = [
    { id: 'r-ana', name: 'Ana Quispe', color: 'var(--color-info-border)' },
    { id: 'r-luis', name: 'Luis Fernández de la Torre', color: 'var(--color-success-border)' },
    { id: 'r-mar', name: 'Mar', color: 'var(--color-warning-border)' },
  ];
  const eventTypes = [
    { id: 'et-cons', title: 'Consultation', color: null, kindId: 'k-clinic' },
    {
      id: 'et-clean',
      title: 'Deep cleaning and whitening session',
      color: null,
      kindId: 'k-clinic',
    },
    { id: 'et-fup', title: 'Follow-up', color: null, kindId: 'k-admin' },
  ];
  const kinds = [
    { id: 'k-clinic', name: 'Clinical', color: 'var(--color-info-border)', isDefault: true },
    { id: 'k-admin', name: 'Administrative', color: 'var(--color-warning-border)' },
  ];
  const tagOptions = [
    { id: 't-vip', name: 'VIP', color: 'var(--color-warning-border)' },
    { id: 't-new', name: 'New patient', color: 'var(--color-success-border)' },
  ];

  /** `hh:mm` local → UTC ISO instant (Lima is UTC-5). */
  function iso(day: string, hhmm: string, plusMin = 0): string {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(
      Date.UTC(2026, Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h + 5, m + plusMin),
    );
    return d.toISOString();
  }
  let seq = 0;
  function booking(
    day: string,
    start: string,
    minutes: number,
    patch: Partial<CalendarBooking> = {},
  ): CalendarBooking {
    seq += 1;
    return {
      id: `b${seq}`,
      resourceId: 'r-ana',
      eventTypeId: 'et-cons',
      start: iso(day, start),
      end: iso(day, start, minutes),
      status: 'accepted',
      attendeeName: 'Carla Mendoza',
      tags: [],
      categoryColor: null,
      ...patch,
    };
  }

  const week: CalendarBooking[] = [
    booking(DAYS[0], '09:00', 45, { attendeeName: 'Carla Mendoza' }),
    booking(DAYS[0], '09:30', 60, {
      resourceId: 'r-luis',
      attendeeName: 'Jorge',
      status: 'pending',
    }),
    booking(DAYS[0], '09:45', 30, { attendeeName: 'Overlap A', status: 'completed' }),
    booking(DAYS[1], '10:00', 90, {
      resourceId: 'r-luis',
      eventTypeId: 'et-clean',
      attendeeName: 'María Fernanda Rodríguez Villanueva-Salazar',
      tags: [{ id: 't-vip', name: 'VIP', color: 'var(--color-warning-border)', origin: 'own' }],
    }),
    booking(DAYS[1], '14:00', 15, {
      resourceId: 'r-mar',
      attendeeName: 'Li',
      eventTypeId: 'et-fup',
    }),
    booking(DAYS[2], '11:00', 45, { status: 'no_show', attendeeName: 'Pedro Castillo' }),
    booking(DAYS[2], '11:00', 45, {
      resourceId: 'r-mar',
      status: 'cancelled',
      attendeeName: 'Cancelled slot',
    }),
    booking(DAYS[3], '08:00', 120, {
      resourceId: 'r-luis',
      status: 'rejected',
      attendeeName: null,
    }),
    booking(DAYS[3], '16:00', 60, {
      attendeeName: 'Group visit 1/2',
      groupId: 'g1',
      groupSeq: 1,
      groupLength: 2,
    }),
    booking(DAYS[3], '17:00', 30, {
      attendeeName: 'Group visit 2/2',
      groupId: 'g1',
      groupSeq: 2,
      groupLength: 2,
      eventTypeId: 'et-fup',
    }),
    booking(DAYS[4], '12:00', 45, {
      attendeeName: 'Paid visit',
      paid: true,
      tickets: [{ id: 'tk1', humanId: 'F001-000123' }],
    }),
    booking(DAYS[5], '10:00', 240, {
      resourceId: 'r-mar',
      attendeeName: 'Long block (4 h)',
      eventTypeId: 'et-clean',
    }),
  ];

  /** 60 bookings over the week, three per hour on Ana + Luis. */
  const dense: CalendarBooking[] = DAYS.slice(0, 5).flatMap((day) =>
    [8, 9, 10, 11, 12, 14, 15, 16, 17, 18].flatMap((h) => [
      booking(day, `${String(h).padStart(2, '0')}:00`, 30, { attendeeName: `Slot ${h}:00` }),
      booking(day, `${String(h).padStart(2, '0')}:15`, 45, {
        resourceId: 'r-luis',
        attendeeName: `Overlap ${h}:15`,
        status: h % 2 ? 'pending' : 'accepted',
      }),
    ]),
  );

  // Working hours: Mon–Fri 09:00–18:00 for Ana, Mon–Sat 10:00–20:00 for Luis, Mar unscheduled.
  const hours: Record<string, Partial<Record<number, [number, number]>>> = {
    'r-ana': { 1: [540, 1080], 2: [540, 1080], 3: [540, 1080], 4: [540, 1080], 5: [540, 1080] },
    'r-luis': {
      1: [600, 1200],
      2: [600, 1200],
      3: [600, 1200],
      4: [600, 1200],
      5: [600, 1200],
      6: [600, 1200],
    },
  };

  const invoices: CalendarInvoice[] = [
    {
      id: 'inv1',
      humanId: 'F001-000123',
      at: iso(DAYS[4], '12:50'),
      total: 180,
      currency: 'PEN',
      customerName: 'Paid visit',
      lines: [{ id: 'l1', description: 'Consultation', bookingId: week[10].id }],
    },
    {
      id: 'inv2',
      humanId: 'B001-004567',
      at: iso(DAYS[1], '15:10'),
      total: 1250.5,
      currency: 'PEN',
      customerName: 'Walk-in sale',
      lines: [{ id: 'l2', description: 'Whitening kit', bookingId: null }],
    },
  ];

  const windows: CalendarWindowState[] = [
    { key: '2026-08-31', from: '2026-08-31', to: '2026-09-06', status: 'ready', hasData: true },
    { key: MON, from: MON, to: DAYS[6], status: 'ready', hasData: true },
    { key: '2026-09-14', from: '2026-09-14', to: '2026-09-20', status: 'loading', hasData: false },
  ];
  const failedWindows: CalendarWindowState[] = [
    { key: MON, from: MON, to: DAYS[6], status: 'error', hasData: true },
    { key: '2026-09-14', from: '2026-09-14', to: '2026-09-20', status: 'error', hasData: false },
  ];

  const { Story } = defineMeta({
    title: 'Calendar/BookingCalendar',
    component: BookingCalendar,
    render: template,
    tags: ['autodocs'],
    argTypes: {
      view: { control: 'select', options: ['day', 'week', 'month', 'agenda'] },
      weekDays: { control: { type: 'number', min: 2, max: 14 } },
      busy: { control: 'boolean' },
      split: { control: 'boolean' },
    },
    args: {
      view: 'week',
      date: DAYS[1],
      timeZone: TZ,
      mutationScope: 'org-demo',
      bookings: week,
      resources,
      eventTypes,
      kinds,
      tagOptions,
      hours,
      onview: fn(),
      ondate: fn(),
      onrange: fn(),
      onopen: fn(),
      onselect: fn(),
      onslot: fn(),
      onmove: fn(),
      oncolorby: fn(),
      onweekdays: fn(),
      onsubby: fn(),
      onpxperhour: fn(),
    },
  });
</script>

<!-- The grid fills its parent; the canvas needs a bounded height. -->
{#snippet template(args: Record<string, unknown>)}
  <div style="height: 80vh; display: flex; flex-direction: column;">
    <BookingCalendar {...args} />
  </div>
{/snippet}

<Story name="Week populated" />

<Story name="Day view" args={{ view: 'day' }} />

<Story name="Month view" args={{ view: 'month', bookings: [...week, ...dense] }} />

<Story name="Agenda view" args={{ view: 'agenda', features: { agenda: true } }} />

<Story name="Empty week" args={{ bookings: [] }} />

<Story name="Agenda empty" args={{ view: 'agenda', features: { agenda: true }, bookings: [] }} />

<Story name="Dense (60 bookings)" args={{ bookings: dense, weekDays: 5 }} />

<Story name="Off-hours unshaded" args={{ hours: undefined }} />

<Story name="Closed weekend (3 days per screen)" args={{ weekDays: 3, date: DAYS[5] }} />

<Story name="Loading next week" args={{ busy: true, windows }} />

<Story name="Failed windows" args={{ windows: failedWindows, onwindowretry: fn() }} />

<Story name="Invoiced | Scheduled split" args={{ invoices, split: true, onsplit: fn() }} />

<Story name="Subcolumns by status" args={{ subBy: 'status' }} />

<Story name="Coloured by kind / tags" args={{ blockColorBy: 'kind', sliverColorBy: 'tags' }} />

<Story
  name="Read-only"
  args={{
    onmove: undefined,
    onslot: undefined,
    oncolorby: undefined,
    onweekdays: undefined,
    onsubby: undefined,
    features: {
      kebab: false,
      createDrag: false,
      createDblClick: false,
      merge: false,
      datePicker: false,
    },
  }}
/>

<Story name="Tall hours (120 px/h, 06–23)" args={{ pxPerHour: 120, startHour: 6, endHour: 23 }} />

<!-- Responsive: toolbar controls grow to touch size below 768px; day columns squeeze and truncate. -->
<Story name="Week populated · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }} />

<Story
  name="Week populated · Tablet"
  globals={{ viewport: { value: 'tablet', isRotated: false } }}
/>

<Story
  name="Day view · Phone"
  args={{ view: 'day' }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
/>
