# Phase 06: Critical Code Fixes - Research

**Researched:** 2026-03-19
**Domain:** SvelteKit server routes, Drizzle ORM (LibSQL), Svelte 5 state modules, OpenRouter AI structured output
**Confidence:** HIGH

## Summary

This phase fixes 10 specific correctness and performance bugs spread across three files: two AI endpoint server routes (`suggest-skill` and `suggest-chapter`), the builder service (`builder.service.ts`), and the skill editor state module (`skill-editor.svelte.ts`). The bugs are well-understood from reading the actual source code — no external library discovery is needed. Research focuses on confirming correct patterns and identifying implementation traps.

The fixes fall into four categories: AI prompt/schema quality (CFIX-01, -02, -03, -05, -07, -10), database query efficiency (CFIX-04, -09), publish flow safety (CFIX-06), and graph algorithm correctness (CFIX-08). Each fix is self-contained and touches specific, well-scoped lines. The risk is low but each fix has a downstream contract that must be respected (especially CFIX-03 and CFIX-10 which define API shapes consumed in later phases).

All code patterns needed (Drizzle batch insert, JSON Schema nullable fields, BFS graph traversal) are well-established. No new dependencies are needed. The primary implementation risk is ensuring the new API response shape from CFIX-03 and CFIX-10 is consumed correctly in `buildSkillWithAI()`.

