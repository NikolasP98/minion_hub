# Settings Page Revamp

## What This Is

A complete redesign of the Minion Hub settings page (`/settings`), transforming the current flat JSON-dump rendering into a polished, card-based configuration experience with tabbed navigation, rich field descriptions, smarter input widgets, and a re-runnable setup wizard. The audience is gateway administrators who need to configure AI agents, models, channels, auth, and system behavior.

## Core Value

Settings must be discoverable, understandable, and safe to change — administrators should confidently find, understand, and modify any configuration without fear of breaking things.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Card-based layout with grouped fields inside visually distinct cards per config domain
- [ ] Top-level tabbed navigation replacing the sidebar (AI, Agents, Comms, Security, System, etc.)
- [ ] Rich field descriptions, help text, and consequences shown inline
- [ ] Smarter input widgets: toggles for booleans, dropdowns for enums, tag inputs for arrays, sliders for numeric ranges, color pickers where appropriate
- [ ] Hybrid schema rendering: gateway JSON Schema + UI hints provide structure, frontend adds custom overrides for priority sections (Agents, AI/Models, Auth/Security)
- [ ] Re-runnable setup wizard accessible via button — walks through essential configuration in a guided step-by-step flow
- [ ] Global save with dirty tracking (current merge-patch approach preserved)
- [ ] Per-card dirty indicators showing which sections have unsaved changes
- [ ] Collapsible advanced fields within cards (basic fields shown by default)
- [ ] Appearance settings (theme, patterns, sparkline style, locale) integrated as a tab alongside gateway config
- [ ] Settings properly reflect on the host after edits — confirm via config.patch WS response
- [ ] Responsive and visually polished — consistent with existing Minion Hub theming and CSS variable system

### Out of Scope

- Per-field auto-save — keeping global save UX
- Agent definitions editing (handled in agent detail page)
- Config file raw/JSON editor mode — may revisit later
- Multi-gateway simultaneous editing

## Context

**Current state:** The settings page is a schema-driven form that dynamically renders fields from `config.schema` (JSON Schema Draft-07 + UI hints). It works but is visually flat — all fields render with similar weight, minimal descriptions, and generic inputs. The sidebar navigation groups sections into meta-categories (config-ai, config-comms, etc.) but the content area doesn't leverage visual hierarchy.

**Existing infrastructure:**
- `config.svelte.ts` — state management for config load/save/dirty tracking
- `config-schema.ts` — utility for group extraction, field type resolution, patch computation
- `ConfigSection.svelte`, `ConfigField.svelte` — current rendering components
- Gateway protocol: `config.get`, `config.schema`, `config.patch` over WebSocket
- Settings persisted in SQLite via `settings.service.ts` (server-side cache)
- Theme system: CSS variables, presets in `src/lib/themes/presets.ts`

**Key files:**
- `src/routes/settings/+page.svelte` — main settings page (24KB, needs major restructure)
- `src/lib/components/settings/` — settings components directory
- `src/lib/state/config.svelte.ts` — config state management
- `src/lib/utils/config-schema.ts` — schema processing utilities
- `src/lib/types/config.ts` — config type definitions

**Backend config schema:** Defined in openclaw at `src/config/types.minion.ts` with ~30 top-level sections (auth, agents, models, channels, broadcast, audio, messages, commands, approvals, session, web, cron, hooks, discovery, gateway, memory, security, etc.)

## Constraints

- **Tech stack**: SvelteKit + Svelte 5 runes, existing CSS variable theming system
- **Protocol**: Must use existing `config.get`/`config.schema`/`config.patch` WebSocket protocol — no backend changes
- **Schema-driven**: Must remain compatible with dynamic schema rendering for unknown/new config sections
- **Backward compatible**: Existing config state management (`config.svelte.ts`) and dirty tracking should be preserved/extended, not rewritten

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tabbed navigation over sidebar | Reduces cognitive load, better for scanning categories at a glance | — Pending |
| Card-based sections within tabs | Visual grouping with clear boundaries between config domains | — Pending |
| Hybrid schema + frontend overrides | Best of both worlds — dynamic for unknown fields, polished for priority sections | — Pending |
| Re-runnable wizard (not onboarding-only) | More useful as a tool than a one-time flow — users reconfigure regularly | — Pending |
| Global save preserved | Familiar UX, merge-patch is already robust, avoids partial-save complexity | — Pending |

---
*Last updated: 2026-03-05 after initialization*
