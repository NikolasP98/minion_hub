<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import WorkshopNav from '$lib/components/workshop/WorkshopNav.svelte';

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
  <div class="h-full flex">
    <WorkshopNav />
    <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">{@render children()}</div>
  </div>
{:else}
  {@render children()}
{/if}
