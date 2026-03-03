# Holo Glitter Effect Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a glittery sparkle effect to the holo cards using SVG turbulence noise as a CSS mask, revealing iridescent glitter flecks through `mix-blend-mode: multiply` on the white card surface, plus iridescent `background-clip: text` treatment for `.company-brand` / `.list-brand` font colors.

**Architecture:** A new `.holo-noise` overlay div (inside `.id-card`) holds an iridescent linear gradient. An SVG `feTurbulence` filter (inline data URI) is applied as a CSS `mask-image` at a tile size tuned for fine glitter. The mask turns the smooth gradient into hundreds of tiny scattered flecks. On a white background, `mix-blend-mode: multiply` makes those flecks appear as colored sparkle dots. Font colors use `background-clip: text` with a hue-shifting gradient driven by `--mx`. Same treatment applied in parallel to the list-card in `+page.svelte`.

**Tech Stack:** CSS `mask-image`, inline SVG `feTurbulence`/`feColorMatrix`, `mix-blend-mode: multiply`, `background-clip: text`, existing `use:holo` action, `.holo-active` class.

---

### Task 1: Add glitter noise layer to `AgentCard.svelte` (grid view)

**Files:**
- Modify: `src/lib/components/marketplace/AgentCard.svelte`

The `.id-card` div already has `.holo-shimmer`, `.holo-sheen`, `.holo-glare` divs. Add `.holo-noise` after `.holo-glare`.

**Step 1: Add the `.holo-noise` div in the template**

Find (around line 62–64):
```svelte
                <!-- Holo layers (pointer-driven, CSS-only) -->
                <div class="holo-shimmer" aria-hidden="true"></div>
                <div class="holo-sheen" aria-hidden="true"></div>
                <div class="holo-glare" aria-hidden="true"></div>
```
Replace with:
```svelte
                <!-- Holo layers (pointer-driven, CSS-only) -->
                <div class="holo-shimmer" aria-hidden="true"></div>
                <div class="holo-sheen" aria-hidden="true"></div>
                <div class="holo-glare" aria-hidden="true"></div>
                <div class="holo-noise" aria-hidden="true"></div>
```

**Step 2: Add `.holo-noise` CSS to the `<style>` block**

Append inside the existing `<style>` block, after the `.holo-active .holo-glare` rule:

```css
/* Glitter sparkle layer — turbulence noise mask over iridescent gradient */
.holo-noise {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: 3;
    background: linear-gradient(
        calc(var(--mx, 0.5) * 360deg + 90deg),
        hsl(calc(var(--mx, 0.5) * 240deg + 180deg), 80%, 35%),
        hsl(calc(var(--mx, 0.5) * 240deg + 260deg), 80%, 42%),
        hsl(calc(var(--mx, 0.5) * 240deg + 340deg), 80%, 35%)
    );
    -webkit-mask-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 9 -4'/></filter><rect width='100%25' height='100%25' filter='url(%23f)'/></svg>");
    mask-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 9 -4'/></filter><rect width='100%25' height='100%25' filter='url(%23f)'/></svg>");
    -webkit-mask-size: 180px 180px;
    mask-size: 180px 180px;
    -webkit-mask-repeat: repeat;
    mask-repeat: repeat;
    mix-blend-mode: multiply;
    opacity: 0;
    transition: opacity 0.4s ease;
}

:global(.agent-card-container:not(.flipped).holo-active) .holo-noise {
    opacity: 0.55;
}
```

**How this works:** `feColorMatrix` with values `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 9 -4` thresholds the smooth turbulence — it multiplies the alpha by 9 then subtracts 4, creating sparse discrete sparkle points. `multiply` blend on a white card surface: white × color = color, so the flecks show as tiny colored dots. The gradient shifts hue with pointer X.

**Step 3: Raise `.id-header`, etc. z-index to sit above `.holo-noise` (z-index 3)**

The existing rule already sets them to `z-index: 3`. Change to `z-index: 4` so content sits above the noise layer:

Find:
```css
    /* Ensure content renders above holo overlay layers */
    .id-header,
    .photo-container,
    .agent-info,
    .id-divider,
    .id-footer {
        position: relative;
        z-index: 3;
    }
```
Replace with:
```css
    /* Ensure content renders above holo overlay layers */
    .id-header,
    .photo-container,
    .agent-info,
    .id-divider,
    .id-footer {
        position: relative;
        z-index: 4;
    }
```

