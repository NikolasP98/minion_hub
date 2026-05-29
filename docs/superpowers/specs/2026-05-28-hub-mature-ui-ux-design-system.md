# Minion Hub — "Mature Software" UI/UX Design System & Roadmap

**Date:** 2026-05-28
**Method:** Multi-agent UX council (2 Explore + 5 specialist `ux-researcher` panel + 1 `product-manager` aggregator) cross-checked against `ui-ux-pro-max` design intelligence.
**North star (user):** sleek, mature, intuitive software — intelligent navigation, buttons that feel alive/smart, prominent contextual toasts/alerts, maximally optimized screen real-estate.

---

## Baseline (verified)

Design-system maturity ≈ **6.8/10**. Solid token foundation (color/radius/shadow in `app.css` `@theme`, 8 themes, 10 accents), good bones (Badge/Spinner/Skeleton primitives, zag-js toasts + `mutate()` helper, global focus ring + cursor rules). Fragmented execution:

- **No** Button/Modal/Card/Input primitives → ~170 hand-rolled buttons, no loading state on action buttons.
- Horizontal **topbar-only** nav, 49 routes / 6 sections, **no breadcrumbs**, no "up one level" on detail pages.
- Inconsistent density; `rounded-[5px]` escape-hatches; **330 raw `rgba()` calls** fragmenting the palette.
- Settings = confusing dual tab-bar (query-param tabs + route tabs mixed) across 12 tabs.
- `bun run check` baseline: **18 errors / 58 warnings** (pre-existing, documented safe).

## Council Consensus (5/5)

1. Persistent **left sidebar + slim topbar** (shell = logo · HostPill · Cmd+K · profile).
2. **Button primitive** with width-preserving `loading` state + `active:scale-[0.97]` press depression.
3. **Severity → surface** rule: transient = toast; persistent state (gateway disconnect) = sticky banner / ambient dot; destructive = modal; form error = inline.
4. **Elevation compound tokens** — white-alpha borders are the primary depth cue in dark UI.
5. **Settings = grouped left-rail** (GATEWAY / HUB / TEAM), search-first, admin-only groups hidden entirely.
6. **Breadcrumbs** on all detail routes (entity-name resolution, non-terminal = links).
7. `mutate()` ack-by-default (silent mutations are the exception).

### Conflicts resolved
- Sidebar **+** per-page-type containers (forms `max-w-2xl`, tables full-width, dashboards 12-col `max-w-screen-2xl`) → net real-estate win.
- Keep 8 themes; promote **Obsidian** as flagship default; collapse CRT/Voxelized/Cyberpunk under "Experimental".
- Auto-save reversible/single-value settings (800ms debounce + inline "Saved"); explicit save for deploy/secrets/YAML.
- Success-checkmark morph only on **Publish**; `scale-[0.97]` press everywhere else. Reject ripple.
- Command Palette: recency/frequency first group **+** search-focused **+** per-page contextual action injection.

---

## Implementation Phases

### Phase 1 — Foundation primitives & tokens ✅ SHIPPED (this pass, local on `dev`)

| Item | Status | File |
|---|---|---|
| Motion tokens (`--duration-instant/fast/normal/slow`, `--ease-standard/out/in/spring`) | ✅ | `src/app.css` `@theme` |
| Elevation compound tokens + `.surface-1..4`, `--hairline`, `.border-hairline`, `.divide-hairline` | ✅ | `src/app.css` |
| Functional type scale `.t-display/heading/title/body/label/caption/mono` | ✅ | `src/app.css` `@layer components` |
| `--shadow-xl` | ✅ | `src/app.css` |
| **Button.svelte** — primary/secondary/ghost/danger/outline × sm/md/lg/icon, loading (width-preserving), press depression, `<a>`/`<button>` polymorphic | ✅ | `src/lib/components/ui/Button.svelte` |
| **Card.svelte** — elevation 1–4, padding, header/footer snippets, interactive hover (presentational; no a11y-trap click wiring) | ✅ | `src/lib/components/ui/Card.svelte` |
| Barrel exports + types | ✅ | `src/lib/components/ui/index.ts` |
| Proof migration: `ConfigSaveBar` Save/Discard → Button (drops hand-rolled spinner + `rounded-[5px]`) | ✅ | `src/lib/components/config/ConfigSaveBar.svelte` |

All new files validated with svelte-autofixer (clean) and add **0** new `bun run check` errors over baseline.

