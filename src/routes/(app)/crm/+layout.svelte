<script lang="ts">
  import type { Snippet } from 'svelte';
  import CrmNav from '$lib/components/crm/CrmNav.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<SectionShell mode="responsive">
  {#snippet navigation()}<CrmNav />{/snippet}
  {@render children()}
</SectionShell>
