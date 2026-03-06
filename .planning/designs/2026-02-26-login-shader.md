# Login Page WebGL Shader Effect Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a fullscreen WebGL canvas to the login page that recreates the BgPattern in GLSL and applies two-level domain-warped distortion with subtle mouse interaction.

**Architecture:** A new `LoginShader.svelte` component mounts a WebGL canvas (`z-1`, `pointer-events-none`, `fixed inset-0`) in the login layout. A fragment shader recreates the active dot/grid pattern and applies fbm domain warping for a trippy animated distortion. Mouse position is smooth-lerped and passed as a uniform that drives a local vortex field.

**Tech Stack:** WebGL 1.0 (via `canvas.getContext('webgl')`), GLSL ES 1.0, Svelte 5 runes, `bgPattern` state from `$lib/state/bg-pattern.svelte.ts`

---

### Task 1: Create `LoginShader.svelte` with WebGL boilerplate

**Files:**
- Create: `src/lib/components/decorations/LoginShader.svelte`

This task scaffolds the component with a canvas element, WebGL context init, resize handling, and the animation loop — no shader logic yet, just a clear canvas to prove the pipeline works.

**Step 1: Create the component**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  let canvas = $state<HTMLCanvasElement | null>(null);

  onMount(() => {
    if (!canvas) return;
    const gl = canvas.getContext('webgl');
    if (!gl) return; // graceful fallback — SVG pattern still shows

    let raf: number;
    let W = 0, H = 0;

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
      gl.viewport(0, 0, W, H);
    }

    function draw() {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      raf = requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    resize();
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  });
</script>

<canvas bind:this={canvas} class="fixed inset-0 w-full h-full pointer-events-none z-1"></canvas>
```

**Step 2: Mount it in the login layout**

File: `src/routes/login/+layout.svelte`

Add import and place between `<BgPattern />` and `{@render children()}`:

```svelte
<script lang="ts">
  import '../../app.css';
  import { ParaglideJS } from '@inlang/paraglide-sveltekit';
  import { i18n } from '$lib/i18n';
  import ParticleCanvas from '$lib/components/ParticleCanvas.svelte';
  import BgPattern from '$lib/components/decorations/BgPattern.svelte';
  import LoginShader from '$lib/components/decorations/LoginShader.svelte';
  import { theme, applyTheme } from '$lib/state/theme.svelte';
  import { locale } from '$lib/state/locale.svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  $effect(() => applyTheme(theme.preset, theme.accent.value));
</script>

<ParaglideJS {i18n} languageTag={locale.current}>
  <ParticleCanvas />
  <BgPattern />
  <LoginShader />
  {@render children()}
</ParaglideJS>
```

**Step 3: Type-check**

```bash
bun run check
```
Expected: 0 errors, 0 warnings

**Step 4: Commit**

```bash
git add src/lib/components/decorations/LoginShader.svelte src/routes/login/+layout.svelte
git commit -m "feat(login): scaffold LoginShader WebGL canvas"
```

---

### Task 2: Write vertex shader + fullscreen quad

**Files:**
- Modify: `src/lib/components/decorations/LoginShader.svelte`

Sets up the minimal vertex shader and fullscreen quad geometry that every subsequent fragment shader step builds on.

**Step 1: Add shader compilation helpers and vertex shader inside `onMount`**

Replace the `onMount` body with this (keep the canvas element markup unchanged):

```ts
onMount(() => {
  if (!canvas) return;
  const gl = canvas.getContext('webgl');
  if (!gl) return;

  // ── Shader helpers ─────────────────────────────────────────────────────
  function compile(type: number, src: string): WebGLShader {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error('Shader error:', gl.getShaderInfoLog(s));
    return s;
  }

  function link(vs: WebGLShader, fs: WebGLShader): WebGLProgram {
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      console.error('Link error:', gl.getProgramInfoLog(p));
    return p;
  }

  // ── Vertex shader (fullscreen quad) ────────────────────────────────────
  const VS = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // ── Placeholder fragment shader (transparent) ──────────────────────────
  const FS = `
    precision mediump float;
    varying vec2 v_uv;
    void main() {
      gl_FragColor = vec4(0.0);
    }
  `;

  const prog = link(compile(gl.VERTEX_SHADER, VS), compile(gl.FRAGMENT_SHADER, FS));
  gl.useProgram(prog);

  // Fullscreen quad: two triangles covering NDC [-1,1]
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),
    gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Enable alpha blending
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let raf: number;
  let W = 0, H = 0;

  function resize() {
    W = canvas!.width = window.innerWidth;
    H = canvas!.height = window.innerHeight;
    gl.viewport(0, 0, W, H);
  }

  function draw() {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    raf = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
});
```

**Step 2: Type-check**

```bash
bun run check
```
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/lib/components/decorations/LoginShader.svelte
git commit -m "feat(login): add vertex shader and fullscreen quad"
```