**Step 4: Visual check**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run dev
```

Open `http://localhost:5173/marketplace/agents`, hover over a grid card. You should see individual colored sparkle flecks appear across the white card surface. The flecks should shift hue as you move the pointer horizontally. Moving away should fade them out smoothly.

If the sparkles are too dense, increase `baseFrequency` to `0.75`. Too sparse, decrease to `0.55`. If too dark/visible at rest, reduce the `opacity` in the active state from `0.55` to `0.35`.

**Step 5: Commit**

```bash
git add src/lib/components/marketplace/AgentCard.svelte
git commit -m "feat(holo): add turbulence noise glitter layer to grid card"
```

---

### Task 2: Iridescent font color for `.company-brand` (grid card)

**Files:**
- Modify: `src/lib/components/marketplace/AgentCard.svelte`

The `.company-brand` currently has `color: #18181b`. Replace with a hue-shifting `background-clip: text` gradient driven by `--mx`.

**Step 1: Replace `.company-brand` CSS**

Find:
```css
    .company-brand {
        font-family: "JetBrains Mono NF", monospace;
        font-weight: 800;
        font-size: 16px;
        color: #18181b;
        letter-spacing: 0.05em;
        position: relative;
    }
```
Replace with:
```css
    .company-brand {
        font-family: "JetBrains Mono NF", monospace;
        font-weight: 800;
        font-size: 16px;
        letter-spacing: 0.05em;
        position: relative;
        background: linear-gradient(
            90deg,
            hsl(calc(var(--mx, 0.5) * 200deg + 240deg), 75%, 28%),
            hsl(calc(var(--mx, 0.5) * 200deg + 320deg), 85%, 38%),
            hsl(calc(var(--mx, 0.5) * 200deg + 400deg), 75%, 28%)
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }
```

**Step 2: Update the `.company-brand::after` underline to match**

Find:
```css
    .company-brand::after {
        content: "";
        position: absolute;
        bottom: -2px;
        left: 0;
        width: 100%;
        height: 2px;
        background: linear-gradient(90deg, #e8547a, transparent);
    }
```
Replace with:
```css
    .company-brand::after {
        content: "";
        position: absolute;
        bottom: -2px;
        left: 0;
        width: 100%;
        height: 2px;
        background: linear-gradient(
            90deg,
            hsl(calc(var(--mx, 0.5) * 200deg + 320deg), 85%, 45%),
            transparent
        );
    }
```

**Step 3: Visual check**

Hover over a grid card. The "MINION" text at the bottom should shift from deep violet → pink → coral as you move the pointer right. The underline should follow the same hue. Text should still be legible (dark enough at 28–38% lightness).

If the text is too light to read, reduce the high end from `38%` to `32%`. If it looks too static, ensure `--mx` is changing (check browser devtools custom properties on the `.agent-card-container` element).

**Step 4: Commit**

```bash
git add src/lib/components/marketplace/AgentCard.svelte
git commit -m "feat(holo): iridescent background-clip text on company-brand"
```

---

### Task 3: Apply glitter noise layer to list-card in `+page.svelte`

**Files:**
- Modify: `src/routes/marketplace/agents/+page.svelte`

The list-card already has `.lc-shimmer` and `.lc-glare`. Add `.lc-noise` following the same pattern.

**Step 1: Add `.lc-noise` div to the template**

Find (around line 271–274):
```svelte
                            <div class="list-card">
                                <!-- Holo layers -->
                                <div class="lc-shimmer" aria-hidden="true"></div>
                                <div class="lc-glare" aria-hidden="true"></div>
```
Replace with:
```svelte
                            <div class="list-card">
                                <!-- Holo layers -->
                                <div class="lc-shimmer" aria-hidden="true"></div>
                                <div class="lc-glare" aria-hidden="true"></div>
                                <div class="lc-noise" aria-hidden="true"></div>
```

**Step 2: Add `.lc-noise` CSS after the existing `.lc-glare` active rule**

