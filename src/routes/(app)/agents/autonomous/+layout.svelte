<script lang="ts">
  import type { Snippet } from 'svelte';
  import AgentWindowLayer from '$lib/components/agents/AgentWindowLayer.svelte';
  let { children }: { children: Snippet } = $props();
</script>

{@render children()}
<AgentWindowLayer />
