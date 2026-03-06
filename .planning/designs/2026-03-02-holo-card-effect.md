# Holographic ID Card Effect Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a holographic shimmer, 3D tilt, glare, and "MINION" iridescent text effect to the agent marketplace ID cards (both grid view and list view).

**Architecture:** A shared Svelte action (`use:holo`) sets CSS custom properties (`--mx`, `--my`, `--active`) from pointer events. All visual effects (shimmer, glare, tilt, watermark, holo text) are pure CSS driven by those vars — no RAF loop needed. The action is applied to the white card element in both AgentCard (grid) and the list-card in the marketplace agents page.

**Tech Stack:** Svelte 5 actions, CSS custom properties, CSS `conic-gradient`, `mix-blend-mode`, `background-clip: text`

---

### Task 1: Create the `holo` Svelte action

**Files:**
- Create: `src/lib/actions/holo.ts`

**Step 1: Create the action file**

```typescript
// src/lib/actions/holo.ts

/**
 * Svelte action that tracks pointer position on an element and sets CSS vars:
 *   --mx   0→1 (left→right)
 *   --my   0→1 (top→bottom)
 *   --active  0 or 1
 */
export function holo(node: HTMLElement) {
  function onMove(e: PointerEvent) {
    const rect = node.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    node.style.setProperty('--mx', String(Math.max(0, Math.min(1, x))));
    node.style.setProperty('--my', String(Math.max(0, Math.min(1, y))));
  }

  function onEnter() {
    node.style.setProperty('--active', '1');
  }

  function onLeave() {
    node.style.setProperty('--active', '0');
  }

  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerenter', onEnter);
  node.addEventListener('pointerleave', onLeave);

  // Set defaults so CSS vars are always defined
  node.style.setProperty('--mx', '0.5');
  node.style.setProperty('--my', '0.5');
  node.style.setProperty('--active', '0');

  return {
    destroy() {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerenter', onEnter);
      node.removeEventListener('pointerleave', onLeave);
    },
  };
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check 2>&1 | head -20
```

Expected: no errors related to the new file.

**Step 3: Commit**

```bash
git add src/lib/actions/holo.ts
git commit -m "feat(holo): add pointer-tracking Svelte action for holo card effect"
```

---

### Task 2: Apply holo effect to `AgentCard.svelte` (grid view)

**Files:**
- Modify: `src/lib/components/marketplace/AgentCard.svelte`

**Step 1: Import the action in the script block**

After the existing imports, add:
```typescript
import { holo } from '$lib/actions/holo';
```

**Step 2: Apply `use:holo` to the `.id-card` div**

Find:
```svelte
<div class="id-card">
```
Replace with:
```svelte
<div class="id-card" use:holo>
```

**Step 3: Add the shimmer and glare overlay divs inside `.id-card`, before any existing children**

After the opening `<div class="id-card" use:holo>` line, add:
```svelte
  <!-- Holo layers (pointer-driven, CSS-only) -->
  <div class="holo-shimmer" aria-hidden="true"></div>
  <div class="holo-glare" aria-hidden="true"></div>
```

**Step 4: Add all holo CSS to the `<style>` block**

Add this block anywhere in the existing `<style>` section:

```css
/* ── Holographic effect ──────────────────────────────────────── */

/* 3D tilt driven by --mx / --my (±4° per axis, subtle) */
.id-card {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  transform-style: preserve-3d;
  transform:
    perspective(800px)
    rotateX(calc((0.5 - var(--my, 0.5)) * 8deg))
    rotateY(calc((var(--mx, 0.5) - 0.5) * 8deg));
}

/* "MINION" repeated watermark texture */
.id-card::before {
  content: 'MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  ';
  position: absolute;
  inset: 0;
  font-family: 'JetBrains Mono NF', monospace;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.25em;
  line-height: 2;
  color: rgba(0, 0, 0, 0.05);
  overflow: hidden;
  transform: rotate(-30deg) scale(1.6);
  transform-origin: center;
  word-break: break-all;
  pointer-events: none;
  z-index: 0;
  border-radius: inherit;
}

/* Rainbow shimmer layer */
.holo-shimmer {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 1;
  background: conic-gradient(
    from calc(var(--mx, 0.5) * 360deg) at calc(var(--mx, 0.5) * 100%) calc(var(--my, 0.5) * 100%),
    hsl(0,   80%, 60%),
    hsl(60,  80%, 60%),
    hsl(120, 80%, 60%),
    hsl(180, 80%, 60%),
    hsl(240, 80%, 60%),
    hsl(300, 80%, 60%),
    hsl(360, 80%, 60%)
  );
  mix-blend-mode: color-dodge;
  opacity: calc(var(--active, 0) * 0.12);
  transition: opacity 0.4s ease;
}

/* Radial glare following pointer */
.holo-glare {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 2;
  background: radial-gradient(
    ellipse 60% 50% at calc(var(--mx, 0.5) * 100%) calc(var(--my, 0.5) * 100%),
    rgba(255, 255, 255, 0.35),
    transparent 70%
  );
  mix-blend-mode: overlay;
  opacity: calc(var(--active, 0) * 0.6);
  transition: opacity 0.4s ease;
}

/* Iridescent "MINION" brand text */
.company-brand {
  background: linear-gradient(
    90deg,
    hsl(calc(var(--mx, 0) * 200deg + 300deg), 80%, 40%),
    hsl(calc(var(--mx, 0) * 200deg + 360deg), 80%, 50%)
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: calc(var(--active, 0) * transparent);
  background-clip: text;
  /* fallback color via filter trick — only apply gradient when active */
  color: transparent;
  transition: background 0.15s ease;
}
```

