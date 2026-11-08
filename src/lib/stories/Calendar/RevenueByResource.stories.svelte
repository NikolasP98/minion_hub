<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import RevenueByResource from '$lib/components/scheduling/RevenueByResource.svelte';

  const revenue = [
    { resourceId: 'r1', name: 'Ana Quispe', bookings: 42, linkedRevenue: 6830.5 },
    { resourceId: 'r2', name: 'Luis Fernández de la Torre', bookings: 17, linkedRevenue: 1240 },
    { resourceId: 'r3', name: 'Mar', bookings: 0, linkedRevenue: 0 },
  ];

  const { Story } = defineMeta({
    title: 'Calendar/RevenueByResource',
    component: RevenueByResource,
    tags: ['autodocs'],
    args: { revenue },
  });
</script>

<Story name="Populated" />
<Story name="Empty" args={{ revenue: [] }} />
<Story
  name="Large values"
  args={{
    revenue: [
      { resourceId: 'r1', name: 'Main clinic', bookings: 12480, linkedRevenue: 1987654.25 },
      { resourceId: 'r2', name: 'Branch', bookings: 3, linkedRevenue: 0.5 },
    ],
  }}
/>
