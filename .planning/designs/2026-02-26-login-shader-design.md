# Login Page WebGL Shader Effect — Design

## Overview

A fixed fullscreen WebGL canvas sits at `z-1` on the login page, above the `BgPattern` SVG (`z-0`) and below the login form (`z-10`). It recreates the active background pattern in GLSL and applies domain-warped distortion to produce a trippy, organic, continuously animated effect with subtle mouse interaction.

## Component

**New file:** `src/lib/components/decorations/LoginShader.svelte`

**Mounted in:** `src/routes/login/+layout.svelte` — inserted between `<BgPattern />` and `{@render children()}`

## Shader Architecture

### Pattern Reconstruction
The fragment shader mirrors the BgPattern SVG logic in GLSL. Reads `u_tile_size` (from `bgPattern.size`) and draws:
- `dots` — distance-field circles at each tile center
- `grid` — step function on fract coords
- `crosses` — two perpendicular line segments per cell
- `diagonal` — single diagonal line per cell
- `hexagons` — hexagonal grid SDF

Pattern type passed as an integer uniform `u_pattern`.

### Domain Warping (trippy layer)
Two-level fbm domain warping (Inigo Quilez technique):

```
q = vec2(fbm(p), fbm(p + 5.2))
r = vec2(fbm(p + q + time*0.15), fbm(p + q + 1.3 + time*0.126))
warpedP = p + 1.8 * r
```

- fbm: 5 octaves, lacunarity 2.0, gain 0.5
- Slow time coefficients so cycles run ~60s+
- Warp strength strong enough to be surreal, pattern remains recognizable

### Color
Base color from `u_accent` (RGB, parsed from `--color-accent` CSS var at mount). Hue drifts ±15° using a sin wave over time. Opacity matches `u_opacity` from `bgPattern.opacity`.

### Mouse Interaction
- JS side: smooth-lerps mouse position at factor 0.06 per frame (magnetic lag)
- Shader: radial vortex field centered at `u_mouse` (normalized coords), radius ~250px
  - Rotates the local sample coordinates by an angle proportional to `1/distance`
  - Max rotation ~0.4 rad at center, falls off as `1/r²`
  - Subtle — feels like a gentle gravitational disturbance

## Uniforms

| Name | Type | Source |
|---|---|---|
| `u_time` | float | `performance.now() / 1000` |
| `u_resolution` | vec2 | canvas size |
| `u_mouse` | vec2 | lerped mouse position, normalized |
| `u_tile_size` | float | `bgPattern.size` |
| `u_opacity` | float | `bgPattern.opacity / 100` |
| `u_accent` | vec3 | parsed `--color-accent` |
| `u_pattern` | int | enum 0=dots,1=grid,2=crosses,3=diagonal,4=hexagons |

## Layering

The SVG `BgPattern` remains underneath as an undistorted anchor — the shader draws the warped version on top. Where the shader pattern is at minimum opacity, the stable SVG grid shows through, creating a depth/parallax feel.

## Non-Goals

- No interaction on non-login pages (component is login-layout-only)
- No SSR (canvas is mounted in `onMount`)
- No fallback for WebGL-unavailable browsers (graceful: shader just absent, SVG pattern still shows)
