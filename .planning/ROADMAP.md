# Roadmap: Minion Hub

## Milestones

- [x] **v1.0 Settings Page Revamp** - Phases 1-4 (Phase 1 shipped 2026-03-12; Phases 2-4 paused)
- [ ] **v2.0 Skill Builder Improvements** - Phases 5-13 (in progress)

## Phases

<details>
<summary>v1.0 Settings Page Revamp (Phases 1-4) — Phase 1 shipped 2026-03-12; Phases 2-4 deferred to v3.0</summary>

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
**Plans:** 3/3 plans complete

Plans:
- [x] 01-01-PLAN.md — Tab reorganization: merge Channels into Comms, 8-tab layout, dirty tab dots, default tab Hosts, test updates
- [x] 01-02-PLAN.md — Save/restart hardening: restart toast migration, NavigationGuardModal, disconnect banner, auto-save on reconnect, ConfigSaveBar simplification
- [x] 01-03-PLAN.md — Gap closure: fix unreachable disconnect banner (PLSH-03 blocker), remove duplicate ALL_TABS (DRY)

### Phase 2: Cards and Field Widgets
**Goal**: Each config domain renders as a visually distinct card with smart input widgets, inline help, validation feedback, and per-card dirty tracking
**Depends on**: Phase 1
**Requirements**: LAYOUT-02, LAYOUT-03, FIELD-01, FIELD-02, FIELD-03, FIELD-04, FIELD-05, FIELD-06, SAVE-01, SAVE-04, INTG-03, PLSH-02, PLSH-04
**Success Criteria** (what must be TRUE):
  1. Each config domain appears as a distinct card with header, description, and grouped fields — booleans render as toggles, enums as dropdowns, arrays as tag inputs, numeric ranges as sliders, and colors as color pickers
  2. Fields show inline descriptions and help text from the schema, a visual mark when differing from default, and a reset-to-default action on hover
  3. Fields that trigger gateway restart show an amber warning badge; destructive settings have red danger zone treatment with explicit confirmation
  4. Cards show a dirty indicator dot on the header when containing unsaved changes; cards with validation errors auto-expand on save failure
  5. User can toggle "show modified only" to filter to fields differing from defaults, and can collapse/expand advanced fields within cards
**Plans**: Deferred to v3.0

### Phase 3: Discovery and Overrides
**Goal**: Administrators can find any setting instantly via search, see validation issues at a glance, preview changes before saving, and get polished custom UIs for high-value config sections
**Depends on**: Phase 2
**Requirements**: DISC-01, DISC-02, DISC-03, INTG-04, INTG-05
**Success Criteria** (what must be TRUE):
  1. User can type in a global search box and see fuzzy-matched results across all field labels, descriptions, keys, and values — clicking a result navigates to the containing tab and card
  2. Gateway validation issues and warnings appear as a persistent banner with count badges on affected sections; clicking an issue navigates to the offending field
  3. Before saving, user can expand a diff panel showing a summary of all pending changes
  4. Appearance settings (theme, patterns, sparkline style, locale) are accessible as a tab alongside gateway config, fully functional
**Plans**: Deferred to v3.0

### Phase 4: Setup Wizard
**Goal**: Administrators can launch a guided, step-by-step configuration wizard at any time to walk through essential settings
**Depends on**: Phase 2
**Requirements**: WIZ-01, WIZ-02, WIZ-03, WIZ-04, WIZ-05
**Success Criteria** (what must be TRUE):
  1. User can click a button on the settings page to launch the setup wizard at any time (not just first-run)
  2. Wizard walks through essential configuration in logical steps (API keys/auth, model selection, primary channel, agent basics) with a progress indicator showing completed/current/remaining steps
  3. Wizard uses the same field widgets as the card-based settings (toggles, dropdowns, etc.) and pre-fills from current config
  4. Changes made in the wizard write to the same config state as manual edits — on wizard completion, the save bar reflects all wizard changes as pending
**Plans**: Deferred to v3.0

</details>

---

### v2.0 Skill Builder Improvements (In Progress)

**Milestone Goal:** Harden the visual skill builder — fix critical code bugs, improve validation UX, strengthen error handling, enhance AI generation quality, add data flow visualization, cost tracking, and skill versioning.

## Phase Details

