# Phase 14: AI-Native Interactions - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning
**Source:** UX Audit Panel (5 specialists + PM aggregator synthesis)

<domain>
## Phase Boundary

This phase makes AI assistance ambient throughout the skill builder. Every chapter field offers AI fill, suggestions appear proactively as users type, generated content is reviewable before committing, and the AI endpoint supports incremental generation.

Phase 13 (layout restructure) is complete — this phase builds AI features on top of the new sidebar + canvas + drawer layout.

</domain>

<decisions>
## Implementation Decisions

### Per-Field AI Wand (AI-01)
- Each chapter text field (description, guide, context, outputDef) in the ChapterEditor drawer gets a small wand icon (Sparkles) on the right side of the field label
- Clicking the wand calls a new API endpoint that generates content for ONLY that specific field
- The endpoint receives: fieldName, current chapter data (name, description, etc.), skill name, skill description, available tools
- Generated text is visually distinct (slightly dimmed italic) until user edits it — making AI vs user content legible
- The existing `suggest-chapter` endpoint can be extended with a `targetField` parameter to return only one field
- Wand icon appears on hover of the field label area, stays visible while AI is loading

### Ghost Chapter Suggestions (AI-02)
- As the user types in the skill description textarea (in the sidebar), after 10+ chars and a 500ms debounce, a subtle "suggestion" area appears below the description
- Shows 2-3 faded pill-shaped chapter titles that AI would generate based on the current description
- Each pill is clickable — clicking one triggers generation of just that chapter (adds to existing graph)
- Pills use a lighter/faded style (opacity-40, dashed border) to distinguish from real UI elements
- This uses the existing `suggest-skill` endpoint but with a `previewOnly: true` flag that returns only chapter titles (no full content) for speed
- Ghost suggestions disappear when the user clicks away or starts adding chapters manually

### Staged AI Proposal Overlay (AI-03)
- When "Build with AI" generates chapters, instead of immediately adding them to the graph, they appear as a staged overlay
- The overlay renders ghost nodes on the DAG canvas at proposed positions, with a subtle pulsing border
- Each ghost node has Accept (checkmark) and Reject (X) buttons
- An "Accept All" button at the top right of the canvas accepts all proposed nodes at once
- A "Reject All" button dismisses the entire proposal
- Only accepted nodes get committed to the graph via the existing API calls
- The staging state lives in `skillEditorState` as `stagedProposal: { chapters, edges } | null`

### AI Tool Pre-Selection (AI-04)
- After AI generates chapters (either via staged proposal or direct), each chapter's tool assignment includes AI-suggested tools
- The suggest-skill endpoint already returns `toolIds` per chapter — these become "suggested" chips
- In the ChapterEditor drawer's tool section, suggested tools show with a faded Sparkles icon and "suggested" label
- User can click to confirm (becomes a regular selected tool) or dismiss
- Tool suggestions are based on keyword matching: chapter description/guide text matched against tool descriptions from the manifest

### Incremental AI Endpoint (AI-05)
- The `suggest-skill` API endpoint (`/api/builder/ai/suggest-skill/+server.ts`) accepts a new `currentGraph` parameter
- `currentGraph` contains: existing chapters (id, name, description), existing edges
- When `currentGraph` is provided, the AI prompt instructs: "The skill already has these chapters: [...]. Generate ADDITIONAL chapters that complement the existing pipeline. Do not duplicate existing chapters."
- The response includes only new chapters and edges connecting to existing ones
- This enables iterative building: user can generate a few chapters, edit them, then generate more

### Claude's Discretion
- Animation timing for ghost suggestions (debounce, fade-in/out duration)
- Exact positioning of staged proposal nodes on the DAG canvas
- Error handling for partial AI failures (some fields fail, others succeed)
- Whether to show a loading skeleton in ghost suggestion pills while the API is in flight

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Skill Editor (modified in Phase 13)
- `src/routes/(app)/builder/skills/[id]/+page.svelte` — Main editor page (sidebar + canvas + drawer layout)
- `src/lib/components/builder/ChapterEditor.svelte` — Chapter drawer with progressive disclosure
- `src/lib/components/builder/ChapterDAG.svelte` — DAG canvas with xyflow/svelte

### State Management
- `src/lib/state/builder/skill-editor.svelte.ts` — All skill editor state, derived values, and business logic (buildSkillWithAI, addChapter, etc.)

### AI Endpoints
- `src/routes/api/builder/ai/suggest-skill/+server.ts` — AI skill generation (tool/function calling)
- `src/routes/api/builder/ai/suggest-chapter/+server.ts` — AI chapter field generation

### Tool Manifest
- `src/lib/data/tool-manifest.ts` — Tool metadata (names, descriptions, icons)

### Project Guidelines
- `CLAUDE.md` — Svelte 5 runes, SvelteKit conventions, naming

</canonical_refs>

<specifics>
## Specific Ideas

- The wand icon should use the existing Sparkles icon from lucide-svelte (already imported in ChapterEditor)
- Ghost suggestion pills should match the existing badge styling (bg-accent/15, border-accent/25, rounded-full)
- The staged proposal overlay should use the same node rendering as real nodes but with dashed borders and reduced opacity
- For the incremental endpoint, the system prompt change is small: prepend existing chapter names to the context

</specifics>

<deferred>
## Deferred Ideas

- Slash commands in text fields (/expand, /add chapter) — deferred to v6.0 (CONV-02)
- Conversational builder mode — deferred to v6.0 (CONV-01)
- Per-chapter "Regenerate" button — can be added later as refinement

</deferred>

---

*Phase: 14-ai-native-interactions*
*Context gathered: 2026-03-31 via UX Audit Panel synthesis*
