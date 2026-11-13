<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import WeekHoursEditor from '$lib/components/scheduling/WeekHoursEditor.svelte';

  // Index 0 = Sunday.
  const day = (enabled: boolean, start = '09:00', end = '18:00') => ({ enabled, start, end });
  const weekdays = [day(false), day(true), day(true), day(true), day(true), day(true), day(false)];

  const { Story } = defineMeta({
    title: 'Components/Calendar/WeekHoursEditor',
    component: WeekHoursEditor,
    tags: ['autodocs'],
    args: { week: weekdays },
  });
</script>

<Story name="Weekdays 09–18" />
<Story name="All closed" args={{ week: Array.from({ length: 7 }, () => day(false)) }} />
<Story
  name="Split shifts, late nights"
  args={{
    week: [
      day(true, '10:00', '14:00'),
      day(true, '07:30', '22:45'),
      day(false),
      day(true, '12:00', '12:30'),
      day(true),
      day(true, '16:00', '23:59'),
      day(true, '00:00', '06:00'),
    ],
  }}
/>
