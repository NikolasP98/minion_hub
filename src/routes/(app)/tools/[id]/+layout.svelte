<script lang="ts">
  import type { Snippet } from 'svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<PageShell archetype="workspace" scroll="none" variant="terminal">
  {@render children()}
</PageShell>
