<script lang="ts">
  import type { Snippet } from 'svelte';
  import SchedulingNav from '$lib/components/scheduling/SchedulingNav.svelte';
  import { navMode } from '$lib/state/ui/nav-mode.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';
  let { children }: { children: Snippet } = $props();

  // In module mode the sidebar already lists these pages — rendering the
  // section nav too would duplicate the same links side by side.
  const navigation = $derived(navMode.isModule ? undefined : sectionNav);
</script>

{#snippet sectionNav()}
  <SchedulingNav />
{/snippet}

<SectionShell mode="responsive" class="sched-shell" {navigation}>
  {@render children()}
</SectionShell>

<style>
  /* Phone calendar (spec 145): the nav row hides, stays mounted. */
  :global(.sched-shell:has(.is-compact-calendar) > [data-part='section-navigation']) {
    display: none;
  }
</style>