### Phase 5: State Architecture Refactor
**Goal**: Skill editor business logic lives in a dedicated state module, making every subsequent improvement safe to add without compounding the god-component
**Depends on**: Phase 4 (v1.0 context)
**Requirements**: ARCH-01, ARCH-02
**Success Criteria** (what must be TRUE):
  1. The skill editor page loads and functions identically before and after the refactor — no visible regression to the user
  2. Chapters, edges, chapterToolMap, dirty tracking, and AI generation state are owned by `src/lib/state/builder/skill-editor.svelte.ts`, not inline in `+page.svelte`
  3. The `+page.svelte` file is reduced to template markup and lifecycle orchestration with no inline business logic variables
  4. The saveTimer cleanup and existing `$effect` patterns are consolidated in the state module, with no lifecycle leaks on page navigation
**Plans**: TBD

### Phase 6: Critical Code Fixes
**Goal**: The skill builder produces correct AI output, performs efficient database operations, and handles edge cases that currently cause silent bugs or incorrect behavior
**Depends on**: Phase 5
**Requirements**: CFIX-01, CFIX-02, CFIX-03, CFIX-04, CFIX-05, CFIX-06, CFIX-07, CFIX-08, CFIX-09, CFIX-10
**Success Criteria** (what must be TRUE):
  1. AI-generated skills never contain cyclic edges, and the few-shot examples in the prompt schema cannot produce cycles
  2. Server-side tool filtering rejects tool IDs not in the available pool and reports the filtered list in the API response — invalid tools never reach the database
  3. Publish validation executes as a single batch query regardless of chapter count — no N+1 SELECT loop
  4. User inputs in AI prompts are wrapped in XML delimiters and cannot break out of their expected prompt context
  5. AI API endpoints return a `usage` object (prompt_tokens, completion_tokens, cost) in every response — usage data is no longer silently discarded
**Plans**: TBD

### Phase 7: Validation UX
**Goal**: Skill authors see exactly which chapters have errors, why publish is blocked, and can navigate directly to any broken chapter from the error panel
**Depends on**: Phase 5
**Requirements**: VALID-01, VALID-02, VALID-03, VALID-04, VALID-05, A11Y-01
**Success Criteria** (what must be TRUE):
  1. The publish button is visually disabled with an explanatory tooltip when any validation errors exist — clicking it has no effect
  2. Validation errors appear as a structured panel listing each chapter by name with its specific error messages and a "Fix" button that opens that chapter's editor
  3. Client-side validation catches condition nodes missing conditionText and chapters with no assigned tools, consistent with server-side rules via a shared validation module
  4. When publishing with warnings but no errors, a modal appears automatically showing the warnings with a "Publish Anyway" option
  5. All modals have `role="dialog"` on the modal element with `aria-labelledby` pointing to the modal title
**Plans**: TBD

### Phase 8: Error Handling
**Goal**: All mutations surface failures to the user, recover gracefully without data loss, and AI requests cannot hang indefinitely
**Depends on**: Phase 5
**Requirements**: ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, EDGE-01, EDGE-02
**Success Criteria** (what must be TRUE):
  1. The chapter editor modal remains open on save error and shows the error inline — the user is not silently returned to the canvas with lost changes
  2. All mutation functions (addChapter, removeChapter, updateCondition, deleteEdge, connectChapters) roll back local state on failure and show the error to the user
  3. AI generation requests abort after 60 seconds and display "Request timed out" — no request can hang the UI indefinitely
  4. Building a skill with existing chapters prompts the user to choose "Replace" or "Append" before any chapters are overwritten
  5. The tool pool is automatically refreshed when the gateway reconnects, so the chapter editor never shows stale or empty tool options
**Plans**: TBD

### Phase 9: AI Quality and Tool Manifest
**Goal**: AI-generated chapters are grounded in the current skill context, proposed changes can be reviewed before being committed, and tool selection is guided by rich metadata
**Depends on**: Phase 6
**Requirements**: AIQL-01, AIQL-02, AIQL-03, AIQL-04, EDGE-03
**Success Criteria** (what must be TRUE):
  1. Every tool in the manifest has a category, longDescription, and useWhen field, and the chapter editor groups tools by category
  2. Tool cards in the chapter editor expand on click to show longDescription and useWhen, with only one card expanded at a time
  3. AI-generated chapters appear in a preview modal before any database write — the user can accept or cancel, and the preview shows warnings for filtered tools or detected cycles
  4. Chapter suggestions are sent the names and outputDefs of existing chapters, so generated content references the current DAG context
  5. AI-generated chapter positions are normalized in the preview to prevent node overlap before the user confirms import
