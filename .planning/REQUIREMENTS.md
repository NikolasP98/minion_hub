# Requirements: Skill Builder Improvements

**Defined:** 2026-03-18
**Core Value:** Skill authors can confidently create, validate, and version AI agent skills through a reliable, informative builder interface.

## v2.0 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### State Architecture

- [ ] **ARCH-01**: Skill editor state (chapters, edges, tools, dirty tracking, AI generation) is extracted from +page.svelte into a dedicated .svelte.ts state module
- [ ] **ARCH-02**: +page.svelte is reduced to template + lifecycle orchestration, delegating business logic to the state module

### Critical Code Fixes

- [ ] **CFIX-01**: AI skill generation does not produce cyclic edges in few-shot examples
- [ ] **CFIX-02**: AI skill generation allows null edge labels in the schema definition
- [ ] **CFIX-03**: AI-generated tool IDs are filtered server-side against available tools, with filtered tools reported in the response
- [ ] **CFIX-04**: Publish validation uses a single batch query instead of per-chapter N+1 SELECT loop
- [ ] **CFIX-05**: AI endpoints check completion.error before attempting fallback parse, with console.warn on fallback path
- [ ] **CFIX-06**: Publish flow aborts if prior save failed (dirty check after saveSkill)
- [ ] **CFIX-07**: User inputs in AI prompts are wrapped in XML tag delimiters for injection safety
- [ ] **CFIX-08**: Disconnected-node validation uses BFS from root to verify single connected component
- [ ] **CFIX-09**: setChapterTools and setAgentBuiltSkills use batch inserts instead of sequential loops
- [ ] **CFIX-10**: AI endpoints return usage object (prompt_tokens, completion_tokens, cost) in response

### Validation UX

- [ ] **VALID-01**: Publish button is disabled when validation errors exist, with tooltip explaining why
- [ ] **VALID-02**: Publish errors display as a structured panel with per-chapter messages and "Fix" buttons that navigate to the chapter editor
- [ ] **VALID-03**: Client-side validation includes condition nodes missing conditionText and per-chapter tool assignment checks
- [ ] **VALID-04**: A shared pure validation function in $lib/utils/ is used by both client-side $derived and server-side validateSkillForPublish
- [ ] **VALID-05**: When publish is clicked with warnings but no errors, the validation modal auto-opens with a "Publish Anyway" button

### Error Handling

- [ ] **ERR-01**: Chapter editor modal stays open on save error, showing error state inside the modal
- [ ] **ERR-02**: All mutation functions (updateCondition, saveCondition, addChapter, removeChapter, deleteEdge, connectChapters) are wrapped in try/catch with error surfacing and local state rollback on failure
- [ ] **ERR-03**: Agent creation wizard surfaces creation errors in the wizard footer with explicit built-skill assignment failure handling
- [ ] **ERR-04**: AI build on a skill with existing chapters shows confirmation dialog: "Replace existing chapters?" vs "Append to existing?"
- [ ] **ERR-05**: AI fetch calls use AbortController with 60s timeout, displaying "Request timed out" on abort, with proper cleanup on component unmount
- [ ] **ERR-06**: saveCondition position value in local state matches the value sent to the API (off-by-one fix)

### AI Quality & Tool Manifest

- [ ] **AIQL-01**: Tool manifest entries include category, longDescription, and useWhen fields with 1-2 sentence descriptions for all tools, plus a getToolsByCategory() function
- [ ] **AIQL-02**: Chapter editor tool selection uses expandable cards (compact: icon+name+checkbox; expanded: longDescription+useWhen) with accordion behavior
- [ ] **AIQL-03**: AI-generated chapters are shown in a staged import preview modal before being committed, with warning banners for filtered tools and cycle detection
- [ ] **AIQL-04**: Chapter suggestion endpoint receives existing chapter context (names + outputDefs) to ground suggestions in the current DAG

### Data Flow Visualization

- [ ] **DFLOW-01**: Chapter editor shows upstream context preview — a read-only box displaying predecessor chapters' names and output definitions
- [ ] **DFLOW-02**: Root chapters (no incoming edges) show an "Initial Input Source" selector (user message / agent context / no input needed)
- [ ] **DFLOW-03**: DAG canvas has a toggle for data flow edge labels showing source chapter outputDef (truncated to 60 chars) mid-edge

### Cost Tracking

- [ ] **COST-01**: After AI generation completes, token usage and estimated cost are displayed inline (e.g., "Used: 1,847 tokens (~$0.005)")
- [ ] **COST-02**: Token budget selector in toolbar (10k, 25k, 50k, 100k, unlimited) stored in state, ready for DB persistence

### Versioning

- [ ] **VERS-01**: Database schema includes builtSkillVersions table (id, skillId FK, version int, snapshot JSON, changelog, publishedAt, publishedBy) with UNIQUE(skillId, version)
- [ ] **VERS-02**: Database schema includes outputSchema and temperature columns on builtChapters, and versionId FK on agentBuiltSkills
- [ ] **VERS-03**: Publishing creates a version snapshot (full denormalized JSON of chapters + edges + tools) within a database transaction
- [ ] **VERS-04**: Versions API endpoint supports listing versions (GET) and restoring from version (POST creates new draft from snapshot)
- [ ] **VERS-05**: Version history modal shows published versions with number, date, changelog, and "Restore" button per row
- [ ] **VERS-06**: Publish button opens a changelog modal ("What changed in this version?") before committing
- [ ] **VERS-07**: Published skills show "modified" indicator when meaningful fields change after publish

### Advanced (Placeholder — Blocked on Runtime)

- [ ] **ADV-01**: Dry-run test panel with input textarea, per-chapter pass/fail results, output previews, and timing
- [ ] **ADV-02**: DAG nodes show green/red/orange status overlay after dry run
- [ ] **ADV-03**: Approval node type with dashed purple border, user icon, timeout config, and notification settings

### Accessibility

- [ ] **A11Y-01**: Modal role="dialog" is on the modal element (not backdrop), with aria-labelledby on validation/condition/delete modals
- [ ] **A11Y-02**: DAG nodes support keyboard activation (Enter key opens chapter editor on focused node)
- [ ] **A11Y-03**: Context menu has proper focus management

### Edge Cases

- [ ] **EDGE-01**: Two chapters with the same name are rejected by server-side validation and AI response processing
- [ ] **EDGE-02**: Tool pool is reloaded when gateway reconnects (chapterToolMap refresh)
- [ ] **EDGE-03**: AI-generated chapter positions are normalized in preview before import to prevent overlaps

## v3.0 Requirements (Future)

### Settings Page Revamp (Resumed)

- **SET-01**: Card-based layout with enhanced field widgets
- **SET-02**: Discovery and search across all settings
- **SET-03**: Re-runnable setup wizard

### Skill Runtime

- **RUN-01**: Gateway-side skill execution engine
- **RUN-02**: Step-by-step execution with chapter output capture

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-tenant skill sharing/marketplace | Different product direction, not needed for single-gateway use |
| Real-time collaborative editing | Single-user builder, unnecessary complexity |
| Config file raw/JSON editor mode for skills | Visual builder is the product, not a developer tool |
| Mobile-responsive skill editor | Desktop-only workflow, canvas interaction requires pointer |

## Traceability

Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (populated by roadmapper) | | |

**Coverage:**
- v2.0 requirements: 42 total
- Mapped to phases: 0
- Unmapped: 42

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after initial definition*
