<script lang="ts">
  let { bins, color = '#3b82f6' }: { bins: number[]; color?: string } = $props();

  const W = 232;
  const H = 28;

  const path = $derived.by(() => {
    const max = Math.max(...bins, 1);
    const step = W / (bins.length - 1);
    const pts = bins.map((v, i) => [i * step, H - (v / max) * H * 0.9]);

    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const mx = (prev[0] + cur[0]) / 2;
      d += ` C ${mx} ${prev[1]} ${mx} ${cur[1]} ${cur[0]} ${cur[1]}`;
    }
    // close area
    d += ` L ${pts[pts.length - 1][0]} ${H} L ${pts[0][0]} ${H} Z`;
    return d;
  });
</script>

<svg viewBox="0 0 {W} {H}" width="100%" height="{H}" preserveAspectRatio="none">
  <defs>
    <linearGradient id="spark-fill-{color.replace('#', '')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{color}" stop-opacity="0.4" />
      <stop offset="100%" stop-color="{color}" stop-opacity="0" />
    </linearGradient>
  </defs>
  <path d={path} fill="url(#spark-fill-{color.replace('#', '')})" />
</svg>

<style>
  svg { display: block; }
</style>