**Plans**: TBD

### Phase 10: Data Flow Visualization
**Goal**: Skill authors can see how data flows between chapters on the canvas and understand what inputs each chapter receives from its predecessors
**Depends on**: Phase 5
**Requirements**: DFLOW-01, DFLOW-02, DFLOW-03, A11Y-02, A11Y-03
**Success Criteria** (what must be TRUE):
  1. The chapter editor shows a read-only upstream context panel listing predecessor chapters' names and output definitions
  2. Root chapters (no incoming edges) display an "Initial Input Source" selector with options: user message, agent context, or no input needed
  3. The DAG canvas has a toggle that shows the source chapter's outputDef (truncated to 60 characters) as a label mid-edge
  4. DAG nodes can be activated with the Enter key when focused, opening the chapter editor without requiring a mouse click
  5. The context menu (right-click) traps focus within the menu while open and returns focus to the triggering element on close
**Plans**: TBD

### Phase 11: Cost Tracking
**Goal**: Skill authors see how many tokens each AI generation consumed and what it cost, immediately after generation completes
**Depends on**: Phase 6
**Requirements**: COST-01, COST-02
**Success Criteria** (what must be TRUE):
  1. After any AI generation (skill or chapter), the builder toolbar shows the token count and estimated cost inline (e.g., "1,847 tokens (~$0.005)")
  2. A token budget selector in the toolbar offers preset limits (10k, 25k, 50k, 100k, unlimited) that persist in state across the session
**Plans**: TBD

### Phase 12: Versioning
**Goal**: Skill authors can publish named versions with changelogs and restore any previous version as a new draft, with the database guaranteeing snapshot integrity
**Depends on**: Phase 7
**Requirements**: VERS-01, VERS-02, VERS-03, VERS-04, VERS-05, VERS-06, VERS-07
**Success Criteria** (what must be TRUE):
  1. The database schema includes a `builtSkillVersions` table and the additional `outputSchema`, `temperature`, and `versionId` columns — schema migrations run cleanly against both local SQLite and production Turso
  2. Clicking publish opens a changelog modal prompting "What changed in this version?" before the version is committed
  3. Publishing creates a complete version snapshot as an atomic database transaction — a failed publish never leaves a partial snapshot
  4. The version history panel lists all published versions with their number, date, changelog, and a "Restore" button; restoring creates a new draft without overwriting the version record
  5. A skill shows a "modified since last publish" indicator whenever meaningful fields change after the most recent published version
**Plans**: TBD

### Phase 13: Advanced Features (Placeholder — Blocked on Gateway Runtime)
**Goal**: Placeholder phase tracking runtime-dependent features until the gateway skill execution engine is built
**Depends on**: Phase 12, Gateway runtime (external blocker)
**Requirements**: ADV-01, ADV-02, ADV-03
**Success Criteria** (what must be TRUE):
  1. A dry-run test panel is accessible from the builder with an input textarea and per-chapter pass/fail results with timing
  2. DAG nodes show green/red/orange status overlays reflecting the most recent dry-run result
  3. An approval node type is available in the chapter type selector with dashed purple border, user icon, timeout config, and notification settings
**Plans**: Blocked — awaiting gateway skill runtime

## Progress

**Execution Order:**
Phases execute in numeric order: 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Tab Layout and Save Infrastructure | v1.0 | 3/3 | Complete | 2026-03-12 |
| 2. Cards and Field Widgets | v1.0 | 0/0 | Deferred | - |
| 3. Discovery and Overrides | v1.0 | 0/0 | Deferred | - |
| 4. Setup Wizard | v1.0 | 0/0 | Deferred | - |
| 5. State Architecture Refactor | v2.0 | 0/TBD | Not started | - |
| 6. Critical Code Fixes | v2.0 | 0/TBD | Not started | - |
| 7. Validation UX | v2.0 | 0/TBD | Not started | - |
| 8. Error Handling | v2.0 | 0/TBD | Not started | - |
| 9. AI Quality and Tool Manifest | v2.0 | 0/TBD | Not started | - |
| 10. Data Flow Visualization | v2.0 | 0/TBD | Not started | - |
| 11. Cost Tracking | v2.0 | 0/TBD | Not started | - |
| 12. Versioning | v2.0 | 0/TBD | Not started | - |
| 13. Advanced Features (Placeholder) | v2.0 | 0/TBD | Blocked | - |