Find (around line 737):
```css
    :global(.list-item.holo-active) .lc-glare {
        opacity: 0.6;
    }
```
After that rule, add:
```css
    /* Glitter sparkle layer — list card */
    .lc-noise {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        z-index: 3;
        background: linear-gradient(
            calc(var(--mx, 0.5) * 360deg + 90deg),
            hsl(calc(var(--mx, 0.5) * 240deg + 180deg), 80%, 35%),
            hsl(calc(var(--mx, 0.5) * 240deg + 260deg), 80%, 42%),
            hsl(calc(var(--mx, 0.5) * 240deg + 340deg), 80%, 35%)
        );
        -webkit-mask-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 9 -4'/></filter><rect width='100%25' height='100%25' filter='url(%23f)'/></svg>");
        mask-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 9 -4'/></filter><rect width='100%25' height='100%25' filter='url(%23f)'/></svg>");
        -webkit-mask-size: 120px 120px;
        mask-size: 120px 120px;
        -webkit-mask-repeat: repeat;
        mask-repeat: repeat;
        mix-blend-mode: multiply;
        opacity: 0;
        transition: opacity 0.4s ease;
    }

    :global(.list-item.holo-active) .lc-noise {
        opacity: 0.55;
    }
```

Note: `mask-size: 120px` (smaller than grid's 180px) because list cards are smaller — keeps the glitter density proportional.

**Step 3: Raise content z-indices above `.lc-noise` (z-index 3)**

Find the existing content z-index rule:
```css
    /* Ensure list-card content sits above holo overlays */
    .list-badge-clip,
    .list-card-header,
    .list-card-footer {
        position: relative;
        z-index: 3;
    }
```
Replace with:
```css
    /* Ensure list-card content sits above holo overlays */
    .list-badge-clip,
    .list-card-header,
    .list-card-footer {
        position: relative;
        z-index: 4;
    }
```

**Step 4: Visual check**

Switch to list view at `http://localhost:5173/marketplace/agents`. Hover over a list card. Sparkle flecks should appear at the same time as the shimmer and glare.

**Step 5: Commit**

```bash
git add src/routes/marketplace/agents/+page.svelte
git commit -m "feat(holo): add turbulence noise glitter layer to list card"
```

---

### Task 4: Iridescent font color for `.list-brand` (list card)

**Files:**
- Modify: `src/routes/marketplace/agents/+page.svelte`

**Step 1: Replace `.list-brand` CSS**

Find the `.list-brand` rule (around line 751):
```css
    /* Iridescent list-brand text */
    .list-brand {
```

Read the full rule and replace with:
```css
    /* Iridescent list-brand text */
    .list-brand {
        font-family: "JetBrains Mono NF", monospace;
        font-weight: 800;
        font-size: 11px;
        letter-spacing: 0.05em;
        background: linear-gradient(
            90deg,
            hsl(calc(var(--mx, 0.5) * 200deg + 240deg), 75%, 28%),
            hsl(calc(var(--mx, 0.5) * 200deg + 320deg), 85%, 38%),
            hsl(calc(var(--mx, 0.5) * 200deg + 400deg), 75%, 28%)
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }
```

(Keep any existing properties that aren't `color` — add the background/clip properties.)

**Step 2: Type-check**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check 2>&1 | grep -E "error|Error" | head -20
```

Expected: no new errors.

**Step 3: Full visual check — both views**

1. Grid view: hover cards — sparkle flecks + MINION iridescent text ✓
2. List view: hover cards — sparkle flecks + MINION iridescent text ✓
3. Card flip: sparkles should disappear when flipped (already handled by `:not(.flipped)` selectors)

**Step 4: Commit**

```bash
git add src/routes/marketplace/agents/+page.svelte
git commit -m "feat(holo): iridescent brand text on list card"
```

---

### Notes / Tuning Parameters

| Variable | Effect | Default | Range |
|---|---|---|---|
| `baseFrequency` | Glitter fleck size — higher = finer | `0.65` | `0.5` (coarse) → `0.85` (fine) |
| `feColorMatrix 9 -4` | Sparkle density — coefficient controls threshold | `9 -4` | `6 -3` (denser) → `12 -5` (sparser) |
| `mask-size` | Tile repeat size | `180px` (grid), `120px` (list) | Smaller = more flecks visible |
| `opacity` active | Overall sparkle visibility | `0.55` | `0.3` (subtle) → `0.8` (intense) |
| Gradient hue range | Glitter color range | `mx * 240deg` | Wider = more colorful |
