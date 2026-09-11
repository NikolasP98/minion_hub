<script lang="ts">
  // Mirrors the authenticated (app) shell's height/scroll chain ONLY:
  // AppViewport (100dvh, overflow hidden) → shell-main → route-viewport
  // (flex-1, min-h-0, overflow-y-auto) → h-full flex column. Sidebar, topbar
  // and module nav are intentionally absent; they are not this plan's scope.
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="fx-viewport">
  <div class="fx-main">
    <div data-part="route-viewport" class="fx-route">
      <div class="fx-page">{@render children()}</div>
    </div>
  </div>
</div>

<style>
  .fx-viewport {
    display: flex;
    width: 100%;
    height: 100dvh;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--color-canvas, var(--color-bg));
  }
  .fx-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: clip;
  }
  .fx-route {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .fx-page {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