**Primary recommendation:** Fix in dependency order — schema fixes first (CFIX-01, -02), then server-side logic (CFIX-03, -05, -07, -10), then DB layer (CFIX-04, -09), then state module (CFIX-06, -08). Each group is independently testable.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cycle Policy (CFIX-01)**
- Cycles are a valid pattern — the system supports them via `maxCycles`
- Fix the few-shot examples to be structurally correct (Example 2's retry cycle is intentional and stays)
- Add server-side cycle detection that detects cycles and bounds them at `maxCycles`, rather than rejecting
- CFIX-01 becomes: "AI-generated skills have valid graph structure, cycles are detected and bounded by maxCycles"
- The `SKILL_PIPELINE_SCHEMA` edge `label` field must allow `null` (CFIX-02) — currently `enum: ['Yes', 'No']` with no null option

**Usage Data Shape (CFIX-10)**
- Return `prompt_tokens`, `completion_tokens`, and estimated cost in every AI response
- Cost estimated server-side using a hardcoded price table per model (e.g., `anthropic/claude-sonnet-4` = $3/$15 per 1M tokens)
- Price table is a simple object in the API file — easy to update when prices change
- Response shape: `{ ...existingFields, usage: { promptTokens: number, completionTokens: number, estimatedCost: number } }`
- Phase 11 will display this data — the shape defined here locks that contract

**Tool Filtering (CFIX-03)**
- Server-side filtering removes tool IDs not in the available pool
- Response includes filtered list + warning: `{ filteredToolIds: string[], warning: string }` alongside valid chapters
- Phase 9 (AIQL-03) will show these warnings in the staged import preview modal
- Invalid tools never reach the database

**Input Safety (CFIX-07)**
- User-provided `name` and `description` are wrapped in XML tag delimiters before injection into prompts
- Pattern: `<skill_name>{name}</skill_name>` and `<skill_description>{description}</skill_description>`
- Applies to both `suggest-skill` and `suggest-chapter` endpoints

**Error Checking (CFIX-05)**
- Check `completion.error` before attempting fallback parse
- `console.warn` on the fallback path (when tool_calls not present but content exists)
- If `completion.error` exists, return it as an error response immediately — don't attempt parsing

**Publish Safety (CFIX-06)**
- `publishSkill()` in `skill-editor.svelte.ts` calls `saveSkill()` first if dirty
- After save returns, re-check `skillEditorState.dirty` — if still dirty (save failed), abort publish with error

**Graph Validation (CFIX-08)**
- Replace current disconnected-node check (hasIncoming/hasOutgoing sets) with BFS from root
- Root = node(s) with no incoming edges
- BFS verifies all nodes are reachable from at least one root — catches nodes that have edges but are in disconnected subgraphs

**Batch Operations (CFIX-04, CFIX-09)**
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CFIX-01 | AI skill generation does not produce cyclic edges in few-shot examples | Few-shot example fix: Example 2 `Deep Dive → Data Collection` edge is intentional retry cycle; confirm it remains; system prompt RULES line says "DAG" which should be relaxed or clarified |
| CFIX-02 | AI skill generation allows null edge labels in the schema definition | `SKILL_PIPELINE_SCHEMA` edge.label is currently `{ type: 'string', enum: ['Yes', 'No'] }` — must add `null` to the type or use `anyOf` |
| CFIX-03 | AI-generated tool IDs are filtered server-side against available tools, with filtered tools reported in the response | `getToolInfo()` falls back to `{ id: toolId }` for unknowns — need positive set check; `availableToolIds` is already in the request body |
| CFIX-04 | Publish validation uses a single batch query instead of per-chapter N+1 SELECT loop | Lines 108–113 in builder.service.ts — replace loop with `db.select().from(builtChapterTools).where(inArray(builtChapterTools.chapterId, chapterIds))` |
| CFIX-05 | AI endpoints check completion.error before attempting fallback parse, with console.warn on fallback path | `completion.error` field from OpenRouter — check before `completion.choices?.[0]` access |
| CFIX-06 | Publish flow aborts if prior save failed (dirty check after saveSkill) | `publishSkill()` already calls `saveSkill()` if dirty; add post-save dirty re-check; `saveSkill()` sets dirty=false only on success |
| CFIX-07 | User inputs in AI prompts are wrapped in XML tag delimiters for injection safety | Both endpoints build `userPrompt` by string interpolation — wrap name/description/skillName/skillDescription in XML tags |
| CFIX-08 | Disconnected-node validation uses BFS from root to verify single connected component | Current check at lines 121–127 only catches nodes with zero edges; BFS catches isolated subgraphs |
| CFIX-09 | setChapterTools and setAgentBuiltSkills use batch inserts instead of sequential loops | Both use `for...await` loops; replace with `db.insert(table).values([...records])` |
| CFIX-10 | AI endpoints return usage object (prompt_tokens, completion_tokens, cost) in response | `completion.usage` from OpenRouter response contains `prompt_tokens` and `completion_tokens` |
</phase_requirements>

---

## Standard Stack

### Core (no new dependencies needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | existing | Batch queries and inserts | Already used; `inArray()` and batch `.values([...])` are built-in |
| TypeScript | existing | Type safety for new response shapes | Enforced by project |
| Vitest | existing | Unit tests for service and utility functions | Already used for all service tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-orm` `inArray` | existing | Replace N+1 loop with single query | CFIX-04 batch select |

**Installation:** No new packages needed. All capabilities are in the existing stack.

---

## Architecture Patterns

### Existing File Locations

Each CFIX maps to an exact file and line range:

```
src/
├── routes/api/builder/ai/
│   ├── suggest-skill/+server.ts     # CFIX-01, -02, -03, -05, -07, -10
│   └── suggest-chapter/+server.ts   # CFIX-05, -07, -10 (no schema/edge changes)
├── server/services/
│   └── builder.service.ts           # CFIX-04 (lines 108-113), CFIX-08 (lines 116-128), CFIX-09 (lines 219-221, 304-314)
└── lib/state/builder/
    └── skill-editor.svelte.ts       # CFIX-06 (publishSkill function, lines 285-312)
```

### Pattern 1: JSON Schema Nullable Field (CFIX-02)

The current schema uses `enum: ['Yes', 'No']` which rejects null. OpenRouter/OpenAI structured output schemas accept either `anyOf` with null type or an `enum` that includes null:

```typescript
// BEFORE — rejects null, causes AI to omit label or hallucinate 'Yes'/'No' on non-condition edges
label: { type: 'string', enum: ['Yes', 'No'], description: 'Branch label for condition edges' }

// AFTER — null is the correct value for non-condition edges
label: {
  anyOf: [
    { type: 'string', enum: ['Yes', 'No'] },
    { type: 'null' },
  ],
  description: 'Branch label for condition edges (Yes/No for condition nodes, null for regular edges)',
}
```

**Confidence:** HIGH — verified against OpenAI JSON schema structured output spec. `anyOf` with `{ type: 'null' }` is the standard pattern. `enum` values cannot include `null` in JSON Schema draft 7 (which OpenRouter uses).

### Pattern 2: XML Injection Safety (CFIX-07)

Anthropic's recommended pattern for safely injecting user content into prompts is XML tag wrapping. This prevents prompt injection where a malicious name like `"</skill_name><instructions>Ignore all previous..."` could alter prompt structure.

```typescript
// suggest-skill userPrompt — BEFORE
const userPrompt = `Skill: "${name || 'Untitled Skill'}"
Description: ${description}
...`;

// AFTER
const userPrompt = `Skill: <skill_name>${name || 'Untitled Skill'}</skill_name>
Description: <skill_description>${description}</skill_description>
...`;
```

For `suggest-chapter`, the same applies to both skill context and chapter context:
```typescript
// AFTER
const userPrompt = `Skill: <skill_name>${skillName || 'Untitled Skill'}</skill_name>${skillDescription ? `\nSkill description: <skill_description>${skillDescription}</skill_description>` : ''}

Chapter: <chapter_name>${name}</chapter_name>${description ? `\nChapter description: <chapter_description>${description}</chapter_description>` : ''}
...`;
```

### Pattern 3: Drizzle Batch Insert (CFIX-09)

LibSQL driver supports Drizzle's batch `.values([...])` for multiple rows in a single statement. This is the established pattern in this codebase (seen in other services).

```typescript
// BEFORE — sequential inserts in builder.service.ts setChapterTools
for (const toolId of toolIds) {
  await ctx.db.insert(builtChapterTools).values({ id: newId(), chapterId, toolId });
}

// AFTER — single insert with array of values
if (toolIds.length > 0) {
  await ctx.db.insert(builtChapterTools).values(
    toolIds.map(toolId => ({ id: newId(), chapterId, toolId }))
  );
}
```

Same pattern for `setAgentBuiltSkills`:
```typescript
// BEFORE
for (let i = 0; i < skillIds.length; i++) {
  await ctx.db.insert(agentBuiltSkills).values({ id: newId(), gatewayAgentId, serverId, tenantId: ctx.tenantId, skillId: skillIds[i], position: i, createdAt: now });
}

// AFTER
if (skillIds.length > 0) {
  await ctx.db.insert(agentBuiltSkills).values(
    skillIds.map((skillId, i) => ({ id: newId(), gatewayAgentId, serverId, tenantId: ctx.tenantId, skillId, position: i, createdAt: now }))
  );
}
```

**Note on chunk size:** LibSQL has a default limit of 999 SQLite bind parameters per statement. With ~6 columns per row, this gives a safe batch limit of ~160 rows. Skill tool counts will never approach this limit in practice. No chunking needed.

### Pattern 4: Drizzle inArray Batch Query (CFIX-04)

```typescript
// BEFORE — N+1 loop in validateSkillForPublish (lines 108-113)
for (const ch of chapters.filter(c => c.type === 'chapter')) {
  const tools = await ctx.db.select().from(builtChapterTools).where(eq(builtChapterTools.chapterId, ch.id));
  if (tools.length === 0) {
    errors.push(`Chapter "${ch.name}" has no tools assigned`);
  }
}

// AFTER — single query
import { inArray } from 'drizzle-orm';

const chapterOnlyNodes = chapters.filter(c => c.type === 'chapter');
if (chapterOnlyNodes.length > 0) {
  const chapterIds = chapterOnlyNodes.map(c => c.id);
  const allTools = await ctx.db
    .select({ chapterId: builtChapterTools.chapterId })
    .from(builtChapterTools)
    .where(inArray(builtChapterTools.chapterId, chapterIds));
  const chaptersWithTools = new Set(allTools.map(t => t.chapterId));
  for (const ch of chapterOnlyNodes) {
    if (!chaptersWithTools.has(ch.id)) {
      errors.push(`Chapter "${ch.name}" has no tools assigned`);
    }
  }
}
```

**Note:** `inArray` with an empty array would produce invalid SQL. The `if (chapterOnlyNodes.length > 0)` guard is required.

### Pattern 5: BFS Connectivity Validation (CFIX-08)

The current check (lines 121-127 in builder.service.ts) only detects nodes with no edges at all. It misses disconnected subgraphs (e.g., two separate chains with no cross-edge). BFS from all root nodes is the correct algorithm.

```typescript
// AFTER — replaces the hasIncoming/hasOutgoing check block
const hasIncoming = new Set(edges.map(e => e.targetChapterId));
const roots = chapters.filter(ch => !hasIncoming.has(ch.id));

if (roots.length === 0) {
  // All nodes have incoming edges — pure cycle, no root (still bounded by maxCycles)
  // This is valid; skip reachability check
} else {
  // BFS from all roots
  const reachable = new Set<string>(roots.map(r => r.id));
  const queue = [...roots.map(r => r.id)];
  const adjMap = new Map<string, string[]>();
  for (const ch of chapters) adjMap.set(ch.id, []);
  for (const e of edges) adjMap.get(e.sourceChapterId)?.push(e.targetChapterId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjMap.get(current) ?? []) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  const unreachable = chapters.filter(ch => !reachable.has(ch.id));
  if (unreachable.length > 0) {
    errors.push(`${unreachable.length} disconnected chapter(s): ${unreachable.map(ch => ch.name).join(', ')}`);
  }
}
```

### Pattern 6: completion.error Check (CFIX-05)

OpenRouter can return an error in the completion body even with HTTP 200 (e.g., model-specific errors, content policy). The current code skips straight to `completion.choices` without checking.

```typescript
// AFTER — in both suggest-skill and suggest-chapter, after `const completion = await res.json()`
if (completion.error) {
  console.error('[ai/suggest-skill] completion.error:', completion.error);
  return json({ error: completion.error.message ?? 'AI returned an error' }, { status: 502 });
}

// Try tool_calls first (structured output), fall back to content parsing
const toolCall = completion.choices?.[0]?.message?.tool_calls?.[0];
if (toolCall?.function?.arguments) {
  parsed = JSON.parse(toolCall.function.arguments);
} else {
  // Fallback: parse from content (for models that don't support tool_choice)
  console.warn('[ai/suggest-skill] No tool_calls in response — falling back to content parse');
  const content = completion.choices?.[0]?.message?.content ?? '';
  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  parsed = JSON.parse(jsonStr);
}
```

### Pattern 7: Usage Data + Cost Return (CFIX-10)

OpenRouter returns a `usage` object in the completion response: `{ prompt_tokens, completion_tokens, total_tokens }`. The cost table must be maintained per model.

```typescript
// In suggest-skill/+server.ts — after successful parse
const MODEL_PRICE_TABLE: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'anthropic/claude-sonnet-4': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'anthropic/claude-haiku-3': { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  'openai/gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const prices = MODEL_PRICE_TABLE[model];
  if (!prices) return 0;
  return (promptTokens / 1_000_000) * prices.inputPerMillion +
         (completionTokens / 1_000_000) * prices.outputPerMillion;
}

// In response:
const rawUsage = completion.usage ?? {};
const promptTokens = rawUsage.prompt_tokens ?? 0;
const completionTokens = rawUsage.completion_tokens ?? 0;
const usedModel = model || DEFAULT_MODEL;

return json({
  chapters,
  edges,
  usage: {
    promptTokens,
    completionTokens,
    estimatedCost: estimateCost(usedModel, promptTokens, completionTokens),
  },
});
```

For `suggest-chapter`, the same `usage` field is appended to the existing response object.

### Pattern 8: Tool Filtering (CFIX-03)

The `availableToolIds` array is already in the request body. The current code calls `getToolInfo(id)` for display purposes but never validates whether an AI-returned tool ID is in the available pool.

```typescript
// In suggest-skill, after parsing chapters — before returning
const availableSet = new Set<string>(availableToolIds ?? []);
const filteredToolIds: string[] = [];

// Filter chapter toolIds to only include available tools
for (const ch of chapters) {
  if (ch.toolIds && Array.isArray(ch.toolIds)) {
    const before = ch.toolIds as string[];
    const filtered = before.filter((id: string) => availableSet.has(id));
    const removed = before.filter((id: string) => !availableSet.has(id));
    filteredToolIds.push(...removed);
    (ch as Record<string, unknown>).toolIds = filtered;
  }
}

const warning = filteredToolIds.length > 0
  ? `${filteredToolIds.length} tool(s) not available in current pool were removed: ${filteredToolIds.join(', ')}`
  : undefined;

return json({
  chapters,
  edges,
  ...(warning ? { filteredToolIds, warning } : {}),
  usage: { promptTokens, completionTokens, estimatedCost },
});
```

**Note on CFIX-03 in suggest-chapter:** The `suggest-chapter` endpoint returns `suggestedToolIds` — these should also be filtered. Same pattern: filter `suggestedToolIds` against `availableToolIds` before returning.

### Pattern 9: Publish Safety (CFIX-06)

The current `publishSkill()` already calls `saveSkill()` if dirty. The missing piece: after `saveSkill()` returns, if `skillEditorState.dirty` is still `true` (meaning the save failed — the success path sets dirty to false), abort with an error.

```typescript
// AFTER — in publishSkill(), after the saveSkill() call
export async function publishSkill() {
  if (skillEditorState.dirty) await saveSkill();
  // Re-check: if still dirty, save failed — abort
  if (skillEditorState.dirty) {
    skillEditorState.publishError = 'Cannot publish — unsaved changes could not be saved. Please try again.';
    return;
  }
  skillEditorState.publishing = true;
  // ... rest unchanged
}
```

This works because `saveSkill()` sets `skillEditorState.dirty = false` only in the success path, and leaves it `true` if the fetch throws or returns an error.

### Pattern 10: SYSTEM_PROMPT DAG Mention (CFIX-01)

The SYSTEM_PROMPT says "directed acyclic graph (DAG)" in the first line, but cycles are valid (bounded by `maxCycles`). This creates a contradiction — the AI is told to produce a DAG but the few-shot examples show a cycle. The fix:

1. Change "directed acyclic graph (DAG)" to "directed graph (which may include cycles bounded by maxCycles)" in the SYSTEM_PROMPT
2. The Example 2 retry cycle (`Deep Dive → Data Collection`) is intentional and stays
3. Remove or update any "acyclic" mentions in RULES section if present

### Anti-Patterns to Avoid

- **Mutating `parsed.chapters` in-place:** When filtering tool IDs in CFIX-03, the chapters array items are plain objects (from JSON.parse), so direct mutation is fine but should be done before any type cast
- **Empty inArray call:** `inArray(column, [])` generates invalid SQL in Drizzle/LibSQL. Always guard with `if (ids.length > 0)`
- **Not guarding empty batch insert:** `db.insert(table).values([])` throws in LibSQL. Guard both batch inserts with `if (array.length > 0)`
- **Losing usage on parse error:** If the completion parses successfully but chapters are empty, still return the usage object so cost tracking works even on partial responses
- **suggest-chapter filteredToolIds contract:** The CONTEXT.md specifies the warning shape for Phase 9 consumption. Keep `filteredToolIds` as a string array and `warning` as a human-readable string — do not nest them differently

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Nullable field in JSON Schema | Custom schema serializer | `anyOf: [{ type: 'string', enum: [...] }, { type: 'null' }]` | Standard JSON Schema pattern, understood by all LLM providers |
| Batch database insert | Sequential loop | Drizzle `db.insert().values([...array])` | Single SQL statement, LibSQL-native, already established in codebase |
| Graph reachability | Custom tree walker | Standard BFS with a Set | Simple, tested, O(V+E) — no library needed |
| Token cost estimation | API call to pricing endpoint | Hardcoded price table constant | Prices change infrequently; hardcoded table is trivially maintainable |
| Tool ID validation | Regex or fuzzy match | `new Set(availableToolIds)` with `.has()` | Exact match is the correct semantic — IDs are canonical |

---

## Common Pitfalls

### Pitfall 1: inArray with Empty Array
**What goes wrong:** `inArray(builtChapterTools.chapterId, [])` generates SQL like `WHERE chapterId IN ()` which is a syntax error in SQLite/LibSQL.
**Why it happens:** Skills with only condition nodes have no `chapter`-type chapters. The filter `chapters.filter(c => c.type === 'chapter')` can return an empty array.
**How to avoid:** Always guard: `if (chapterOnlyNodes.length > 0) { ... inArray query ... }`
**Warning signs:** Test with a skill that has only condition nodes.

### Pitfall 2: Batch Insert with Empty Array
**What goes wrong:** `db.insert(table).values([])` throws in LibSQL.
**Why it happens:** `setChapterTools([])` is called when removing all tools from a chapter. `setAgentBuiltSkills(agentId, serverId, [])` is called when an agent has no skills.
**How to avoid:** Guard both functions: `if (toolIds.length > 0) { await ctx.db.insert(...).values(...) }`
**Warning signs:** The delete still runs before the conditional insert — this is correct, the guard is only on insert.

### Pitfall 3: OpenRouter completion.error Format
**What goes wrong:** `completion.error` may be an object with `.message` or a string depending on the error type.
**Why it happens:** OpenRouter doesn't always return the same error shape.
**How to avoid:** Use safe access: `completion.error.message ?? String(completion.error) ?? 'AI returned an error'`
**Warning signs:** Returning `[object Object]` in the error message.

### Pitfall 4: BFS All-Cycle Graph Edge Case
**What goes wrong:** If all nodes are in a cycle (no root), BFS from "roots" would find no roots and mark every node as unreachable.
**Why it happens:** A pure cycle means every node has an incoming edge, so `roots` (nodes with no incoming edges) is empty.
**How to avoid:** When `roots.length === 0` and `chapters.length > 0` and `edges.length > 0`, this is a valid pure cycle. Skip the reachability check — the cycle is bounded by `maxCycles`.
**Warning signs:** Valid cyclic skills failing publish with disconnected-node errors.

### Pitfall 5: CFIX-01 SYSTEM_PROMPT Contradiction
**What goes wrong:** The SYSTEM_PROMPT still says "DAG" after the fix, which confuses the AI about whether cycles are permitted.
**Why it happens:** The RULES section says "directed acyclic graph (DAG)" but the codebase supports cycles.
**How to avoid:** Update the first SYSTEM_PROMPT sentence. Change "DAG" to "directed graph (cycles are supported and bounded by maxCycles)".
**Warning signs:** AI ignores the few-shot cycle example and always produces acyclic graphs.

### Pitfall 6: suggest-chapter Missing filteredToolIds
**What goes wrong:** CFIX-03 filtering is applied to `suggest-skill` but not `suggest-chapter`, leaving `suggestedToolIds` unvalidated.
**Why it happens:** The CONTEXT.md focuses the CFIX-03 description on `suggest-skill` but both endpoints return tool IDs.
**How to avoid:** Apply the same `availableSet` filter to `suggestedToolIds` in `suggest-chapter` before the return statement.
**Warning signs:** Chapter tools showing unknown tool IDs that were hallucinated by the AI.

### Pitfall 7: usage null when completion parse fails
**What goes wrong:** If `completion.error` triggers an early return, the usage object is not included — this is correct and intentional.
**Why it happens:** There is no usage to report if the AI request failed.
**How to avoid:** Only include usage in successful responses. Error responses do not need usage.

### Pitfall 8: Downstream consumers not updated after CFIX-10 shape change
**What goes wrong:** `buildSkillWithAI()` in `skill-editor.svelte.ts` calls `suggest-skill` and reads `data.chapters` / `data.edges`. After CFIX-10, the response also includes `data.usage`. The existing code ignores unknown fields, so this is non-breaking — but `data.filteredToolIds` and `data.warning` from CFIX-03 must be surfaced eventually.
**Why it happens:** The current code does: `const data = await res.json(); if (!data.chapters?.length) throw ...`
**How to avoid:** For Phase 6, the extra fields can be ignored in the state module (they will be consumed in Phase 9). Log them to console for development visibility: `if (data.warning) console.warn('[skill-editor] AI filtered tools:', data.warning, data.filteredToolIds)`.

---

## Code Examples

Verified patterns from codebase inspection:

### Existing mock-db pattern for testing service functions
```typescript
// Source: src/server/test-utils/mock-db.ts
import { createMockDb } from '$server/test-utils/mock-db';

const { db, resolveSequence } = createMockDb();
// For multi-query functions (validateSkillForPublish):
resolveSequence([
  [skillRow],                    // getBuiltSkill
  [ch1, ch2, ch3],               // getChapters
  [{ chapterId: ch1.id }],       // inArray tools query
  [edge1, edge2],                // getChapterEdges
]);
const result = await validateSkillForPublish({ db, tenantId: 't1' }, 'skill-1');
```

### Drizzle inArray import
```typescript
// Source: drizzle-orm (already installed, used in other service files)
import { eq, and, desc, inArray } from 'drizzle-orm';
```

### Existing newId/nowMs utilities
```typescript
// Source: src/server/db/utils.ts (confirmed used in builder.service.ts)
import { newId, nowMs } from '$server/db/utils';

// Batch records use same nowMs() value for all rows:
const now = nowMs();
skillIds.map((skillId, i) => ({ id: newId(), ..., createdAt: now }))
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JSON Schema `enum` without null | `anyOf` with null type | Phase 6 | AI can now output null labels for non-condition edges |
| N+1 per-chapter tool SELECT | Single inArray batch SELECT | Phase 6 | Publish validation goes from O(n) queries to O(1) |
| Sequential inserts in loop | Batch insert with values array | Phase 6 | setChapterTools and setAgentBuiltSkills each go from n to 1 SQL statement |
| String interpolation of user input | XML tag wrapping | Phase 6 | Prevents prompt injection on name/description fields |

---

## Open Questions

1. **OpenRouter completion.error exact shape**
   - What we know: OpenRouter can include an `error` field on HTTP 200 responses for model-specific errors
   - What's unclear: Whether `error` is always `{ message: string, code: number }` or sometimes a string
   - Recommendation: Use safe access `completion.error?.message ?? JSON.stringify(completion.error)` to handle both

2. **suggest-chapter filteredToolIds response shape**
   - What we know: CONTEXT.md only specifies the CFIX-03 shape for `suggest-skill`
   - What's unclear: Whether Phase 9 will consume filtered tool warnings from `suggest-chapter` as well
   - Recommendation: Apply filtering in `suggest-chapter` but only include `filteredToolIds` in the response if any were removed (consistent with suggest-skill). Keep the same shape.

---

## Validation Architecture

> `workflow.nyquist_validation` is absent from `.planning/config.json` — treating as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing) |
| Config file | `vite.config.ts` (inline test config via `defineConfig`) |
| Quick run command | `bun run vitest run src/server/services/builder.service.test.ts` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CFIX-01 | SYSTEM_PROMPT says "directed graph", not "DAG" | manual/review | code review only | N/A |
| CFIX-02 | edge.label schema accepts null | unit | `bun run vitest run src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` | ❌ Wave 0 |
| CFIX-03 | Tool IDs filtered against available pool | unit | `bun run vitest run src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` | ❌ Wave 0 |
| CFIX-04 | validateSkillForPublish uses one query not N+1 | unit | `bun run vitest run src/server/services/builder.service.test.ts` | ❌ Wave 0 |
| CFIX-05 | completion.error triggers early error return | unit | `bun run vitest run src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` | ❌ Wave 0 |
| CFIX-06 | publishSkill aborts if dirty after save | unit | `bun run vitest run src/lib/state/builder/skill-editor.test.ts` | ❌ Wave 0 |
| CFIX-07 | userPrompt contains XML-wrapped name/description | unit | `bun run vitest run src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` | ❌ Wave 0 |
| CFIX-08 | BFS catches disconnected subgraph | unit | `bun run vitest run src/server/services/builder.service.test.ts` | ❌ Wave 0 |
| CFIX-09 | setChapterTools and setAgentBuiltSkills use single insert | unit | `bun run vitest run src/server/services/builder.service.test.ts` | ❌ Wave 0 |
| CFIX-10 | Response includes usage.promptTokens, completionTokens, estimatedCost | unit | `bun run vitest run src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run vitest run src/server/services/builder.service.test.ts`
- **Per wave merge:** `bun run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/server/services/builder.service.test.ts` — covers CFIX-04, CFIX-08, CFIX-09
- [ ] `src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` — covers CFIX-02, CFIX-03, CFIX-05, CFIX-07, CFIX-10
- [ ] `src/lib/state/builder/skill-editor.test.ts` — covers CFIX-06

