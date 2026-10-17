<script lang="ts">
  /**
   * The assistant's body: a WebGL2 sphere with marbled colour inside (SmoothUI
   * `orb`, MIT). Renders at most 60 fps, stops when off-screen or under reduced
   * motion, and falls back to a painted sphere when WebGL is unavailable or the
   * browser reclaims the context (pages with many canvases).
   */
  import { onMount } from 'svelte';
  import type { Lab } from './orb-color';
  import { ORB_DEFAULTS, ORB_FRAGMENT, ORB_SPHERE_FRACTION, ORB_VERTEX } from './orb-shader';

  interface Props {
    /** Two OkLab stops: body → edge. */
    stops: [Lab, Lab];
    /** CSS colours for the painted fallback. */
    body: string;
    edge: string;
    /** How far the flow field carries the field over a loop. */
    flow?: number;
    /** Strength of the nested warp — marbling rather than blobs. */
    turbulence?: number;
  }

  const {
    stops,
    body,
    edge,
    flow = ORB_DEFAULTS.flow,
    turbulence = ORB_DEFAULTS.turbulence,
  }: Props = $props();

  const TAU = Math.PI * 2;
  const FRAME_MS = 1000 / 60;
  const MAX_DPR = 2;

  let canvas = $state<HTMLCanvasElement | null>(null);
  let failed = $state(false);
  let sync: (() => void) | null = null;

  // Push changed props as uniforms instead of rebuilding the context.
  $effect(() => {
    void stops;
    void flow;
    void turbulence;
    sync?.();
  });

  onMount(() => {
    const gl = canvas?.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: 'low-power',
      premultipliedAlpha: true,
      stencil: false,
    });
    if (!canvas || !gl) {
      failed = true;
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, ORB_VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, ORB_FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      failed = true;
      return;
    }
    gl.useProgram(prog);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const at = (n: string) => gl.getUniformLocation(prog, n);
    const d = ORB_DEFAULTS;

    const push = () => {
      const lab = new Float32Array(12);
      for (let i = 0; i < 4; i++) lab.set(stops[Math.min(i, 1)], i * 3);
      gl.uniform3fv(at('uLab'), lab);
      gl.uniform1f(at('uCount'), 2);
      gl.uniform1f(at('uScaleN'), 1.45 / d.blobScale);
      gl.uniform1f(at('uFlow'), flow);
      gl.uniform1f(at('uTurb'), turbulence);
      gl.uniform1f(at('uShift'), d.shift);
      gl.uniform1f(at('uBalance'), 5 ** ((0.5 - d.balance) * 2));
      gl.uniform1f(at('uChroma'), d.chroma);
      gl.uniform1f(at('uContrast'), d.contrast);
      gl.uniform1f(at('uRim'), d.rim);
      gl.uniform1f(at('uSpec'), d.specular);
      gl.uniform1f(at('uInner'), d.inner);
      gl.uniform1f(at('uShading'), d.shading);
      gl.uniform1f(at('uRefract'), d.refraction);
      gl.uniform1f(at('uIrid'), d.iridescence);
      gl.uniform1f(at('uAberr'), d.aberration);
      gl.uniform1f(at('uGrain'), d.grain);
      gl.uniform1f(at('uSoft'), d.softness);
      gl.uniform1f(at('uWobble'), d.wobble);
      // The halo would spill past the silhouette the eyes sit against.
      gl.uniform1f(at('uGlow'), 0);
      gl.uniform3f(at('uLight'), d.lightX, d.lightY, 0.65);
    };

    const uRes = at('uRes');
    const uPhase = at('uPhase');
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const r = canvas!.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (canvas!.width === w && canvas!.height === h) return;
      canvas!.width = w;
      canvas!.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };
    const draw = () => {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let phase = 0;
    let last = 0;
    let pending = 0;
    let raf = 0;
    let onScreen = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = last ? Math.min(now - last, 100) : FRAME_MS;
      last = now;
      pending += dt;
      if (pending < FRAME_MS - dt * 0.5) return;
      phase = (phase + pending / 1000 / d.duration) % 1;
      pending = 0;
      gl.uniform1f(uPhase, phase * TAU);
      draw();
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const start = () => {
      if (raf || reduce.matches || !onScreen) return;
      last = 0;
      pending = 0;
      raf = requestAnimationFrame(tick);
    };
    const applyMotion = () => {
      if (reduce.matches) {
        stop();
        gl.uniform1f(uPhase, 0);
        draw();
      } else start();
    };

    push();
    resize();
    gl.uniform1f(uPhase, 0);
    draw();
    sync = () => {
      push();
      if (!raf) draw();
    };

    const ro = new ResizeObserver(() => {
      resize();
      if (!raf) draw();
    });
    ro.observe(canvas);
    // Nothing is gained by burning GPU on an orb nobody can see.
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.at(-1)?.isIntersecting ?? true;
        if (onScreen) start();
        else stop();
      },
      { rootMargin: '120px' },
    );
    io.observe(canvas);
    reduce.addEventListener('change', applyMotion);
    // A reclaimed context leaves a blank canvas; paint the stand-in instead.
    const lost = (e: Event) => {
      e.preventDefault();
      stop();
      failed = true;
    };
    canvas.addEventListener('webglcontextlost', lost);
    applyMotion();

    return () => {
      sync = null;
      stop();
      ro.disconnect();
      io.disconnect();
      reduce.removeEventListener('change', applyMotion);
      canvas?.removeEventListener('webglcontextlost', lost);
      gl.deleteProgram(prog);
      // Chromium caps live WebGL contexts per page; give ours back now.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  });

  const inset = `${((1 - ORB_SPHERE_FRACTION) / 2) * 100}%`;
</script>

<div class="ai-orb">
  <!-- Painted understudy, exactly under the sphere: it is all that shows when the
       shader cannot run, and it keeps the body visible if the context is lost. -->
  <span
    class="stand-in"
    style:inset
    style:background-image="radial-gradient(circle at 34% 30%, {edge}, {body} 72%)"
    aria-hidden="true"
  ></span>
  {#if !failed}
    <canvas bind:this={canvas} aria-hidden="true" tabindex="-1"></canvas>
  {/if}
</div>

<style>
  .ai-orb {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .stand-in {
    position: absolute;
    border-radius: var(--radius-full);
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
