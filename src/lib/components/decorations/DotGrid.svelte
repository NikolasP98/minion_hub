<script lang="ts">
  let { opacity = 0.08, dotSize = 1.5, gap = 16, color = 'var(--color-accent)' }: {
    opacity?: number;
    dotSize?: number;
    gap?: number;
    color?: string;
  } = $props();
</script>

<svg class="absolute inset-0 w-full h-full pointer-events-none" style:opacity>
  <defs>
    <pattern id="dot-grid-{gap}-{dotSize}" x="0" y="0" width={gap} height={gap} patternUnits="userSpaceOnUse">
      <circle cx={gap / 2} cy={gap / 2} r={dotSize} fill={color} />
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#dot-grid-{gap}-{dotSize})" />
</svg>
