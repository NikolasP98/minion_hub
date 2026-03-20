---
phase: 06-critical-code-fixes
plan: 01
subsystem: api/builder/ai
tags: [ai-endpoints, security, correctness, skill-builder]
dependency_graph:
  requires: []
  provides: [CFIX-01, CFIX-02, CFIX-03, CFIX-05, CFIX-07, CFIX-10]
  affects: [skill-editor.svelte.ts, suggest-skill, suggest-chapter]
tech_stack:
  added: []
  patterns: [xml-delimiter-injection-prevention, completion-error-early-exit, tool-id-filtering, usage-cost-tracking]
key_files:
  created: []
  modified:
    - src/routes/api/builder/ai/suggest-skill/+server.ts
    - src/routes/api/builder/ai/suggest-chapter/+server.ts
decisions:
  - "Duplicated MODEL_PRICE_TABLE and estimateCost in both endpoints (not extracted to shared module) — keeps each endpoint self-contained; only 2 consumers"
  - "CFIX-05 in suggest-chapter returns error-shaped JSON (not 502) to match existing error response pattern in that endpoint"
  - "filteredToolIds and warning are conditionally spread into response only when tools are actually removed, keeping response shape clean"
metrics:
  duration: "3m"
  completed_date: "2026-03-19"
  tasks_completed: 2
  files_modified: 2
---

# Phase 06 Plan 01: AI Endpoint Critical Fixes Summary

**One-liner:** Six correctness, security, and observability fixes across both AI skill-builder endpoints — graph terminology, nullable edge labels, tool ID filtering, completion.error early-exit, XML prompt injection prevention, and usage/cost return.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix suggest-skill endpoint (CFIX-01, -02, -03, -05, -07, -10) | e082f95 | src/routes/api/builder/ai/suggest-skill/+server.ts |
| 2 | Fix suggest-chapter endpoint (CFIX-03, -05, -07, -10) | 4fc4f25 | src/routes/api/builder/ai/suggest-chapter/+server.ts |

## What Was Built

### suggest-skill/+server.ts — 6 fixes

**CFIX-01 — Graph terminology:** Changed SYSTEM_PROMPT from "directed acyclic graph (DAG)" to "directed graph (cycles are supported and bounded by maxCycles)". The retry cycle example (`Deep Dive -> Data Collection`) was already present and intentional; the description just conflicted with it.

**CFIX-02 — Nullable edge labels:** The `label` property in `SKILL_PIPELINE_SCHEMA` now uses `anyOf: [{ type: 'string', enum: ['Yes', 'No'] }, { type: 'null' }]`. Previously it was `type: 'string'` with enum, which rejected `null` on non-condition edges despite the examples already producing `null` values.

**CFIX-03 — Tool ID filtering:** After parsing, chapter `toolIds` are filtered against `availableToolIds` using a `Set`. Removed IDs are collected in `filteredToolIds` and a human-readable `warning` string is conditionally added to the response.

**CFIX-05 — completion.error early-exit:** Before accessing `completion.choices`, the endpoint checks `completion.error` (which OpenRouter sets on HTTP 200 error responses). If present, returns a 502 immediately without attempting JSON parse.

**CFIX-07 — XML prompt injection prevention:** User-provided `name` and `description` are wrapped in `<skill_name>` and `<skill_description>` XML delimiters in the user prompt, preventing injection of extra prompt instructions via crafted inputs.

**CFIX-10 — Usage and cost return:** Added `MODEL_PRICE_TABLE` constant and `estimateCost()` function. Every successful response now includes a `usage: { promptTokens, completionTokens, estimatedCost }` object extracted from `completion.usage`.

### suggest-chapter/+server.ts — 4 fixes

**CFIX-05:** Same completion.error early-exit pattern; returns the full error-shaped JSON response matching the endpoint's existing error format (not 502, to stay consistent with this endpoint's existing non-throwing error pattern).

**CFIX-07:** User inputs wrapped with `<skill_name>`, `<skill_description>`, `<chapter_name>`, `<chapter_description>` XML delimiters.

**CFIX-03:** `suggestedToolIds` filtered against `availableToolIds` before response. Valid IDs used in response; removed IDs and warning conditionally included.

**CFIX-10:** Same `MODEL_PRICE_TABLE` and `estimateCost` duplicated locally (self-contained pattern). Usage extracted and returned in every successful response.

## Decisions Made

- **Duplicate vs shared utility:** Kept `MODEL_PRICE_TABLE` and `estimateCost` in each endpoint file rather than extracting to `$lib/utils/ai-pricing.ts`. Only 2 consumers; the overhead of a shared module outweighs the duplication for this scale.
- **suggest-chapter error shape:** CFIX-05 in suggest-chapter does not return HTTP 502. The endpoint has an established pattern of returning HTTP 200 with `error` field (matching the existing `catch` block and `!res.ok` handler). Staying consistent with that shape avoids breaking callers that check the JSON `error` field rather than HTTP status.

## Deviations from Plan

None — plan executed exactly as written.

## Pre-existing Type Errors (Out of Scope)

The following pre-existing type errors were found by `bun run check` but are not in files touched by this plan:

- `src/lib/components/channels/ChannelsTab.svelte`: 10 errors (missing properties on channel type)
- `src/routes/(app)/builder/skills/[id]/+page.svelte`: 1 error (`category` property on `ToolInfo`)
- `src/routes/(app)/builder/tools/[id]/+page.svelte`: 1 error (`autocorrect` prop on textarea)

These are deferred — not introduced by this plan.

## Self-Check: PASSED

Files exist:
- src/routes/api/builder/ai/suggest-skill/+server.ts: FOUND
- src/routes/api/builder/ai/suggest-chapter/+server.ts: FOUND

Commits exist:
- e082f95: FOUND
- 4fc4f25: FOUND
