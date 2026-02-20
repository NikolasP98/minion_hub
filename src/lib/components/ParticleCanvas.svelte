<script lang="ts">
  import { onMount } from 'svelte';
  import { conn } from '$lib/state/connection.svelte';

  let canvas = $state<HTMLCanvasElement | null>(null);
  let raf: number;

  interface Particle {
    x: number; y: number;
    vx: number; vy: number;
    r: number; a: number;
  }

  onMount(() => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let particles: Particle[] = [];
    let W = 0, H = 0;

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
    }

    function spawn() {
      particles = Array.from({ length: 60 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.3,
        a: Math.random(),
      }));
    }

    function hueFromState(): string {
      switch (conn.particleHue) {
        case 'blue':  return '210';
        case 'amber': return '40';
        default:      return '0';
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const hue = hueFromState();
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 80%, 65%, ${p.a * 0.6})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    resize();
    spawn();
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  });
</script>

<canvas bind:this={canvas} class="fixed top-0 left-0 w-full h-full -z-1 pointer-events-none opacity-70"></canvas>
