<script lang="ts">
  import type { Snippet } from 'svelte';
  import AccountNav from '$lib/components/users/AccountNav.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';

  let { children }: { children: Snippet } = $props();
</script>

<SectionShell mode="split">
  {#snippet navigation()}<AccountNav />{/snippet}
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {@render children()}
  </div>
</SectionShell>