Wait — `-webkit-text-fill-color: calc(...)` doesn't work. Use a simpler approach: always apply the gradient text (it looks fine even at rest since the gradient will just be at the center position):

Replace the `.company-brand` CSS block with:

```css
/* Iridescent "MINION" brand text — gradient shifts with pointer */
.company-brand {
  background: linear-gradient(
    90deg,
    hsl(calc(var(--mx, 0.5) * 200deg + 280deg), 75%, 35%),
    hsl(calc(var(--mx, 0.5) * 200deg + 340deg), 80%, 45%),
    hsl(calc(var(--mx, 0.5) * 200deg + 400deg), 75%, 35%)
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Remove the ::after underline since text-fill is transparent */
.company-brand::after {
  background: linear-gradient(
    90deg,
    hsl(calc(var(--mx, 0.5) * 200deg + 280deg), 75%, 50%),
    transparent
  );
}
```

**Step 5: Make sure content layers sit above the holo layers**

The existing children of `.id-card` (`.id-header`, `.photo-container`, etc.) need `position: relative; z-index: 3` so they render above the shimmer/glare. Add to the style block:

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

**Step 6: Visual check**

```bash
bun run dev
```

Open `http://localhost:5173/marketplace/agents` and hover over a grid card. Verify:
- Card tilts slightly as you move the mouse
- A subtle rainbow shimmer appears on the white face
- A soft white glare follows the pointer
- "MINION" text shifts hue with horizontal pointer position
- Moving away smoothly fades the effect

**Step 7: Type-check**

```bash
bun run check 2>&1 | grep -E "error|Error" | head -20
```

**Step 8: Commit**

```bash
git add src/lib/components/marketplace/AgentCard.svelte
git commit -m "feat(holo): apply holographic effect to AgentCard grid view"
```

---

### Task 3: Apply holo effect to list-card in `+page.svelte` (list view)

**Files:**
- Modify: `src/routes/marketplace/agents/+page.svelte`

**Step 1: Import the action in the script block**

After the existing imports, add:
```typescript
import { holo } from '$lib/actions/holo';
```

**Step 2: Apply `use:holo` and add overlay divs to `.list-card`**

Find:
```svelte
<div class="list-card">
    <div class="list-badge-clip">
```

Replace with:
```svelte
<div class="list-card" use:holo>
    <!-- Holo layers -->
    <div class="lc-shimmer" aria-hidden="true"></div>
    <div class="lc-glare" aria-hidden="true"></div>
    <div class="list-badge-clip">
```

**Step 3: Add holo CSS for the list-card**

Inside the existing `<style>` block, add:

