<script lang="ts">
  import { onMount, type ComponentProps } from 'svelte';
  import Shell from '../mobile-composition/Shell.svelte';
  import HomePage from '../../../src/routes/(app)/home/+page.svelte';
  import { begin, stop } from './gateway-transport';
  // Matches the existing route-only fixture boundary; no server identity is certified.
  const data = {
    userName: 'Fixture User',
    greeting: 'Good to see you, Fixture.',
    openedIds: [],
  } as ComponentProps<typeof HomePage>['data'];
  onMount(() => {
    void begin();
    return stop;
  });
</script>

<Shell><HomePage {data} /></Shell>
