<script lang="ts">
  import type { Snippet } from 'svelte';
  import SchedulingNav from '$lib/components/scheduling/SchedulingNav.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';
  let { children }: { children: Snippet } = $props();
</script>

<SectionShell mode="responsive">
  {#snippet navigation()}<SchedulingNav />{/snippet}
  {@render children()}
</SectionShell>
