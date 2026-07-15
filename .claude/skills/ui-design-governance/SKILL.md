---
name: ui-design-governance
description: Use when creating, editing, reviewing, or styling any UI in this repo — .svelte files with markup or styles, components, routes, themes, CSS, icons, charts — or when adding colors, spacing, radii, shadows, z-index, animation, typography, a new component, or a design-lint exception.
---

# UI Design Governance (Hub mirror)

**Canonical skill: `../.claude/skills/ui-design-governance/SKILL.md`** (meta-repo root, one level above this repo). Read it if reachable — it has the full token/primitive tables. The iron rules below stand alone.

## Iron rules

1. **Semantic tokens only** in `.svelte`: no literal hex/rgb, no Tailwind palette utilities (`bg-slate-500`), no arbitrary sizes (`text-[16px]`), no raw shadows/durations/easings, no numeric z-index (`--layer-*` instead). Raw colors are legal only in `app.css` + `themes/*.ts`.
2. **⛔ Forbidden names (hard-fail):** `--accent`, `--accent-bg`, `--accent-rgb`, `--color-background`, `--color-bg1`, `--color-error`, `--color-primary`, `--color-primary-foreground`.
3. **Reuse primitives:** `Button` (never bare `<button>`), themed Select (never native `<select>`), `EmptyState`, `Spinner`/`Skeleton`, `Tooltip`, `FormField`, `StatusDot` (ui copy), `DataTable`, `PageHeader`, Zag wrappers. Hand-rolled copies are ratcheted debt.
4. **Theme = `data-theme` presets only.** Tailwind `dark:` variants are dead code here. Components read tokens; themes swap values.
5. **Never hand-edit `tokens.css`** — it is generated from `@minion-stack/design-tokens` `contract.json`.
6. **Layout contracts** (violations shipped 7 bugs, 2026-07-15): one scroll owner per screen — content pane owns scroll, section nav never scrolls away; the `(app)/+layout.svelte` fade-wrapper must stay `flex flex-col` (shells below rely on `flex:1` for height); page roots inside `SectionShell` need `flex-1 min-w-0` (or use `PageShell`) — bare `h-full` roots shrink to content width and trip EditableGrid into one column; `Button` slots children into an inner `inline-flex` row span consumer classes can't reach — override via scoped ancestor `:global(.x > span)` (POS sell `.card`, appearance `.theme-card`); Svelte scoped rules for component children need a real scoped ANCESTOR anchor — `.a :global(.b)` never matches a sibling (ShiftBanner `.mini-rail`).
7. **Gates after every UI change:**
   ```bash
   bun run lint:design && bun run lint:tokens
   ```
   Changed-file debt may only DECREASE (CI-enforced). Exceptions: `scripts/design-lint-exceptions.json`, exact file+rule+numeric cap+category+reason. Runtime-authored vars: register in `scripts/token-integrity.mjs` maps.

Details, full token vocabulary, spec references: canonical skill above + `scripts/DESIGN-LINT.md` + meta-repo spec `specs/2026-07-13-hub-ui-coherence-implementation-spec.md` §D2.
