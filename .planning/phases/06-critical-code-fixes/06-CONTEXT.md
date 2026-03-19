# Phase 6: Critical Code Fixes - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix 10 specific correctness and performance bugs in the skill builder: AI output quality (cyclic edges, null labels, tool filtering, error checking, XML injection safety), database performance (N+1 queries, batch inserts), publish safety (save-before-publish), graph validation (BFS connectivity), and usage data return. No new features — strictly fixing what's broken or unsafe.

</domain>

<decisions>
## Implementation Decisions

### Cycle Policy (CFIX-01)
- Cycles are a **valid pattern** — the system supports them via `maxCycles`
- Fix the few-shot examples to be structurally correct (Example 2's retry cycle is intentional and stays)
- Add **server-side cycle detection** that detects cycles and bounds them at `maxCycles`, rather than rejecting
- CFIX-01 becomes: "AI-generated skills have valid graph structure, cycles are detected and bounded by maxCycles"
- The `SKILL_PIPELINE_SCHEMA` edge `label` field must allow `null` (CFIX-02) — currently `enum: ['Yes', 'No']` with no null option

### Usage Data Shape (CFIX-10)
- Return `prompt_tokens`, `completion_tokens`, and **estimated cost** in every AI response
- Cost estimated server-side using a **hardcoded price table per model** (e.g., `anthropic/claude-sonnet-4` = $3/$15 per 1M tokens)
- Price table is a simple object in the API file — easy to update when prices change
- Response shape: `{ ...existingFields, usage: { promptTokens: number, completionTokens: number, estimatedCost: number } }`
- Phase 11 will display this data — the shape defined here locks that contract

### Tool Filtering (CFIX-03)
- Server-side filtering removes tool IDs not in the available pool
- Response includes **filtered list + warning**: `{ filteredToolIds: string[], warning: string }` alongside valid chapters
- Phase 9 (AIQL-03) will show these warnings in the staged import preview modal
- Invalid tools never reach the database

### Input Safety (CFIX-07)
- User-provided `name` and `description` are wrapped in XML tag delimiters before injection into prompts
- Pattern: `<skill_name>{name}</skill_name>` and `<skill_description>{description}</skill_description>`
- Applies to both `suggest-skill` and `suggest-chapter` endpoints

### Error Checking (CFIX-05)
- Check `completion.error` before attempting fallback parse
- `console.warn` on the fallback path (when tool_calls not present but content exists)
- If `completion.error` exists, return it as an error response immediately — don't attempt parsing

### Publish Safety (CFIX-06)
- `publishSkill()` in `skill-editor.svelte.ts` calls `saveSkill()` first if dirty
- After save returns, re-check `skillEditorState.dirty` — if still dirty (save failed), abort publish with error

### Graph Validation (CFIX-08)
- Replace current disconnected-node check (hasIncoming/hasOutgoing sets) with BFS from root
- Root = node(s) with no incoming edges
- BFS verifies all nodes are reachable from at least one root — catches nodes that have edges but are in disconnected subgraphs

### Batch Operations (CFIX-04, CFIX-09)
- `validateSkillForPublish`: Replace per-chapter tool query loop with a single batch query joining chapters and tools
- `setChapterTools`: Replace sequential inserts with batch `db.insert().values([...])`
- `setAgentBuiltSkills`: Same batch insert pattern

### Claude's Discretion
- Exact XML tag names for injection safety (as long as they're descriptive)
- Price table values and update mechanism
- BFS implementation details (queue vs recursive)
- Whether to add a `modelPriceTable` constant or inline the lookup
- Error message wording for filtered tools warning
- Batch insert chunk size (if LibSQL has limits)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### AI Endpoints (CFIX-01, 02, 03, 05, 07, 10)
- `src/routes/api/builder/ai/suggest-skill/+server.ts` — Skill generation endpoint. Contains SYSTEM_PROMPT, SKILL_PIPELINE_SCHEMA, few-shot examples with cycles, user prompt construction, tool_calls parsing with fallback
- `src/routes/api/builder/ai/suggest-chapter/+server.ts` — Chapter suggestion endpoint. Same patterns: SYSTEM_PROMPT, schema, user prompt, tool_calls parsing with fallback

### Database Layer (CFIX-04, CFIX-09)
- `src/server/services/builder.service.ts` — `validateSkillForPublish()` (N+1 at line 108-113), `setChapterTools()` (sequential inserts at line 219-221), `setAgentBuiltSkills()` (sequential inserts at line 304-314)

### State Module (CFIX-06)
- `src/lib/state/builder/skill-editor.svelte.ts` — `publishSkill()` function, `saveSkill()` function, dirty state management

### Evaluation Documents
- `~/Documents/VAULT/MINION/OpenClaw Skill Builder — Evaluation and Improvement Strategy.md` — Original 4-specialist review findings
- `~/Documents/VAULT/MINION/OpenClaw Skill Builder — Aggregated Review Observations.md` — Aggregated review with prioritized fixes

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getToolInfo(id)` in `$lib/data/tool-manifest.ts` — already used for tool descriptions in prompts, can validate tool IDs
- `newId()` and `nowMs()` in `$server/db/utils` — ID generation and timestamp helpers used in batch inserts
- `skillEditorState` in `skill-editor.svelte.ts` — Phase 5 extracted all state here; CFIX-06 modifies `publishSkill()` in this module

### Established Patterns
- OpenRouter API calls via `fetch()` with tool_calls structured output
- Drizzle ORM batch: `db.insert(table).values([...array])` — supported by LibSQL driver
- State module pattern: exported async functions mutating `skillEditorState`

### Integration Points
- AI endpoints return JSON to `buildSkillWithAI()` in `skill-editor.svelte.ts` — response shape change (adding `usage`, `filteredToolIds`) must be consumed there
- `validateSkillForPublish()` is called from the publish API route (`/api/builder/skills/[id]/+server.ts` PATCH handler)
- Phase 9 will consume `filteredToolIds` in a preview modal — the warning shape defined here becomes the contract

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the 10 CFIX requirements are well-defined. Implementation should follow the recommended approaches for each.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-critical-code-fixes*
*Context gathered: 2026-03-19*
