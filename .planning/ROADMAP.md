# Roadmap: Settings Page Revamp

## Overview

Transform the settings page from a flat JSON-dump renderer into a polished, card-based configuration experience. The build order follows a strict dependency chain: tab infrastructure and save hardening first (everything mounts inside tabs), then card layout and enhanced field widgets (the core rendering layer), then discovery features and custom overrides (which need cards and widgets to exist), and finally the setup wizard (which reuses all of the above). Four phases, each delivering a coherent, verifiable capability.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Tab Layout and Save Infrastructure** - Replace sidebar with tabbed navigation, harden save/restart UX, establish foundation for all subsequent phases
- [ ] **Phase 2: Cards and Field Widgets** - Card-based grouping with enhanced input widgets, inline validation, dirty indicators, and hybrid schema rendering
- [ ] **Phase 3: Discovery and Overrides** - Global search/filter, validation issues panel, config diff preview, appearance tab, and custom override components for priority sections
- [ ] **Phase 4: Setup Wizard** - Re-runnable guided configuration wizard reusing card/field components

## Phase Details

### Phase 1: Tab Layout and Save Infrastructure
**Goal**: Administrators can navigate settings via tabs with reliable save behavior, restart recovery, and no state loss during navigation
**Depends on**: Nothing (first phase)
**Requirements**: LAYOUT-01, LAYOUT-04, LAYOUT-05, SAVE-02, SAVE-03, INTG-01, INTG-02, PLSH-01, PLSH-03
**Success Criteria** (what must be TRUE):
  1. User sees top-level tabs (AI, Agents, Comms, Security, System, Appearance) and can switch between them without losing scroll position or input state
  2. User sees loading skeletons while config loads, and the page matches existing Minion Hub theming
  3. User is warned before navigating away with unsaved changes (both browser close and in-app navigation), and can save via Ctrl/Cmd+S
  4. After saving a config change that triggers gateway restart, user sees a clear "restarting" indicator and the connection auto-recovers without manual intervention
  5. Config changes are confirmed as applied on the gateway via the config.patch WebSocket response
**Plans:** 2 plans

Plans:
- [ ] 01-01-PLAN.md — Tab infrastructure: TAB_MAPPING, tab bar component, CSS visibility panels, skeleton loading, settings page rewrite
- [ ] 01-02-PLAN.md — Save/restart hardening: restart state machine, navigation guards, Ctrl+S, scrollspy with IntersectionObserver

### Phase 2: Cards and Field Widgets
**Goal**: Each config domain renders as a visually distinct card with smart input widgets, inline help, validation feedback, and per-card dirty tracking
**Depends on**: Phase 1
**Requirements**: LAYOUT-02, LAYOUT-03, FIELD-01, FIELD-02, FIELD-03, FIELD-04, FIELD-05, FIELD-06, SAVE-01, SAVE-04, INTG-03, PLSH-02, PLSH-04
**Success Criteria** (what must be TRUE):
  1. Each config domain appears as a distinct card with header, description, and grouped fields -- booleans render as toggles, enums as dropdowns, arrays as tag inputs, numeric ranges as sliders, and colors as color pickers
  2. Fields show inline descriptions and help text from the schema, a visual mark when differing from default, and a reset-to-default action on hover
  3. Fields that trigger gateway restart show an amber warning badge; destructive settings have red danger zone treatment with explicit confirmation
  4. Cards show a dirty indicator dot on the header when containing unsaved changes; cards with validation errors auto-expand on save failure
  5. User can toggle "show modified only" to filter to fields differing from defaults, and can collapse/expand advanced fields within cards
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD
- [ ] 02-03: TBD

### Phase 3: Discovery and Overrides
**Goal**: Administrators can find any setting instantly via search, see validation issues at a glance, preview changes before saving, and get polished custom UIs for high-value config sections
**Depends on**: Phase 2
**Requirements**: DISC-01, DISC-02, DISC-03, INTG-04, INTG-05
**Success Criteria** (what must be TRUE):
  1. User can type in a global search box and see fuzzy-matched results across all field labels, descriptions, keys, and values -- clicking a result navigates to the containing tab and card
  2. Gateway validation issues and warnings appear as a persistent banner with count badges on affected sections; clicking an issue navigates to the offending field
  3. Before saving, user can expand a diff panel showing a summary of all pending changes
  4. Appearance settings (theme, patterns, sparkline style, locale) are accessible as a tab alongside gateway config, fully functional
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Setup Wizard
**Goal**: Administrators can launch a guided, step-by-step configuration wizard at any time to walk through essential settings
**Depends on**: Phase 2
**Requirements**: WIZ-01, WIZ-02, WIZ-03, WIZ-04, WIZ-05
**Success Criteria** (what must be TRUE):
  1. User can click a button on the settings page to launch the setup wizard at any time (not just first-run)
  2. Wizard walks through essential configuration in logical steps (API keys/auth, model selection, primary channel, agent basics) with a progress indicator showing completed/current/remaining steps
  3. Wizard uses the same field widgets as the card-based settings (toggles, dropdowns, etc.) and pre-fills from current config
  4. Changes made in the wizard write to the same config state as manual edits -- on wizard completion, the save bar reflects all wizard changes as pending
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Tab Layout and Save Infrastructure | 0/2 | Planning complete | - |
| 2. Cards and Field Widgets | 0/3 | Not started | - |
| 3. Discovery and Overrides | 0/2 | Not started | - |
| 4. Setup Wizard | 0/1 | Not started | - |
