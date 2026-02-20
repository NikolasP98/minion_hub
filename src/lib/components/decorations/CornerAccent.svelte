<script lang="ts">
  let { position = 'top-right', color = 'var(--color-accent)' }: {
    position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    color?: string;
  } = $props();

  const positionMap: Record<string, string> = {
    'top-right': 'top-1 right-1',
    'top-left': 'top-1 left-1',
    'bottom-right': 'bottom-1 right-1',
    'bottom-left': 'bottom-1 left-1',
  };

  /* Dot offsets form a small triangular cluster */
  const dots = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 0, y: 5 },
    { x: 5, y: 5 },
  ];
</script>

<div class="absolute pointer-events-none {positionMap[position]}" style="width: 9px; height: 9px;">
  {#each dots as dot}
    <div
      class="absolute rounded-full"
      style="width: 2px; height: 2px; left: {dot.x}px; top: {dot.y}px; background: {color}; opacity: 0.5;"
    ></div>
  {/each}
</div>
