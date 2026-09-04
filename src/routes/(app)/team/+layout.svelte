<script lang="ts">
  import type { Snippet } from 'svelte';
  import { SectionShell } from '$lib/components/ui/foundations';
  import TeamNav from '$lib/components/team/TeamNav.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<SectionShell mode="responsive">
  {#snippet navigation()}<TeamNav />{/snippet}
  {@render children()}
</SectionShell>
