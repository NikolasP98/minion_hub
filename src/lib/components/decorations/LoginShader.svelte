<script lang="ts">
  import { onMount } from 'svelte';
  import { bgPattern } from '$lib/state/bg-pattern.svelte';

  let canvas = $state<HTMLCanvasElement | null>(null);

  onMount(() => {
    if (!canvas) return;
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return;
    const ctx: WebGLRenderingContext = gl;

    // ── Shader helpers ──────────────────────────────────────────────────
    function compile(type: number, src: string): WebGLShader {
      const s = ctx.createShader(type)!;
      ctx.shaderSource(s, src);
      ctx.compileShader(s);
      if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS))
        console.error('Shader error:', ctx.getShaderInfoLog(s));
      return s;
    }

    function link(vs: WebGLShader, fs: WebGLShader): WebGLProgram {
      const p = ctx.createProgram()!;
      ctx.attachShader(p, vs);
      ctx.attachShader(p, fs);
      ctx.linkProgram(p);
      if (!ctx.getProgramParameter(p, ctx.LINK_STATUS))
        console.error('Link error:', ctx.getProgramInfoLog(p));
      return p;
    }

    // ── Vertex shader (fullscreen quad) ─────────────────────────────────
    const VS = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    // ── Fragment shader — pattern reconstruction ─────────────────────────
    const FS = `
      precision highp float;
      varying vec2 v_uv;

      uniform vec2  u_resolution;
      uniform float u_time;
      uniform vec2  u_mouse;
      uniform float u_tile_size;
      uniform float u_opacity;
      uniform vec3  u_accent;
      uniform int   u_pattern;

      // ── Noise / fbm ────────────────────────────────────────────────────
      vec2 hash2(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0));
        float b = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
        float c = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
        float d = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        mat2 rot = mat2(1.6, 1.2, -1.2, 1.6);
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p = rot * p;
          a *= 0.5;
        }
        return v;
      }

      // ── Domain warp (two-level, Inigo Quilez) ──────────────────────────
      vec2 domainWarp(vec2 p, float t) {
        vec2 q = vec2(
          fbm(p + vec2(0.0, 0.0) + 0.10 * t),
          fbm(p + vec2(5.2, 1.3) + 0.10 * t)
        );
        vec2 r = vec2(
          fbm(p + 1.5 * q + vec2(1.7, 9.2) + 0.13 * t),
          fbm(p + 1.5 * q + vec2(8.3, 2.8) + 0.13 * t)
        );
        return p + 2.2 * r;
      }

      // ── Mouse vortex ───────────────────────────────────────────────────
      vec2 mouseVortex(vec2 px, vec2 mousePx) {
        vec2 delta = px - mousePx;
        float dist = length(delta);
        float radius = 280.0;
        float strength = 0.4 * smoothstep(radius, 0.0, dist);
        float s = sin(strength), c = cos(strength);
        return vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y) + mousePx;
      }

      float pat_dots(vec2 p, float size) {
        vec2 cell = fract(p / size) - 0.5;
        float r = max(0.8, size / 12.0) / size;
        return 1.0 - smoothstep(r - 0.01, r + 0.01, length(cell));
      }

      float pat_grid(vec2 p, float size) {
        vec2 f = fract(p / size);
        float lw = 0.5 / size;
        float hx = smoothstep(lw + 0.005, lw, f.x);
        float hy = smoothstep(lw + 0.005, lw, f.y);
        return max(hx, hy);
      }

      float pat_crosses(vec2 p, float size) {
        vec2 f = fract(p / size) - 0.5;
        float arm = 1.0 / 6.0;
        float lw = 0.6 / size;
        float hx = step(abs(f.y), lw) * step(abs(f.x), arm);
        float hy = step(abs(f.x), lw) * step(abs(f.y), arm);
        return max(hx, hy);
      }

      float pat_diagonal(vec2 p, float size) {
        float d = fract((p.x - p.y) / size);
        float lw = 0.4 / size;
        return smoothstep(lw + 0.005, lw, min(d, 1.0 - d));
      }

      float pat_hexagons(vec2 p, float size) {
        vec2 q = p / size;
        q.x /= 0.75;
        float gx = fract(q.x) - 0.5;
        float gy = fract(q.y + (mod(floor(q.x), 2.0)) * 0.5) - 0.5;
        float hex = max(abs(gx), abs(gy) * 1.1547 + abs(gx) * 0.5);
        float r = 0.42;
        float lw = 0.5 / size;
        return smoothstep(r, r - lw, hex);
      }

      float pattern(vec2 p) {
        if (u_pattern == 0) return pat_dots(p, u_tile_size);
        if (u_pattern == 1) return pat_grid(p, u_tile_size);
        if (u_pattern == 2) return pat_crosses(p, u_tile_size);
        if (u_pattern == 3) return pat_diagonal(p, u_tile_size);
        return pat_hexagons(p, u_tile_size);
      }

      void main() {
        vec2 px = v_uv * u_resolution;

        // Mouse vortex in pixel space
        vec2 mousePx = u_mouse * u_resolution;
        vec2 vortexPx = mouseVortex(px, mousePx);

        // Domain warp in normalised space (resolution-independent)
        vec2 normP = vortexPx / max(u_resolution.x, u_resolution.y) * 4.0;
        vec2 warpedNorm = domainWarp(normP, u_time);

        // Map back to pixel space for pattern sampling
        vec2 warpedPx = warpedNorm / 4.0 * max(u_resolution.x, u_resolution.y);

        float v = pattern(warpedPx);

        // Subtle hue drift over time
        float hShift = sin(u_time * 0.15) * 0.15;
        vec3 col = u_accent + vec3(hShift, -hShift * 0.5, hShift * 0.3);
        col = clamp(col, 0.0, 1.0);

        gl_FragColor = vec4(col, v * u_opacity * 2.5);
      }
    `;

    const vs = compile(ctx.VERTEX_SHADER, VS);
    const fs = compile(ctx.FRAGMENT_SHADER, FS);
    const prog = link(vs, fs);
    ctx.useProgram(prog);

    // Fullscreen quad: two triangles covering NDC [-1,1]
    const buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(ctx.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),
      ctx.STATIC_DRAW);
    const aPos = ctx.getAttribLocation(prog, 'a_pos');
    ctx.enableVertexAttribArray(aPos);
    ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0);

    ctx.enable(ctx.BLEND);
    ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA);

    // Uniform locations
    const uRes    = ctx.getUniformLocation(prog, 'u_resolution');
    const uTime   = ctx.getUniformLocation(prog, 'u_time');
    const uMouse  = ctx.getUniformLocation(prog, 'u_mouse');
    const uTile   = ctx.getUniformLocation(prog, 'u_tile_size');
    const uOpac   = ctx.getUniformLocation(prog, 'u_opacity');
    const uAccent = ctx.getUniformLocation(prog, 'u_accent');
    const uPat    = ctx.getUniformLocation(prog, 'u_pattern');

    // Parse --color-accent CSS var → RGB 0..1
    function accentRGB(): [number, number, number] {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-accent').trim();
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx2d = c.getContext('2d')!;
      ctx2d.fillStyle = raw;
      ctx2d.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx2d.getImageData(0, 0, 1, 1).data;
      return [r / 255, g / 255, b / 255];
    }

    let accent = accentRGB();

    const PATTERN_MAP: Record<string, number> = {
      dots: 0, grid: 1, crosses: 2, diagonal: 3, hexagons: 4
    };

    let W = 0, H = 0;
    let mouseX = 0.5, mouseY = 0.5;
    let mx = 0.5, my = 0.5;
    let raf: number;

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
      ctx.viewport(0, 0, W, H);
    }

    function onMouseMove(e: MouseEvent) {
      mouseX = e.clientX / W;
      mouseY = 1.0 - e.clientY / H;
    }

    function draw() {
      mx += (mouseX - mx) * 0.06;
      my += (mouseY - my) * 0.06;

      const t = performance.now() / 1000;

      ctx.clearColor(0, 0, 0, 0);
      ctx.clear(ctx.COLOR_BUFFER_BIT);

      ctx.uniform2f(uRes,   W, H);
      ctx.uniform1f(uTime,  t);
      ctx.uniform2f(uMouse, mx, my);
      ctx.uniform1f(uTile,  bgPattern.size);
      ctx.uniform1f(uOpac,  (bgPattern.opacity / 100) * 2.5);
      ctx.uniform3f(uAccent, accent[0], accent[1], accent[2]);
      ctx.uniform1i(uPat,   PATTERN_MAP[bgPattern.pattern] ?? 0);

      ctx.drawArrays(ctx.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouseMove);
    resize();
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      ctx.deleteBuffer(buf);
      ctx.deleteProgram(prog);
      ctx.deleteShader(vs);
      ctx.deleteShader(fs);
    };
  });
</script>

<canvas bind:this={canvas} class="fixed inset-0 w-full h-full pointer-events-none z-1"></canvas>
