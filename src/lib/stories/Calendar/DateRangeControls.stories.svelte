<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import DateRangeControls from '$lib/components/dashboard/DateRangeControls.svelte';

  // Controlled: the page owns from/to. Bounds are INCLUSIVE calendar days.
  const { Story } = defineMeta({
    title: 'Calendar/DateRangeControls',
    component: DateRangeControls,
    tags: ['autodocs'],
    argTypes: {
      period: { control: 'select', options: ['hour', 'day', 'week', 'month', 'year'] },
      withTime: { control: 'boolean' },
    },
    args: {
      from: '2026-10-09',
      to: '2026-11-07',
      period: 'day',
      timeZone: 'America/Lima',
      onChange: fn(),
    },
  });
</script>

<Story name="Last 30 days (preset match)" />
<Story
  name="Custom range (no preset)"
  args={{ from: '2026-03-14', to: '2026-07-02', period: 'week' }}
/>
<Story name="Single day" args={{ from: '2026-11-07', to: '2026-11-07' }} />
<Story
  name="Year to date, monthly"
  args={{ from: '2026-01-01', to: '2026-11-07', period: 'month' }}
/>
<Story name="All time (open bounds)" args={{ from: '', to: '', period: 'year' }} />
<Story
  name="With time-of-day ranges"
  args={{
    withTime: true,
    period: 'hour',
    periods: ['hour', 'day', 'week', 'month', 'year'],
    from: '2026-11-07T00:00',
    to: '2026-11-07T23:59',
  }}
/>
<Story
  name="Data bounds (clamped)"
  args={{ dataMin: '2026-06-01', dataMax: '2026-11-05', from: '2026-06-01', to: '2026-11-05' }}
/>
<Story
  name="Only two visible presets"
  args={{ defaultVisible: ['7d', '30d'], storageKey: 'sb-date-range-two' }}
/>
<Story name="Days only (no coarser periods)" args={{ periods: ['day'] }} />

<!-- Responsive: presets wrap and every control grows to the 44px touch size below 768px. -->
<Story
  name="Last 30 days (preset match) · Phone"
  globals={{ viewport: { value: 'phone', isRotated: false } }}
/>
<Story
  name="With time-of-day ranges · Phone"
  args={{
    withTime: true,
    period: 'hour',
    periods: ['hour', 'day', 'week', 'month', 'year'],
    from: '2026-11-07T00:00',
    to: '2026-11-07T23:59',
  }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
/>
