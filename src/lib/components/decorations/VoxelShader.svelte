<script lang="ts">
  import { onMount } from 'svelte';
  import { theme } from '$lib/state/ui/theme.svelte';

  let canvas = $state<HTMLCanvasElement | null>(null);
  let accentColor = $state<[number, number, number]>([0, 0.94, 1]);

  $effect(() => {
    void theme.preset;
    void theme.accent.value;
    requestAnimationFrame(() => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-accent').trim();
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx2d = c.getContext('2d')!;
      ctx2d.fillStyle = raw;
      ctx2d.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx2d.getImageData(0, 0, 1, 1).data;
      accentColor = [r / 255, g / 255, b / 255];
    });
  });

  onMount(() => {
    if (!canvas) return;
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return;
    const ctx: WebGLRenderingContext = gl;

    function compile(type: number, src: string): WebGLShader {
      const s = ctx.createShader(type)!;
      ctx.shaderSource(s, src);
      ctx.compileShader(s);
      if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS))
        console.error('VoxelShader compile error:', ctx.getShaderInfoLog(s));
      return s;
    }

    function link(vs: WebGLShader, fs: WebGLShader): WebGLProgram {
      const p = ctx.createProgram()!;
      ctx.attachShader(p, vs);
      ctx.attachShader(p, fs);
      ctx.linkProgram(p);
      if (!ctx.getProgramParameter(p, ctx.LINK_STATUS))
        console.error('VoxelShader link error:', ctx.getProgramInfoLog(p));
      return p;
    }

    const VS = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    const FS = `
      precision mediump float;
      varying vec2 v_uv;
      uniform vec2  u_resolution;
      uniform float u_time;
      uniform vec3  u_accent;
      uniform float u_intensity;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        vec2 uv = v_uv;
        float t = u_time;

        // Effect 1: Interference plasma (two-frequency sine moiré)
        float plasma =
          sin(uv.x * 3.1 + t * 0.12) * sin(uv.y * 2.3 - t * 0.09) * 0.5 +
          sin(uv.x * 5.7 - t * 0.07) * cos(uv.y * 4.1 + t * 0.11) * 0.5;
        float plasmaContrib = (plasma * 0.5 + 0.5) * 0.04;

        // Effect 2: Three drifting phosphor hot-spots (Lissajous paths)
        float spots = 0.0;
        spots += smoothstep(0.28, 0.0, length(uv - vec2(sin(t*0.13)*0.3+0.5, cos(t*0.11)*0.3+0.5))) * 0.08;
        spots += smoothstep(0.22, 0.0, length(uv - vec2(cos(t*0.09)*0.4+0.5, sin(t*0.17)*0.25+0.5))) * 0.06;
        spots += smoothstep(0.15, 0.0, length(uv - vec2(sin(t*0.21+1.5)*0.35+0.5, cos(t*0.15+0.8)*0.35+0.5))) * 0.05;

        // Effect 3: Rare horizontal sync jitter (~0.2% of frames)
        float jitterGate = step(0.998, hash(vec2(floor(t * 0.25), 7.3)));
        float jitterBandY = 0.3 + hash(vec2(floor(t * 0.25), 2.1)) * 0.4;
        float jitterBand = smoothstep(0.008, 0.0, abs(uv.y - jitterBandY));
        float jitter = jitterGate * jitterBand * sin(uv.y * 600.0 + t * 40.0) * 0.003;
        float plasmaJittered = sin((uv.x + jitter) * 3.1 + t * 0.12) * sin(uv.y * 2.3 - t * 0.09);
        plasmaContrib += (plasmaJittered * 0.5 + 0.5) * jitterGate * 0.02;

        float total = (plasmaContrib + spots) * u_intensity;
        gl_FragColor = vec4(u_accent * total, total);
      }
    `;

    const vs = compile(ctx.VERTEX_SHADER, VS);
    const fs = compile(ctx.FRAGMENT_SHADER, FS);
    const prog = link(vs, fs);
    ctx.useProgram(prog);

    const buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(ctx.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),
      ctx.STATIC_DRAW);
    const aPos = ctx.getAttribLocation(prog, 'a_pos');
    ctx.enableVertexAttribArray(aPos);
    ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0);

    ctx.enable(ctx.BLEND);
    ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE);

    const uRes       = ctx.getUniformLocation(prog, 'u_resolution');
    const uTime      = ctx.getUniformLocation(prog, 'u_time');
    const uAccent    = ctx.getUniformLocation(prog, 'u_accent');
    const uIntensity = ctx.getUniformLocation(prog, 'u_intensity');

    let W = 0, H = 0;
    let raf: number;
    let paused = false;

    function resize() {
      W = canvas!.width  = Math.floor(window.innerWidth  / 2);
      H = canvas!.height = Math.floor(window.innerHeight / 2);
      ctx.viewport(0, 0, W, H);
    }

    function draw() {
      if (paused) { raf = requestAnimationFrame(draw); return; }

      const t = performance.now() / 1000;
      ctx.clearColor(0, 0, 0, 0);
      ctx.clear(ctx.COLOR_BUFFER_BIT);

      ctx.uniform2f(uRes, W, H);
      ctx.uniform1f(uTime, t);
      ctx.uniform3f(uAccent, accentColor[0], accentColor[1], accentColor[2]);
      ctx.uniform1f(uIntensity, 0.6);

      ctx.drawArrays(ctx.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(draw);
    }

    function onVisibilityChange() {
      paused = document.hidden;
    }

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    resize();
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      ctx.deleteBuffer(buf);
      ctx.deleteProgram(prog);
      ctx.deleteShader(vs);
      ctx.deleteShader(fs);
    };
  });
</script>

<canvas
  bind:this={canvas}
  class="fixed inset-0 w-full h-full pointer-events-none"
  style="z-index: -3; mix-blend-mode: screen;"
></canvas>
