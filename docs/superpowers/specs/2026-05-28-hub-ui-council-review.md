# Minion Hub — UI/UX + Art-Director Council Review

**Date:** 2026-05-28
**Method:** `hub-ui-director-council` workflow — 5 design directors (Macro IA/Navigation, Art/Visual System, Interaction/Micro, DX/Design-System, Accessibility & Content) reviewed the live code in parallel, grounded in real files; a Creative Director synthesized. 40 findings → ranked roadmap.
**Full findings JSON:** workflow run `wf_f4f65957-670` output.

## Verdict

> Minion Hub has a genuinely mature design-system *foundation* — the `@theme` elevation/motion/type tokens and the Button/Card/Modal primitives are well-conceived and correctly token-driven. But the system is **almost entirely unadopted**, and that gap between the designed system and the lived product is the single biggest "cheap software" tell: **804** hand-rolled `border-border` vs **3** `surface-N` uses, **12** `.t-*` uses, **512** bare buttons, **50** OS-default `<select>`, and a live token-mismatch bug that renders the dashboard's most important numbers **colorless**. The fastest path to "mature, sleek" is not more building — it's a tight sequence of cheap correctness fixes, then a lint guardrail so sweeps stop being re-polluted, then the PageHeader that standardizes 22 divergent headers and unlocks the elegant scroll-under-island behavior.

## Consensus (multiple directors independently)

1. **Adoption gap is the core problem, not the tokens** — shipped system barely used (Art, DX, Interaction).
2. **A unified PageHeader is the highest-leverage structural fix** — standardizes 22+ headers AND is the prerequisite to removing the 56px island-overlap hack (Macro, Mid, DX).
3. **brand-pink (#e8547a, 104 uses) vs --color-accent has no written rule** — used interchangeably for CTAs (Art, DX). Resolution: pink = identity-only.
4. **Status/semantic color fragmented** (raw `red-500`/`emerald-300` vs tokens) + **dead tokens** (`--red`/`--green`/`--text3`/`--accent`) render key numbers colorless (Art, A11y).
5. **No automated guardrail** (only prettier + svelte-check) → every sweep re-polluted by the next PR (DX, root cause).
6. **Empty/loading/error states hand-rolled and dead-ended** (no recovery CTA) (Interaction, A11y).
7. **Two parallel product surfaces** (Workforce control-plane vs Gateway dashboard) as coequal siblings with no mode model + orphaned routes (Macro, deepest concern).

## Quick wins (do first — S-effort, high-impact)

- **Dead tokens:** `DashboardMetrics.svelte` `--red`/`--green` + `KpiCard.svelte` `--accent`/`--red`/`--green`/`--text3` don't exist → error-rate/uptime bars + every trend arrow render colorless. Map to `--color-destructive`/`--color-success`/`--color-accent`/`--color-muted-foreground`.
- **`--color-border: var(--hairline)`** — one edit makes 804 `border-border` uses inherit the white-alpha depth cue. Highest ROI single line.
- **Toast overhaul** — `.surface-3/4` + `radius-lg` + `shadow-lg` (not hardcoded 6px/rgba); add `[data-state]` slide+fade motion; tint error/warning surface; offset group below the island.
- **brand-pink rule** written in `presets.ts`/`app.css`; reclassify pink-as-accent uses.
- **`.t-label` codemod** of the repeated uppercase-label class stack; add `tabular-nums` to `.t-display`.

## Ranked roadmap

| # | Initiative | Alt | Effort | Impact |
|---|---|---|---|---|
| 1 | Fix dead design tokens (dashboard + reliability KPIs) | micro | S | high |
| 2 | Alias `--color-border` → `--hairline` (instant depth-cue propagation) | dx | S | high |
| 3 | Overhaul Toast layer (elevation + motion + severity + reposition) | micro | S | high |
| 4 | Lint guardrails (`@minion-stack/lint-config` + ban raw rgba/hex + bare `<button>`/`<select>`) | dx | M | high |
| 5 | Ship `PageHeader` primitive; retire the 56px island hack (scroll-under) | mid | L | high |
| 6 | Add `Select`, `Toggle`, `Tabs` primitives; consolidate reimplementations | dx | M | high |
| 7 | Adopt elevation + type scale in 5 highest-traffic surfaces | mid | M | high |
| 8 | Standardize `EmptyState` + loading skeletons with recovery actions | mid | M | medium |
| 9 | Route status colors through semantic tokens + Badge | mid | M | medium |
| 10 | Make command palette route-aware (generated, not hardcoded) | mid | M | medium |
| 11 | Route-metadata registry feeding sidebar/breadcrumbs/palette | dx | M | medium |
| 12 | Resolve two-surface IA: mode switcher + scoped Workforce sub-nav + dedup concepts | macro | L | high |
| 13 | A11y hardening: contrast tokens, aria in button sweep, keyboard flow-editor, kill "Phase 6" leaks | macro | L | medium |

## Notable individual findings (beyond the roadmap)

- **Toaster vs DynamicIsland** fight for the top-right corner (occlusion) → offset toasts below the island.
- **Opacity-suffixed muted text** (`text-muted-foreground/50`, `placeholder:text-muted/40`) computes ~2:1 — fails WCAG AA; stop encoding contrast as opacity, add `--color-muted-strong`.
- **Settings three-axis nav** (route tabs + `?s=` scrollspy) splits one mental space — normalize on routes.
- **CornerAccent** decoration orphaned (4 uses) — promote to a Card prop or drop.
- **`hover:shadow-[…var(--color-accent)]/10`** opacity modifier on arbitrary box-shadow is fragile — use Card's sanctioned hover or a real glow token.

## Execution status (this session)

**Quick wins SHIPPED:** see commits following this review. Remaining roadmap items 4–13 sequenced for subsequent passes; #5 (PageHeader) is the keystone that unblocks the scroll-under-island elegance and should precede the IA rework (#12).
