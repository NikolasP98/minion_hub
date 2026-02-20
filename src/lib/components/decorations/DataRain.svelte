<script lang="ts">
  import { onMount } from 'svelte';

  let { density = 'medium', color = 'var(--color-accent)', speed = 1.5 }: {
    density?: 'low' | 'medium' | 'high';
    color?: string;
    speed?: number;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);

  const densityMap = { low: 15, medium: 30, high: 50 };
  const glyphs = ['·', '•', '○', '◊', '▪', '═', '║', '╔', '╗', '╚', '╝',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

  interface Column {
    x: number;
    y: number;
    speed: number;
    chars: string[];
    length: number;
    resetAt: number;
  }

  /**
   * Parse a CSS color value into an RGB string usable in rgba().
   * Handles hex (#rrggbb, #rgb) and var() references by reading the
   * computed style from a temporary element.
   */
  function resolveColor(raw: string): string {
    if (raw.startsWith('#')) {
      const hex = raw.replace('#', '');
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return `${r}, ${g}, ${b}`;
      }
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return `${r}, ${g}, ${b}`;
    }
    /* For CSS variable references, create a temporary element to resolve */
    const el = document.createElement('div');
    el.style.color = raw;
    document.body.appendChild(el);
    const computed = getComputedStyle(el).color;
    document.body.removeChild(el);
    const match = computed.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (match) return `${match[1]}, ${match[2]}, ${match[3]}`;
    return '59, 130, 246'; /* fallback blue */
  }

  function randomGlyph(): string {
    return glyphs[Math.floor(Math.random() * glyphs.length)];
  }

  onMount(() => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf: number;
    let W = 0;
    let H = 0;
    let columns: Column[] = [];

    const colCount = densityMap[density];
    const rgb = resolveColor(color);

    function resize() {
      W = canvas!.width = canvas!.offsetWidth;
      H = canvas!.height = canvas!.offsetHeight;
      initColumns();
    }

    function initColumns() {
      columns = [];
      const spacing = W / colCount;
      for (let i = 0; i < colCount; i++) {
        const length = Math.floor(Math.random() * 12) + 4;
        columns.push({
          x: spacing * i + spacing / 2,
          y: Math.random() * H,
          speed: (Math.random() * 0.8 + 0.4) * speed,
          chars: Array.from({ length }, randomGlyph),
          length,
          resetAt: H + Math.random() * 200,
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';

      for (const col of columns) {
        for (let j = 0; j < col.chars.length; j++) {
          const charY = col.y - j * 14;
          if (charY < -14 || charY > H + 14) continue;
          const fade = 1 - j / col.chars.length;
          ctx.fillStyle = `rgba(${rgb}, ${fade * 0.6})`;
          ctx.fillText(col.chars[j], col.x, charY);
        }

        col.y += col.speed;

        if (col.y - col.chars.length * 14 > col.resetAt) {
          col.y = -col.chars.length * 14;
          col.chars = Array.from({ length: col.length }, randomGlyph);
          col.resetAt = H + Math.random() * 200;
        }
      }

      raf = requestAnimationFrame(draw);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    draw();

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
  });
</script>

<canvas
  bind:this={canvas}
  class="absolute inset-0 w-full h-full pointer-events-none"
></canvas>
