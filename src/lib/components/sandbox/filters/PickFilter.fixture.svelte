<script lang="ts">
  /** Test harness: change PickFilter props without remounting (a host reload swaps equal objects in). */
  import PickFilter from './PickFilter.svelte';
  import type { ComponentProps } from 'svelte';

  let { initial }: { initial: ComponentProps<typeof PickFilter> } = $props();
  // svelte-ignore state_referenced_locally
  let current = $state(initial);

  export function set(next: ComponentProps<typeof PickFilter>) {
    current = next;
  }
</script>

<PickFilter {...current} />
