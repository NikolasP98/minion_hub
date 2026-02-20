<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children, intensity = 'subtle', class: className = '' }: {
    children: Snippet;
    intensity?: 'subtle' | 'medium' | 'heavy';
    class?: string;
  } = $props();

  const intensityClass: Record<string, string> = {
    subtle: 'glitch-subtle',
    medium: 'glitch-medium',
    heavy: 'glitch-heavy',
  };
</script>

<span class="glitch-text {intensityClass[intensity]} {className}" data-text="">
  {@render children()}
</span>

<style>
  .glitch-text {
    position: relative;
    display: inline-block;
  }

  /* ── Subtle: tiny horizontal jitter ── */
  .glitch-subtle:hover {
    animation: glitch-subtle 0.3s ease both;
  }

  @keyframes glitch-subtle {
    0%, 100% { transform: translate(0); }
    20% { transform: translate(-1px, 0); }
    40% { transform: translate(1px, 0); }
    60% { transform: translate(-1px, 0); }
    80% { transform: translate(2px, 0); clip-path: inset(20% 0 30% 0); }
  }

  /* ── Medium: moderate displacement + clip ── */
  .glitch-medium:hover {
    animation: glitch-medium 0.4s ease both;
  }

  @keyframes glitch-medium {
    0%, 100% { transform: translate(0); clip-path: none; }
    15% { transform: translate(-2px, 1px); clip-path: inset(40% 0 20% 0); }
    30% { transform: translate(2px, -1px); clip-path: inset(10% 0 60% 0); }
    45% { transform: translate(-1px, 0); clip-path: none; }
    60% { transform: translate(3px, 0); clip-path: inset(50% 0 10% 0); }
    75% { transform: translate(-2px, 1px); clip-path: inset(20% 0 40% 0); }
  }

  /* ── Heavy: aggressive displacement + skew ── */
  .glitch-heavy:hover {
    animation: glitch-heavy 0.5s ease both;
  }

  @keyframes glitch-heavy {
    0%, 100% { transform: translate(0) skewX(0); clip-path: none; }
    10% { transform: translate(-4px, 2px) skewX(-2deg); clip-path: inset(30% 0 30% 0); }
    20% { transform: translate(4px, -1px) skewX(1deg); clip-path: inset(10% 0 50% 0); }
    30% { transform: translate(-3px, 0) skewX(3deg); clip-path: inset(60% 0 5% 0); }
    40% { transform: translate(5px, 1px) skewX(-1deg); clip-path: none; }
    50% { transform: translate(-2px, -2px) skewX(2deg); clip-path: inset(20% 0 40% 0); }
    60% { transform: translate(3px, 2px) skewX(-3deg); clip-path: inset(45% 0 15% 0); }
    70% { transform: translate(-5px, 0) skewX(1deg); clip-path: inset(5% 0 70% 0); }
    80% { transform: translate(4px, -1px) skewX(0); clip-path: none; }
  }
</style>
