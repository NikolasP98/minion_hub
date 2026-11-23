<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import WeekStrip from '$lib/components/scheduling/WeekStrip.svelte';

  const { Story } = defineMeta({
    title: 'Components/Calendar/WeekStrip',
    component: WeekStrip,
    tags: ['autodocs'],
    args: { date: '2026-09-09', today: '2026-09-10', onday: fn(), onweek: fn() },
  });
</script>

<!-- Selected day filled; today ringed and named "…, hoy" for assistive tech. -->
<Story
  name="Selected day, today ahead"
  globals={{ viewport: { value: 'phone', isRotated: false } }}
/>

<Story
  name="Selected day is today"
  args={{ date: '2026-09-10' }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
/>

<Story
  name="Today in another week"
  args={{ today: '2026-09-21' }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
/>

<Story
  name="Sunday selected (week starts Monday)"
  args={{ date: '2026-09-13' }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
/>
