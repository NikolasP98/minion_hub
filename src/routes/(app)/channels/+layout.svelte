<script lang="ts">
  import type { Snippet } from 'svelte';
  import ChannelsNav from '$lib/components/channels/ChannelsNav.svelte';
  import type { LayoutData } from './$types';
  import { SectionShell } from '$lib/components/ui/foundations';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<SectionShell mode="responsive">
  {#snippet navigation()}<ChannelsNav channels={data.channels} />{/snippet}
  {@render children()}
</SectionShell>
