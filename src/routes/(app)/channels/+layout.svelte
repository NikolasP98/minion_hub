<script lang="ts">
  import type { Snippet } from 'svelte';
  import ChannelsNav from '$lib/components/channels/ChannelsNav.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<div class="h-full flex">
  <ChannelsNav channels={data.channels} />
  <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
    {@render children()}
  </div>
</div>
