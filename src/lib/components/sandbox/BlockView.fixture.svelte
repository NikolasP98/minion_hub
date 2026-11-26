<script lang="ts">
  /** Test harness: lets a mounted test change BlockView props without remounting it. */
  import BlockView from './BlockView.svelte';
  import type { ComponentProps } from 'svelte';

  let { initial }: { initial: ComponentProps<typeof BlockView> } = $props();
  // svelte-ignore state_referenced_locally
  let current = $state(initial);

  export function set(next: ComponentProps<typeof BlockView>) {
    current = next;
  }
</script>

<BlockView {...current} />
