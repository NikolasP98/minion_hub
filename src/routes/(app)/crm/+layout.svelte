<script lang="ts">
  import type { Snippet } from 'svelte';
  import CrmNav from '$lib/components/crm/CrmNav.svelte';
  import { navMode } from '$lib/state/ui/nav-mode.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  // In module mode the sidebar already lists these pages — rendering the
  // section nav too would duplicate the same links side by side.
  const navigation = $derived(navMode.isModule ? undefined : sectionNav);
</script>

{#snippet sectionNav()}
  <CrmNav />
{/snippet}

<SectionShell mode="responsive" {navigation}>
  {@render children()}
</SectionShell>