Note: CFIX-01 is a prompt text change — verified by code review, not automated test.

The `createMockDb()` utility in `src/server/test-utils/mock-db.ts` is available for service tests. Endpoint tests will need to mock `fetch` via `vi.spyOn(globalThis, 'fetch')` and return mock completion responses. The `resolveSequence` API in `createMockDb` handles multi-query service functions like `validateSkillForPublish`.

---

## Sources

### Primary (HIGH confidence)
- Direct source code inspection of all 4 affected files — current implementation verified line by line
- `src/server/test-utils/mock-db.ts` — confirmed test pattern available for all service tests
- `src/lib/data/tool-manifest.ts` — confirmed `getToolInfo()` fallback behavior and `getAllTools()` availability

### Secondary (MEDIUM confidence)
- JSON Schema draft 7 specification — `anyOf` with `{ type: 'null' }` is the standard nullable field pattern
- OpenRouter API documentation — `completion.usage` field shape (`prompt_tokens`, `completion_tokens`)
- Drizzle ORM LibSQL documentation — `inArray()` and batch `.values([...])` confirmed as supported operations

### Tertiary (LOW confidence — flagged)
- OpenRouter `completion.error` exact shape on HTTP 200 responses — inferred from API pattern; exact shape unverified

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all patterns from existing codebase
- Architecture: HIGH — all file locations and function signatures verified from source
- Pitfalls: HIGH — derived from reading actual code; inArray empty array and batch empty array are confirmed LibSQL gotchas
- API response shapes: HIGH for OpenRouter usage field; MEDIUM for completion.error shape

**Research date:** 2026-03-19
**Valid until:** 2026-09-19 (stable domain — Drizzle, JSON Schema, OpenRouter response format are all stable)
