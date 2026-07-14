<script lang="ts">
  import type { Snippet } from 'svelte';
  import AdsNav from '$lib/components/ads/AdsNav.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';
  let { children }: { children: Snippet } = $props();
</script>

<SectionShell mode="responsive">
  {#snippet navigation()}<AdsNav />{/snippet}
  {@render children()}
</SectionShell>
