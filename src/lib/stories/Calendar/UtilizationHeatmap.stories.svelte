<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import UtilizationHeatmap from '$lib/components/scheduling/UtilizationHeatmap.svelte';

  const DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
  const row = (resourceId: string, name: string, color: string | null, booked: number[], available = 480) => {
    const days = DAYS.map((date, i) => ({ date, bookedMin: booked[i] ?? 0, availableMin: i < 5 ? available : 0 }));
    const bookedMin = days.reduce((s, d) => s + d.bookedMin, 0);
    const availableMin = days.reduce((s, d) => s + d.availableMin, 0);
    return {
      resourceId,
      name,
      color,
      bookedMin,
      availableMin,
      utilization: availableMin ? bookedMin / availableMin : 0,
      bookingCount: Math.round(bookedMin / 45),
      days,
    };
  };

  const utilization = [
    row('r1', 'Ana Quispe', 'var(--color-info-border)', [420, 300, 480, 180, 60, 0, 0]),
    row('r2', 'Luis Fernández de la Torre', 'var(--color-success-border)', [120, 240, 90, 480, 480, 240, 0]),
    row('r3', 'Mar', null, [0, 0, 30, 0, 15, 0, 0]),
  ];

  const { Story } = defineMeta({
    title: 'Calendar/UtilizationHeatmap',
    component: UtilizationHeatmap,
    tags: ['autodocs'],
    args: { utilization },
  });
</script>

<Story name="Populated" />
<Story name="Empty" args={{ utilization: [] }} />
<Story name="Fully booked" args={{ utilization: [row('r1', 'Ana Quispe', 'var(--color-info-border)', [480, 480, 480, 480, 480])] }} />
<Story name="No availability" args={{ utilization: [row('r3', 'Unscheduled resource', null, [0, 0, 0, 0, 0], 0)] }} />
<Story
  name="Many resources"
  args={{
    utilization: Array.from({ length: 12 }, (_, i) =>
      row(`r${i}`, `Resource ${i + 1}`, i % 3 ? 'var(--color-warning-border)' : null, DAYS.map((_, d) => ((i * 7 + d * 13) % 9) * 60)),
    ),
  }}
/>