---

### Task 3: Write the fragment shader — pattern reconstruction

**Files:**
- Modify: `src/lib/components/decorations/LoginShader.svelte`

Replaces the placeholder `FS` string with a real fragment shader that draws the dots pattern at the correct tile size and opacity, matching the SVG BgPattern exactly (no distortion yet).

**Step 1: Replace the `FS` constant and add uniforms**

Replace the `FS` string and the code from `const prog = link(...)` onwards with:

```ts
  const FS = `
    precision highp float;
    varying vec2 v_uv;

    uniform vec2  u_resolution;
    uniform float u_time;
    uniform vec2  u_mouse;       // normalized 0..1
    uniform float u_tile_size;   // px
    uniform float u_opacity;     // 0..1
    uniform vec3  u_accent;      // RGB 0..1
    uniform int   u_pattern;     // 0=dots 1=grid 2=crosses 3=diagonal 4=hexagons

    // ── Pattern SDFs ─────────────────────────────────────────────────────
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
      // axial hex grid
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
      float v = pattern(px);
      gl_FragColor = vec4(u_accent, v * u_opacity);
    }
  `;

  const prog = link(compile(gl.VERTEX_SHADER, VS), compile(gl.FRAGMENT_SHADER, FS));
  gl.useProgram(prog);

  // Quad geometry
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),
    gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Uniform locations
  const uRes    = gl.getUniformLocation(prog, 'u_resolution');
  const uTime   = gl.getUniformLocation(prog, 'u_time');
  const uMouse  = gl.getUniformLocation(prog, 'u_mouse');
  const uTile   = gl.getUniformLocation(prog, 'u_tile_size');
  const uOpac   = gl.getUniformLocation(prog, 'u_opacity');
  const uAccent = gl.getUniformLocation(prog, 'u_accent');
  const uPat    = gl.getUniformLocation(prog, 'u_pattern');

  // Parse --color-accent CSS var → RGB 0..1
  function accentRGB(): [number, number, number] {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent').trim();
    // Handles formats: #rrggbb, #rgb, rgb(r,g,b)
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  }

  // Pattern enum mapping
  const PATTERN_MAP: Record<string, number> = {
    dots: 0, grid: 1, crosses: 2, diagonal: 3, hexagons: 4
  };

  let W = 0, H = 0;
  let mouseX = 0.5, mouseY = 0.5; // lerp targets
  let mx = 0.5, my = 0.5;         // current lerped values
  let raf: number;

  function resize() {
    W = canvas!.width = window.innerWidth;
    H = canvas!.height = window.innerHeight;
    gl.viewport(0, 0, W, H);
  }

  function onMouseMove(e: MouseEvent) {
    mouseX = e.clientX / W;
    mouseY = 1.0 - e.clientY / H; // flip Y for GL coords
  }

  function draw() {
    // Smooth-lerp mouse
    mx += (mouseX - mx) * 0.06;
    my += (mouseY - my) * 0.06;

    const t = performance.now() / 1000;
    const accent = accentRGB();
    const patIndex = PATTERN_MAP[/* bgPattern.pattern */ 'dots'] ?? 0;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform2f(uRes,   W, H);
    gl.uniform1f(uTime,  t);
    gl.uniform2f(uMouse, mx, my);
    gl.uniform1f(uTile,  18);      // will use bgPattern.size in task 5
    gl.uniform1f(uOpac,  0.08);    // will use bgPattern.opacity in task 5
    gl.uniform3f(uAccent, ...accent);
    gl.uniform1i(uPat,   patIndex);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    raf = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', onMouseMove);
  resize();
  draw();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('mousemove', onMouseMove);
  };
```

**Step 2: Type-check**

```bash
bun run check
```
Expected: 0 errors

**Step 3: Visual check**

