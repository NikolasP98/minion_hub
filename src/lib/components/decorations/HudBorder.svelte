<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children, class: className = '' }: { children: Snippet; class?: string } = $props();
</script>

<div class="relative {className}">
  <!-- Top-left bracket -->
  <div class="hud-bracket absolute top-0 left-0 w-3 h-3 border-l border-t border-accent/40 pointer-events-none"></div>
  <!-- Top-right bracket -->
  <div class="hud-bracket absolute top-0 right-0 w-3 h-3 border-r border-t border-accent/40 pointer-events-none"></div>
  <!-- Bottom-left bracket -->
  <div class="hud-bracket absolute bottom-0 left-0 w-3 h-3 border-l border-b border-accent/40 pointer-events-none"></div>
  <!-- Bottom-right bracket -->
  <div class="hud-bracket absolute bottom-0 right-0 w-3 h-3 border-r border-b border-accent/40 pointer-events-none"></div>
  {@render children()}
</div>

<style>
  :global([data-theme="voxelized"]) .hud-bracket {
    width: 1rem;
    height: 1rem;
    border-width: 2px;
    border-color: color-mix(in srgb, var(--color-cyan) 60%, transparent);
    color: color-mix(in srgb, var(--color-cyan) 30%, transparent);
    box-shadow: var(--shadow-status-glow);
    animation: vx-border-pulse 3s ease-in-out infinite;
  }
</style>
