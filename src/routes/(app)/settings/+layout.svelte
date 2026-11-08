<script lang="ts">
  import type { Snippet } from 'svelte';
  import { SectionShell } from '$lib/components/ui/foundations';
  let { children }: { children: Snippet } = $props();
</script>

<SectionShell mode="stacked">
  <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
    {@render children()}
  </div>
</SectionShell>
