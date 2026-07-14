<script lang="ts">
  import type { Snippet } from 'svelte';
  import BrainsNav from '$lib/components/brains/BrainsNav.svelte';
  import SectionShell from '$lib/components/ui/foundations/SectionShell.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<SectionShell>
  {#snippet navigation()}<BrainsNav />{/snippet}
  {@render children()}
</SectionShell>