### Phase 2 — Structural

**✅ SHIPPED (this pass, local on `dev`) — navigation chassis:**

| Item | Status | File(s) |
|---|---|---|
| **Sidebar.svelte** — persistent left rail (56px icon / 224px expanded), grouped nav (Workforce/Gateway/Creative/Plugins), reliability + settings, "you-are-here" indicator bar, localStorage collapse, `hidden md:flex` (drawer below md) | ✅ | `src/lib/components/layout/Sidebar.svelte` |
| **Breadcrumbs.svelte** — data-driven from URL, friendly labels + opaque-id truncation, `page.data.breadcrumb` terminal override, back-chevron, shows on depth ≥2 | ✅ | `src/lib/components/layout/Breadcrumbs.svelte` |
| **Topbar slimmed** — removed SectionSwitcher + contextual sub-nav + reliability quicklink + settings gear; added visible **⌘K Search** trigger (`togglePalette`); mobile menu moved to `<md` (clean breakpoint split with sidebar) | ✅ | `src/lib/components/layout/Topbar.svelte` |
| Layout rewired: `<Sidebar>` + column(`<Topbar>` + `<Breadcrumbs>` + page) | ✅ | `src/routes/(app)/+layout.svelte` |

Verified: all autofixer-clean, svelte-check at baseline (18 err / 58 warn, 0 new), `bun run build` ✓ (35s). NOTE: authenticated shell is behind a `/login` wall — **needs the user's session for visual confirmation** (not browser-verifiable here). `SectionSwitcher.svelte` is now orphaned (kept for safety; delete after sign-off).

**Remaining Phase 2:**

| Item | Effort | Impact |
|---|---|---|
| Settings IA → grouped left-rail (GATEWAY / HUB / TEAM) + search; per-item dirty-dot. NOTE: tricky dual routing — gateway tabs = `?s=<id>` buttons, hub tabs = `/settings/<id>` anchors (`SettingsTabBar.svelte`) | M | High |
| `Modal.svelte` (consolidate 8+ bespoke modals; focus-trap; scrim) + `DangerModal` (soft-delete+undo / type-to-confirm) | M | High |
| `Input`/`Field` primitives | M | Med |
| Migrate ~170 hand-rolled buttons → Button (PR-by-PR per route) | M | High |
| Ambient gateway health pill (status + latency + last-event) in topbar | M | High |
| Gateway-disconnect: toast → sticky inline banner | S | Med |
| `oxlint no-restricted-syntax` banning raw `rgba(` outside `app.css`/`presets.ts` | S | Low |

### Phase 3 — Polish & intelligence

| Item | Effort | Impact |
|---|---|---|
| Command Palette: recency store + per-page `registerPageCommands` + entity search + `?` shortcut overlay | M | Med |
| Per-page-type container audit (kill global `max-w-3xl`) | M | Med |
| Shape-matched skeleton loaders (sessions, agents, marketplace) | M | Low |
| Density toggle (`body[data-density="compact"]`) | S | Low |
| Promote Obsidian flagship + "Experimental" theme group | S | Med |
| First-login `/home` orienting surface (collapsing onboarding checklist) | M | Med |
| Copy-to-clipboard on every identifier; persistent splitter state everywhere | S | Med |

## Rejected
Storybook (cost>value now) · `@minion-stack/ui` package (premature) · monolithic theme presets (axis lock-in) · single global save model · per-component focus/cursor CSS · onboarding coach-marks · ripple · modal-first CRUD · toast-on-every-mutation.

## Usage notes for the new primitives

```svelte
<script>
  import { Button, Card } from '$lib/components/ui';
</script>

<Button variant="primary" size="md" loading={saving} onclick={save}>Save changes</Button>
<Button variant="danger" size="sm" onclick={remove}>Delete</Button>
<Button variant="ghost" size="icon" aria-label="Settings">{#snippet icon()}<Cog size={16}/>{/snippet}</Button>

<Card elevation={2} padding="md">…</Card>            <!-- replaces bg-bg3 border border-border rounded-lg -->
<Card elevation={3} interactive>{#snippet header()}<h3 class="t-title">Title</h3>{/snippet}…</Card>
```

Prefer `.surface-1..4` over `bg-bg3 border border-border`; `.t-*` over ad-hoc `text-[11px] font-semibold uppercase`; `--ease-standard`/`--duration-fast` over magic-number timings.
