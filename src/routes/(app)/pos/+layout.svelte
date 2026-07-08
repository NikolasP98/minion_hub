<script lang="ts">
  import type { Snippet } from 'svelte';
  import PosNav from '$lib/components/pos/PosNav.svelte';
  import ShiftBanner from '$lib/components/pos/ShiftBanner.svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<div class="h-full flex">
  <PosNav />
  <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
    <ShiftBanner />
    <div class="flex-1 min-h-0 overflow-y-auto">
      {@render children()}
    </div>
  </div>
</div>
