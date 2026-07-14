<script lang="ts">
  import type { Snippet } from 'svelte';
  import MarketplaceNav from '$lib/components/marketplace/MarketplaceNav.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';

  let { children }: { children: Snippet } = $props();
</script>

<SectionShell mode="responsive">
  {#snippet navigation()}<MarketplaceNav />{/snippet}
  {@render children()}
</SectionShell>