```css
/* ── List-card holographic effect ───────────────────────────── */

.list-card {
  transition: transform 0.15s ease;
  transform-style: preserve-3d;
  transform:
    perspective(600px)
    rotateX(calc((0.5 - var(--my, 0.5)) * 8deg))
    rotateY(calc((var(--mx, 0.5) - 0.5) * 8deg));
}

/* "MINION" watermark texture */
.list-card::before {
  content: 'MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  ';
  position: absolute;
  inset: 0;
  font-family: 'JetBrains Mono NF', monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2em;
  line-height: 2;
  color: rgba(0, 0, 0, 0.05);
  overflow: hidden;
  transform: rotate(-30deg) scale(1.8);
  transform-origin: center;
  word-break: break-all;
  pointer-events: none;
  z-index: 0;
  border-radius: inherit;
}

.lc-shimmer {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 1;
  background: conic-gradient(
    from calc(var(--mx, 0.5) * 360deg) at calc(var(--mx, 0.5) * 100%) calc(var(--my, 0.5) * 100%),
    hsl(0,   80%, 60%),
    hsl(60,  80%, 60%),
    hsl(120, 80%, 60%),
    hsl(180, 80%, 60%),
    hsl(240, 80%, 60%),
    hsl(300, 80%, 60%),
    hsl(360, 80%, 60%)
  );
  mix-blend-mode: color-dodge;
  opacity: calc(var(--active, 0) * 0.12);
  transition: opacity 0.4s ease;
}

.lc-glare {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 2;
  background: radial-gradient(
    ellipse 60% 50% at calc(var(--mx, 0.5) * 100%) calc(var(--my, 0.5) * 100%),
    rgba(255, 255, 255, 0.35),
    transparent 70%
  );
  mix-blend-mode: overlay;
  opacity: calc(var(--active, 0) * 0.6);
  transition: opacity 0.4s ease;
}

/* Ensure list-card content layers sit above holo overlays */
.list-badge-clip,
.list-card-header,
.list-photo,
.list-card-footer {
  position: relative;
  z-index: 3;
}

/* Iridescent list-brand text */
.list-brand {
  background: linear-gradient(
    90deg,
    hsl(calc(var(--mx, 0.5) * 200deg + 280deg), 75%, 35%),
    hsl(calc(var(--mx, 0.5) * 200deg + 340deg), 80%, 45%),
    hsl(calc(var(--mx, 0.5) * 200deg + 400deg), 75%, 35%)
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

**Step 4: Visual check — list view**

Switch to list view at `http://localhost:5173/marketplace/agents`, hover over the mini cards. Verify same effects at smaller scale.

**Step 5: Type-check**

```bash
bun run check 2>&1 | grep -E "error|Error" | head -20
```

**Step 6: Commit**

```bash
git add src/routes/marketplace/agents/+page.svelte
git commit -m "feat(holo): apply holographic effect to marketplace list-card"
```

---

### Task 4: Final polish pass

**Files:**
- Possibly: `src/lib/components/marketplace/AgentCard.svelte`
- Possibly: `src/routes/marketplace/agents/+page.svelte`

**Step 1: Check `overflow: hidden` on `.id-card`**

The shimmer layers must not bleed outside the card. The existing `.id-card` has `border-radius: 14px` but no `overflow: hidden`. Add it:

In `AgentCard.svelte` style block, update `.id-card`:
```css
.id-card {
  overflow: hidden;
  /* (keep all existing properties) */
}
```

Same for `.list-card` in `+page.svelte` — it already has no `overflow: hidden`, add it.

**Step 2: Ensure `.id-card` has `position: relative`**

The shimmer/glare/watermark use `position: absolute`. Confirm `.id-card` has `position: relative` (it likely already does from `position: relative` in the existing styles). If not, add it.

**Step 3: Run full test suite**

```bash
bun run test 2>&1 | tail -20
```

Expected: all tests pass (holo is CSS/DOM only, no unit test needed).

**Step 4: Final commit and push to dev**

```bash
git add -p
git commit -m "fix(holo): ensure overflow hidden and position relative on holo cards"
git push origin HEAD
```

---

### Notes

- `calc(var(--active, 0) * 0.12)` — CSS doesn't support this multiplication directly in `opacity`. Use `opacity: 0` + `transition` + toggling a class, OR use `@property` to register `--active` as a `<number>` type. The simplest fix: use a `.holo-active` class toggled by the action and set opacity in CSS rules for that class.
- **If `calc(var(--active) * value)` doesn't work** in the target browsers, replace shimmer/glare `opacity` lines with:
  ```css
  .holo-shimmer { opacity: 0; transition: opacity 0.4s ease; }
  .holo-active .holo-shimmer { opacity: 0.12; }
  .holo-glare { opacity: 0; transition: opacity 0.4s ease; }
  .holo-active .holo-glare { opacity: 0.6; }
  ```
  And update the action to toggle a `holo-active` class on the element's parent instead of setting `--active`.
- The `conic-gradient` approach is well-supported (Chrome 69+, Firefox 83+, Safari 12.1+).