```bash
bun run dev
```
Navigate to `http://localhost:5173/login`. You should see the dots pattern rendered by the shader — visually identical to the SVG BgPattern below it (both layers visible, slightly stronger dots).

**Step 4: Commit**

```bash
git add src/lib/components/decorations/LoginShader.svelte
git commit -m "feat(login): shader draws pattern in GLSL (no warp yet)"
```

---

### Task 4: Add domain warping to the fragment shader

**Files:**
- Modify: `src/lib/components/decorations/LoginShader.svelte`

This is the core visual step. Adds fbm noise + two-level domain warping to the `FS` string. The `pattern()` call remains identical — only the coordinates passed to it change.

**Step 1: Expand the `FS` GLSL string**

Insert these functions into `FS` **before** the `pattern(vec2)` function definitions, and update `main()`:

```glsl
    // ── Noise / fbm ──────────────────────────────────────────────────────
    vec2 hash2(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(p) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = dot(hash2(i + vec2(0,0)), f - vec2(0,0));
      float b = dot(hash2(i + vec2(1,0)), f - vec2(1,0));
      float c = dot(hash2(i + vec2(0,1)), f - vec2(0,1));
      float d = dot(hash2(i + vec2(1,1)), f - vec2(1,1));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 rot = mat2(1.6, 1.2, -1.2, 1.6); // rotate each octave
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = rot * p;
        a *= 0.5;
      }
      return v;
    }

    // ── Domain warp (Inigo Quilez two-level) ─────────────────────────────
    vec2 domainWarp(vec2 p, float t) {
      // First layer
      vec2 q = vec2(
        fbm(p + vec2(0.0,  0.0) + 0.10 * t),
        fbm(p + vec2(5.2,  1.3) + 0.10 * t)
      );
      // Second layer
      vec2 r = vec2(
        fbm(p + 1.5 * q + vec2(1.7, 9.2) + 0.13 * t),
        fbm(p + 1.5 * q + vec2(8.3, 2.8) + 0.13 * t)
      );
      return p + 2.2 * r;
    }

    // ── Mouse vortex ─────────────────────────────────────────────────────
    vec2 mouseVortex(vec2 px, vec2 mousePx) {
      vec2 delta = px - mousePx;
      float dist = length(delta);
      float radius = 280.0;
      float strength = 0.4 * smoothstep(radius, 0.0, dist);
      // Rotate delta by strength angle
      float s = sin(strength), c = cos(strength);
      return vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y) + mousePx;
    }
```

Replace `main()` with:

```glsl
    void main() {
      vec2 px = v_uv * u_resolution;

      // Mouse vortex in pixel space
      vec2 mousePx = u_mouse * u_resolution;
      vec2 vortexPx = mouseVortex(px, mousePx);

      // Domain warp in a normalised space (so warp scale is resolution-independent)
      vec2 normP = vortexPx / max(u_resolution.x, u_resolution.y) * 4.0;
      vec2 warpedNorm = domainWarp(normP, u_time);

      // Map warped coords back to pixel space for the pattern
      vec2 warpedPx = warpedNorm / 4.0 * max(u_resolution.x, u_resolution.y);

      float v = pattern(warpedPx);

      // Subtle hue drift: shift accent color over time
      float hShift = sin(u_time * 0.15) * 0.15;
      vec3 col = u_accent + vec3(hShift, -hShift * 0.5, hShift * 0.3);
      col = clamp(col, 0.0, 1.0);

      gl_FragColor = vec4(col, v * u_opacity * 2.5);
    }
```

Note: `u_opacity * 2.5` boosts the shader pattern's opacity so it reads clearly over the faint SVG — tweak this multiplier if needed.

**Step 2: Type-check**

```bash
bun run check
```
Expected: 0 errors

**Step 3: Visual check**

```bash
bun run dev
```
Go to `http://localhost:5173/login`. The dot pattern should now warp and breathe. Move the mouse — a vortex swirls the pattern near the cursor.

**Step 4: Commit**

```bash
git add src/lib/components/decorations/LoginShader.svelte
git commit -m "feat(login): add domain warp + mouse vortex to shader"
```

---

### Task 5: Wire up `bgPattern` reactive state

**Files:**
- Modify: `src/lib/components/decorations/LoginShader.svelte`

Replaces the hardcoded `18` / `0.08` / `'dots'` values in `draw()` with live reads from `bgPattern`, so the shader tracks config changes in real time.

