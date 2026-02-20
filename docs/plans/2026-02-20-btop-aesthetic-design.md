# btop Aesthetic + Tailwind 4 Migration + Theme System

**Date:** 2026-02-20
**Status:** Approved

## Summary

Transform Minion Hub's visual identity with a btop-inspired terminal aesthetic featuring colored dot patterns, HUD-style indicators, and animated decorations. Simultaneously migrate from pure CSS to Tailwind 4 with a CSS-first `@theme` configuration, and add a settings page for theme customization.

Three aesthetic intensity levels will be implemented in separate git worktree branches for visual comparison.

## Decisions

- **CSS strategy:** Full Tailwind 4 migration (replace all scoped CSS with utility classes)
- **Default theme:** shadcn New York — zinc neutrals, 6px radius, clean borders
- **Theme settings:** Preset themes + accent color picker
- **Persistence:** localStorage only (no API changes)
- **Delivery:** 3 worktree branches (`theme/subtle`, `theme/balanced`, `theme/immersive`)

## Shared Foundation (All Branches)

### Tailwind 4 Migration

- Install `tailwindcss` v4 + `@tailwindcss/vite`
- Create `src/app.css` with `@theme` block defining all design tokens
- Convert all 28+ components from scoped `<style>` to Tailwind utility classes
- shadcn New York defaults: zinc-900 backgrounds, zinc-50 text, 6px radius, 1px borders

### Theme System Architecture

```
src/lib/state/theme.svelte.ts    — Reactive theme state (runes), localStorage read/write
src/lib/themes/index.ts          — Theme preset definitions (colors, radius, fonts)
src/lib/themes/presets/           — Individual preset files
src/lib/components/ThemeProvider.svelte — Applies CSS variables to :root at runtime
```

**Preset themes:**
1. **New York** (default) — zinc neutrals, blue accent, 6px radius
2. **btop Purple** — deep purple/magenta palette inspired by btop screenshot
3. **Cyberpunk** — neon green/cyan on near-black
4. **Midnight Ocean** — deep navy/teal, calm and professional

**Accent colors:** 8-10 curated options (blue, purple, green, cyan, rose, amber, orange, emerald, indigo, red)

### Settings Page (`/settings`)

- New route: `src/routes/settings/+page.svelte`
- Navigation link added to Topbar
- Theme preset grid: visual preview cards showing each palette
- Accent color row: clickable swatches with active indicator
- Live preview: changes apply instantly via CSS variable updates
- Saved on selection (localStorage)

### Decorative Components

```
src/lib/components/decorations/
  DotGrid.svelte          — SVG dot grid pattern (configurable density, color, opacity)
  StatusDot.svelte         — Animated pulsing status indicator
  HudBorder.svelte         — Decorative border with corner accents
  ScanLine.svelte          — CSS scan line overlay animation
  DotMatrix.svelte         — Small data-driven dot matrix display
  DataRain.svelte          — Falling character/dot animation (canvas)
  GlitchText.svelte        — Text with glitch hover effect
  CornerAccent.svelte      — Dot cluster corner decorations
```

## Branch 1: `theme/subtle`

Refined, professional dashboard with terminal-inspired touches.

- **DotGrid** as faint SVG background on panels (8-10% opacity)
- **StatusDot** next to agent status, gateway health, connection indicators
- **CornerAccent** — tiny dot clusters in top-right of cards
- **ParticleCanvas** refinement — fewer particles, slower drift, more ambient
- No scan lines, no glitch effects, no dense overlays

## Branch 2: `theme/balanced`

Sci-fi command center that's still comfortably usable.

Everything from subtle, plus:
- **HudBorder** on major panels with dot-matrix underlines on section headers
- **ScanLine** overlays on chart/visualization panels (very subtle, 3-5% opacity)
- **DotMatrix** activity indicators that pulse with real data
- **Glow effects** on accent-colored elements (box-shadow with color spread)
- **Gradient border animations** on active/focused panels (slow color shift)
- Enhanced ParticleCanvas with connection lines between nearby particles

## Branch 3: `theme/immersive`

Deep btop / cyberpunk terminal aesthetic.

Everything from balanced, plus:
- **Dense DotGrid** backgrounds on sidebars and section headers (20-30% opacity)
- **DataRain** on empty states and loading screens
- **GlitchText** on hover for interactive elements
- **Full-screen grid overlay** across the entire app (2-3% opacity)
- **Terminal cursor blink** CSS animation on focused inputs
- **ASCII-art style** decorative borders (box-drawing characters in pseudo-elements)
- ParticleCanvas at full density with reactive behavior (particles move toward cursor)

## Component Migration Order

Priority order for Tailwind migration (shared across all branches):

1. `app.css` — global resets, `@theme` block, base layer
2. `+layout.svelte` — root layout structure
3. `Topbar.svelte` — navigation header
4. `AgentSidebar.svelte` — main sidebar
5. `DetailPanel.svelte` — content panel
6. `AgentRow.svelte` — list items
7. `AddAgentModal.svelte` — modal/form patterns
8. Remaining components in dependency order
9. `/reliability` route components
10. `/sessions` route components
11. Settings page (new)
12. Decorative components (new)
