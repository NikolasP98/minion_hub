<script lang="ts">
  import { onMount } from 'svelte';
  import { Spinner } from '$lib/components/ui';
  import { theme } from '$lib/state/ui/theme.svelte';
  import { hexToRgb, THINKING_FRAGMENT, THINKING_VERTEX } from './thinking-shader';

  let { size = 20 }: { size?: number } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let failed = $state(false);
  let redraw: (() => void) | null = null;
  // Follows Settings → Accent live; the uniform is read on every frame.
  const accent = $derived(hexToRgb(theme.accent.value) ?? [0.5, 0.5, 0.5]);

  $effect(() => {
    void accent;
    redraw?.();
  });

  onMount(() => {
    const gl = canvas?.getContext('webgl', { premultipliedAlpha: true, antialias: false });
    if (!canvas || !gl) {
      failed = true;
      return;
    }
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, THINKING_VERTEX));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, THINKING_FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      failed = true;
      return;
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, 'r');
    const uT = gl.getUniformLocation(prog, 't');
    const uC = gl.getUniformLocation(prog, 'c');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = Math.round(size * dpr);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uR, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(uT, still ? 2.4 : (now - start) / 1000);
      gl.uniform3fv(uC, accent);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    if (still) draw(start);
    else raf = requestAnimationFrame(loop);
    redraw = still ? () => draw(start) : null;

    return () => {
      cancelAnimationFrame(raf);
      redraw = null;
      // Chromium caps live WebGL contexts per page; give ours back immediately.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  });
</script>

{#if failed}
  <Spinner size="sm" class="text-accent" />
{:else}
  <canvas
    bind:this={canvas}
    aria-hidden="true"
    class="shrink-0"
    style="width: {size}px; height: {size}px;"
  ></canvas>
{/if}