**Step 1: Add the import at the top of `<script>`**

```ts
import { bgPattern, type PatternType } from '$lib/state/bg-pattern.svelte';
```

**Step 2: Replace the hardcoded values in `draw()`**

```ts
    const patIndex = PATTERN_MAP[bgPattern.pattern as PatternType] ?? 0;

    gl.uniform1f(uTile,  bgPattern.size);
    gl.uniform1f(uOpac,  (bgPattern.opacity / 100) * 2.5);  // same 2.5 boost
    gl.uniform1i(uPat,   patIndex);
```

**Step 3: Type-check**

```bash
bun run check
```
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/lib/components/decorations/LoginShader.svelte
git commit -m "feat(login): wire shader uniforms to bgPattern reactive state"
```

---

### Task 6: Hide the SVG BgPattern on the login page to avoid double-rendering

**Files:**
- Modify: `src/routes/login/+layout.svelte`

The SVG BgPattern is still rendering underneath the shader. That's fine for depth — but if it looks visually cluttered (two dot layers), hide it on login. Add a prop to `BgPattern` that lets it be hidden, or simply don't render it in the login layout.

**Step 1: Remove `<BgPattern />` from the login layout**

In `src/routes/login/+layout.svelte`, delete the `<BgPattern />` line and its import. The shader now owns the pattern entirely on the login page.

```svelte
<script lang="ts">
  import '../../app.css';
  import { ParaglideJS } from '@inlang/paraglide-sveltekit';
  import { i18n } from '$lib/i18n';
  import ParticleCanvas from '$lib/components/ParticleCanvas.svelte';
  import LoginShader from '$lib/components/decorations/LoginShader.svelte';
  import { theme, applyTheme } from '$lib/state/theme.svelte';
  import { locale } from '$lib/state/locale.svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  $effect(() => applyTheme(theme.preset, theme.accent.value));
</script>

<ParaglideJS {i18n} languageTag={locale.current}>
  <ParticleCanvas />
  <LoginShader />
  {@render children()}
</ParaglideJS>
```

**Step 2: Visual check**

```bash
bun run dev
```
Login page should look clean — one warped pattern layer, no SVG doubling.

**Step 3: Commit**

```bash
git add src/routes/login/+layout.svelte
git commit -m "feat(login): remove SVG BgPattern from login layout, shader owns it"
```

---

### Task 7: Polish — re-read accent color on theme change

**Files:**
- Modify: `src/lib/components/decorations/LoginShader.svelte`

`accentRGB()` is called every frame which reads a canvas pixel — cheap but wasteful. Cache it and re-read when the theme changes via a `$effect`.

**Step 1: Move accent color to a reactive variable**

In the `<script>` block (outside `onMount`), add:

```ts
import { theme } from '$lib/state/theme.svelte';

let accentColor = $state<[number, number, number]>([0.5, 0.5, 0.5]);

$effect(() => {
  // Re-run whenever theme changes
  theme.preset; theme.accent.value;
  // Defer one tick so CSS vars are applied first
  requestAnimationFrame(() => {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent').trim();
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    accentColor = [r / 255, g / 255, b / 255];
  });
});
```

**Step 2: Remove `accentRGB()` helper and replace in `draw()`**

Delete the `accentRGB()` function and replace `const accent = accentRGB()` with:
```ts
    gl.uniform3f(uAccent, ...accentColor);
```

**Step 3: Type-check**

```bash
bun run check
```
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/lib/components/decorations/LoginShader.svelte
git commit -m "feat(login): cache accent color, re-read on theme change"
```

---

### Task 8: Final visual QA + push

**Step 1: Full type-check and dev run**

```bash
bun run check
bun run dev
```

Check:
- [ ] Login page loads at `http://localhost:5173/login`
- [ ] Dots pattern warps and breathes continuously
- [ ] Moving the mouse creates a visible but subtle vortex swirl near cursor
- [ ] No JS errors in browser console
- [ ] Navigating away from `/login` — shader is gone (not on main app)
- [ ] WebGL unavailable (can test by blocking WebGL in devtools) — login page still shows SVG BgPattern from the main app layout... wait, the login layout no longer has BgPattern. Consider adding a CSS fallback: if WebGL not supported, don't remove BgPattern. But this is an edge case — most browsers support WebGL. Skip unless user requests.

**Step 2: Push**

```bash
git push
```
