<script lang="ts">
  import { bgPattern } from '$lib/state/bg-pattern.svelte';

  // canvas mode: absolute inset-0 -z-10 (use inside a relative z-0 container)
  // fixed mode (default): fixed inset-0 z-0 (global overlay)
  let { mode = 'fixed' }: { mode?: 'fixed' | 'canvas' } = $props();

  const color = 'var(--color-accent)';

  // Unique pattern ID per render to avoid SVG ID collisions
  const pid = $derived(`bg-pat-${bgPattern.pattern}-${bgPattern.size}-${mode}`);
  const cls = $derived(mode === 'canvas'
    ? 'absolute inset-0 w-full h-full pointer-events-none -z-10'
    : 'fixed inset-0 w-full h-full pointer-events-none z-0');
</script>

{#if bgPattern.pattern !== 'none'}
  <svg
    class={cls}
    style="opacity:{bgPattern.opacity / 100}"
    aria-hidden="true"
  >
    <defs>
      {#if bgPattern.pattern === 'dots'}
        <pattern id={pid} width={bgPattern.size} height={bgPattern.size} patternUnits="userSpaceOnUse">
          <circle cx={bgPattern.size / 2} cy={bgPattern.size / 2} r={Math.max(0.8, bgPattern.size / 12)} fill={color} />
        </pattern>

      {:else if bgPattern.pattern === 'grid'}
        <pattern id={pid} width={bgPattern.size} height={bgPattern.size} patternUnits="userSpaceOnUse">
          <path d="M {bgPattern.size} 0 L 0 0 0 {bgPattern.size}" fill="none" stroke={color} stroke-width="0.5" />
        </pattern>

      {:else if bgPattern.pattern === 'crosses'}
        {@const s = bgPattern.size}
        {@const c = s / 2}
        {@const arm = s / 6}
        <pattern id={pid} width={s} height={s} patternUnits="userSpaceOnUse">
          <line x1={c - arm} y1={c} x2={c + arm} y2={c} stroke={color} stroke-width="0.6" />
          <line x1={c} y1={c - arm} x2={c} y2={c + arm} stroke={color} stroke-width="0.6" />
        </pattern>

      {:else if bgPattern.pattern === 'diagonal'}
        <pattern id={pid} width={bgPattern.size} height={bgPattern.size} patternUnits="userSpaceOnUse">
          <line x1="0" y1={bgPattern.size} x2={bgPattern.size} y2="0" stroke={color} stroke-width="0.4" />
        </pattern>

      {:else if bgPattern.pattern === 'hexagons'}
        {@const s = bgPattern.size}
        {@const h = s * 0.866}
        {@const w = s}
        {@const cx = w * 0.75}
        {@const cy = h}
        {@const r = s * 0.42}
        <pattern id={pid} width={w * 1.5} height={h * 2} patternUnits="userSpaceOnUse">
          <polygon
            points="{cx + r},{cy} {cx + r * 0.5},{cy - r * 0.866} {cx - r * 0.5},{cy - r * 0.866} {cx - r},{cy} {cx - r * 0.5},{cy + r * 0.866} {cx + r * 0.5},{cy + r * 0.866}"
            fill="none" stroke={color} stroke-width="0.5"
          />
        </pattern>
      {/if}
    </defs>
    <rect width="100%" height="100%" fill="url(#{pid})" />
  </svg>
{/if}
