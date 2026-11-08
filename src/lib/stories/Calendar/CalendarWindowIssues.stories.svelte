<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import CalendarWindowIssues from '$lib/components/scheduling/CalendarWindowIssues.svelte';
  import type { CalendarWindowState } from '$lib/components/scheduling/kit/window-cache.svelte';

  const w = (key: string, status: CalendarWindowState['status'], hasData = false): CalendarWindowState => {
    const to = new Date(Date.parse(`${key}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
    return { key, from: key, to, status, hasData };
  };

  const { Story } = defineMeta({
    title: 'Calendar/CalendarWindowIssues',
    component: CalendarWindowIssues,
    tags: ['autodocs'],
    args: { windows: [w('2026-09-07', 'error')], onretry: fn() },
  });
</script>

<Story name="One failed week" />
<Story name="Failed with stale data" args={{ windows: [w('2026-09-07', 'error', true)] }} />
<Story
  name="Many failed"
  args={{ windows: [w('2026-08-24', 'error'), w('2026-08-31', 'error', true), w('2026-09-07', 'error'), w('2026-09-14', 'error'), w('2026-09-21', 'error')] }}
/>
<Story name="Mixed (only errors show)" args={{ windows: [w('2026-08-31', 'ready', true), w('2026-09-07', 'error'), w('2026-09-14', 'loading')] }} />
<Story name="No issues" args={{ windows: [w('2026-09-07', 'ready', true), w('2026-09-14', 'loading')] }} />

<!-- Responsive: each issue row wraps its actions below 640px. -->
<Story
  name="Many failed · Phone"
  args={{ windows: [w('2026-08-24', 'error'), w('2026-08-31', 'error', true), w('2026-09-07', 'error'), w('2026-09-14', 'error'), w('2026-09-21', 'error')] }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
/>
