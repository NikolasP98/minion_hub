<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import MemberCalendarStrip from '$lib/components/scheduling/MemberCalendarStrip.svelte';

  const TZ = 'America/Lima';
  // Lima = UTC-5, so 09:00 local is 14:00Z.
  const b = (id: string, day: string, h: number, min: number, title: string, status = 'accepted', attendeeName: string | null = 'Carla Mendoza') => ({
    id,
    start: `2026-09-${day}T${String(h + 5).padStart(2, '0')}:00:00.000Z`,
    end: `2026-09-${day}T${String(h + 5).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`,
    status,
    attendeeName,
    title,
  });

  const bookings = [
    b('1', '07', 9, 45, 'Consultation'),
    b('2', '07', 11, 30, 'Follow-up', 'pending', 'Jorge Paredes'),
    b('3', '08', 10, 30, 'Deep cleaning and whitening session with fluoride', 'completed', 'María Fernanda Rodríguez Villanueva'),
    b('4', '09', 15, 15, 'Call', 'cancelled', null),
    b('5', '10', 8, 45, 'Consultation', 'no_show', 'Li'),
    b('6', '11', 16, 59, 'Consultation', 'accepted', 'Pedro Castillo'),
    b('7', '11', 17, 30, 'Follow-up', 'accepted', 'Ana Quispe'),
    b('8', '11', 18, 30, 'Follow-up', 'rejected', 'Walk-in'),
  ];

  const { Story } = defineMeta({
    title: 'Calendar/MemberCalendarStrip',
    component: MemberCalendarStrip,
    tags: ['autodocs'],
    argTypes: { compact: { control: 'boolean' } },
    args: { weekStart: '2026-09-07', bookings, timeZone: TZ, compact: false },
  });
</script>

<Story name="Populated" />
<Story name="Compact" args={{ compact: true }} />
<Story name="Empty week" args={{ bookings: [] }} />
<Story name="Custom colour" args={{ color: 'var(--color-success-border)' }} />
<Story
  name="Busy day"
  args={{ bookings: [...bookings, ...[8, 9, 10, 11, 12, 13, 14, 15].map((h) => b(`d${h}`, '11', h, 50, `Slot ${h}:00`))] }}
/>

<!-- Responsive: seven equal columns share the width; labels truncate on a phone. -->
<Story
  name="Busy day · Phone"
  args={{ bookings: [...bookings, ...[8, 9, 10, 11, 12, 13, 14, 15].map((h) => b(`d${h}`, '11', h, 50, `Slot ${h}:00`))] }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
/>
