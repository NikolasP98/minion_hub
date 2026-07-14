<script lang="ts">
  import type { Snippet } from 'svelte';
  import FinanceNav from '$lib/components/finance/FinanceNav.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';
  let { children }: { children: Snippet } = $props();
</script>

<SectionShell mode="responsive">
  {#snippet navigation()}<FinanceNav />{/snippet}
  {@render children()}
</SectionShell>
