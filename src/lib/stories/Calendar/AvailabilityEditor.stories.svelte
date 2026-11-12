<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AvailabilityEditor from '$lib/components/scheduling/AvailabilityEditor.svelte';

  // Edits autosave through `/api/scheduling/...`, which Storybook does not
  // serve — the save indicator shows the failure state after a change.
  const schedule = {
    scheduleId: 'sch-1',
    timezone: 'America/Lima',
    updatedAt: '2026-09-01T12:00:00.000Z',
    rules: [
      { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00', date: null },
      { days: [6], startTime: '10:00', endTime: '14:00', date: null },
    ],
  };

  const { Story } = defineMeta({
    title: 'Components/Calendar/AvailabilityEditor',
    component: AvailabilityEditor,
    tags: ['autodocs'],
    args: { resourceId: 'r-ana', schedule },
  });
</script>

<Story name="With schedule" />
<Story name="No schedule yet" args={{ schedule: null }} />
<Story
  name="Per-day rules"
  args={{
    schedule: {
      ...schedule,
      rules: [
        { days: [1], startTime: '07:30', endTime: '12:00', date: null },
        { days: [3], startTime: '14:00', endTime: '22:00', date: null },
        { days: [0], startTime: '00:00', endTime: '06:00', date: null },
      ],
    },
  }}
/>
