<script lang="ts">
  import type { Snippet } from 'svelte';
  import PosNav from '$lib/components/pos/PosNav.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<SectionShell mode="responsive">
  {#snippet navigation()}<PosNav />{/snippet}
  {@render children()}
</SectionShell>
