<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    phase: 'dormant' | 'awakening' | 'forming' | 'connecting';
    agentName: string;
  }

  let { phase, agentName }: Props = $props();

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  let animFrame: number;
  let particles: Particle[] = [];
  let time = 0;

  class Particle {
    x: number; y: number;
    vx: number; vy: number;
    life: number; maxLife: number;
    size: number;
    hue: number;

    constructor(cx: number, cy: number) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.3 + Math.random() * 1.5;
      this.x = cx;
      this.y = cy;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed - 1;
      this.life = 0;
      this.maxLife = 80 + Math.random() * 120;
      this.size = 1 + Math.random() * 3;
      this.hue = 240 + Math.random() * 60;
    }

    update(dt: number) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy -= 0.003 * dt;
      this.life += dt;
    }

    alive() { return this.life < this.maxLife; }
    alpha() { return 1 - (this.life / this.maxLife); }
  }

  const PHASE_CONFIG = {
    dormant:   { radius: 40, glow: 0.3, particles: 0,   pulse: 0.3,  hue: 260 },
    awakening: { radius: 55, glow: 0.6, particles: 3,   pulse: 0.6,  hue: 250 },
    forming:   { radius: 65, glow: 0.8, particles: 6,   pulse: 0.8,  hue: 230 },
    connecting:{ radius: 70, glow: 1.0, particles: 10,  pulse: 1.0,  hue: 210 },
  };

  function draw(timestamp: number) {
    if (!ctx || !canvas) return;
    const dt = Math.min((timestamp - time) / 16.67, 3);
    time = timestamp;

    const cfg = PHASE_CONFIG[phase];
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    // Spawn particles
    if (phase !== 'dormant') {
      for (let i = 0; i < cfg.particles; i++) {
        particles.push(new Particle(cx, cy));
      }
    }

    // Update + draw particles
    particles = particles.filter(p => { p.update(dt); return p.alive(); });
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${p.alpha() * 0.7})`;
      ctx.fill();
    }

    // Main orb — multiple glow layers
    const pulse = Math.sin(timestamp * 0.002) * cfg.pulse * 0.3 + 1;

    // Outer glow
    const outerGrad = ctx.createRadialGradient(cx, cy, cfg.radius * 0.5, cx, cy, cfg.radius * 2.5 * pulse);
    outerGrad.addColorStop(0, `hsla(${cfg.hue}, 90%, 60%, ${cfg.glow * 0.4})`);
    outerGrad.addColorStop(0.5, `hsla(${cfg.hue}, 80%, 50%, ${cfg.glow * 0.15})`);
    outerGrad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(cx, cy, cfg.radius * 2.5 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = outerGrad;
    ctx.fill();

    // Inner glow
    const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cfg.radius * pulse);
    innerGrad.addColorStop(0, `hsla(${cfg.hue}, 100%, 75%, 0.9)`);
    innerGrad.addColorStop(0.4, `hsla(${cfg.hue}, 90%, 55%, 0.6)`);
    innerGrad.addColorStop(0.7, `hsla(${cfg.hue}, 80%, 40%, 0.3)`);
    innerGrad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(cx, cy, cfg.radius * pulse, 0, Math.PI * 2);
    ctx.fillStyle = innerGrad;
    ctx.fill();

    // Core
    ctx.beginPath();
    ctx.arc(cx, cy, cfg.radius * 0.3 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${cfg.hue}, 100%, 90%, 0.9)`;
    ctx.fill();

    // Name label
    if (agentName && phase !== 'dormant') {
      ctx.font = '500 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = `hsla(${cfg.hue}, 80%, 80%, 0.7)`;
      ctx.textAlign = 'center';
      ctx.fillText(agentName, cx, cy + cfg.radius + 24);
    }

    animFrame = requestAnimationFrame(draw);
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx!.scale(dpr, dpr);
    animFrame = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(animFrame);
  });
</script>

<canvas bind:this={canvas} class="orb-canvas"></canvas>

<style>
  .orb-canvas {
    width: 220px;
    height: 220px;
    border-radius: 50%;
  }
</style>