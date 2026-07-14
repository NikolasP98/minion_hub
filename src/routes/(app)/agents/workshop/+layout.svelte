<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import WorkshopNav from '$lib/components/workshop/WorkshopNav.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';

  let { children }: { children: Snippet } = $props();

  // The side-menu shows on the experiment surfaces (list + compare/groupchat/
  // leaderboard) but NOT on the immersive `[id]` canvas editor, which is
  // fullscreen. Editor paths are /agents/workshop/<saveId>; everything else is
  // a known static nav target.
  const NAV_PATHS = new Set([
    '/agents/workshop',
    '/agents/workshop/compare',
    '/agents/workshop/groupchat',
    '/agents/workshop/leaderboard',
  ]);
  const showNav = $derived(NAV_PATHS.has(page.url.pathname));
</script>

{#if showNav}
  <SectionShell mode="responsive" variant="canvas">
    {#snippet navigation()}<WorkshopNav />{/snippet}
    {@render children()}
  </SectionShell>
{:else}
  {@render children()}
{/if}
