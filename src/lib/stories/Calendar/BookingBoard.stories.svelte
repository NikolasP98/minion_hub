<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import BookingBoard from '$lib/components/scheduling/BookingBoard.svelte';
  import { createBookingCustomValues } from '$lib/components/scheduling/kit/booking-custom-values.svelte';
  import type { CalendarBooking } from '$lib/components/scheduling/calendar-window';

  const TZ = 'America/Lima';
  const resources = [
    { id: 'r-ana', name: 'Ana Quispe', color: 'var(--color-info-border)' },
    { id: 'r-luis', name: 'Luis Fernández de la Torre', color: 'var(--color-success-border)' },
    { id: 'r-mar', name: 'Mar', color: null },
  ];
  const eventTypes = [
    { id: 'et-cons', title: 'Consultation' },
    { id: 'et-clean', title: 'Deep cleaning and whitening session' },
    { id: 'et-fup', title: 'Follow-up' },
  ];

  let seq = 0;
  const booking = (
    day: string,
    h: number,
    minutes: number,
    patch: Partial<CalendarBooking> = {},
  ): CalendarBooking => {
    seq += 1;
    const start = Date.UTC(2026, 8, Number(day), h + 5); // Lima = UTC-5
    return {
      id: `b${seq}`,
      resourceId: 'r-ana',
      eventTypeId: 'et-cons',
      start: new Date(start).toISOString(),
      end: new Date(start + minutes * 60_000).toISOString(),
      status: 'accepted',
      attendeeName: 'Carla Mendoza',
      tags: [],
      categoryColor: null,
      ...patch,
    };
  };

  const bookings: CalendarBooking[] = [
    booking('07', 9, 45),
    booking('07', 10, 60, {
      resourceId: 'r-luis',
      status: 'pending',
      attendeeName: 'Jorge Paredes',
    }),
    booking('07', 11, 30, {
      status: 'completed',
      attendeeName: 'María Fernanda Rodríguez Villanueva-Salazar',
      eventTypeId: 'et-clean',
    }),
    booking('08', 9, 45, { resourceId: 'r-mar', status: 'no_show', attendeeName: null }),
    booking('08', 14, 60, { status: 'cancelled', attendeeName: 'Pedro Castillo' }),
    booking('08', 16, 60, {
      attendeeName: 'Visit (2 services)',
      groupId: 'g1',
      groupSeq: 1,
      groupLength: 2,
    }),
    booking('08', 17, 30, {
      attendeeName: 'Visit (2 services)',
      groupId: 'g1',
      groupSeq: 2,
      groupLength: 2,
      eventTypeId: 'et-fup',
    }),
    booking('09', 8, 45, { resourceId: 'r-luis', status: 'rejected', attendeeName: 'Li' }),
    booking('09', 12, 45, {
      attendeeName: 'Paid',
      paid: true,
      tickets: [{ id: 'tk1', humanId: 'F001-000123' }],
    }),
  ];

  // The store's definition fetch 404s under Storybook and is caught: no custom columns.
  const customValues = createBookingCustomValues();

  const { Story } = defineMeta({
    title: 'Components/Calendar/BookingBoard',
    component: BookingBoard,
    tags: ['autodocs'],
    argTypes: { axis: { control: 'select', options: ['status', 'staff'] } },
    args: {
      bookings,
      resources,
      eventTypes,
      timeZone: TZ,
      customValues,
      axis: 'status',
      onaxis: fn(),
      onopen: fn(),
      onstatus: fn(),
      onvisitstatus: fn(),
      onstaff: fn(),
    },
  });
</script>

<Story name="By status" />
<Story name="By staff" args={{ axis: 'staff' }} />
<Story name="Empty" args={{ bookings: [] }} />
<Story
  name="Read-only (no drag)"
  args={{ onstatus: undefined, onvisitstatus: undefined, onstaff: undefined }}
/>
<Story
  name="Many cards"
  args={{
    bookings: Array.from({ length: 40 }, (_, i) =>
      booking(String(7 + (i % 5)).padStart(2, '0'), 8 + (i % 10), 30, {
        resourceId: resources[i % 3].id,
        status: ['accepted', 'pending', 'completed', 'no_show'][i % 4],
        attendeeName: `Patient ${i + 1}`,
      }),
    ),
  }}
/>

<!-- Responsive: the columns share the viewport width; cards truncate on a phone. -->
<Story name="By status · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }} />
