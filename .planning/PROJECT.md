# Minion Hub

## What This Is

Minion Hub is a SvelteKit web dashboard for managing and monitoring AI agent gateways. It provides UI for agents, sessions, chat, reliability metrics, a visual workshop canvas, a settings configuration page, and a visual skill builder for creating agent skills with AI-assisted chapter/DAG workflows.

## Core Value

Gateway administrators and skill authors can confidently manage, monitor, and extend their AI agents through a polished, reliable web interface.

## Current Milestone: v3.0 Pixel Office

**Goal:** Complete the pixel art office workshop view with full character animations, real-time gateway agent integration, and migrate the Canvas 2D renderer to PixiJS for GPU-accelerated performance.

**Target features:**
- Character animations (walk cycle, typing, reading, idle wander with BFS pathfinding)
- Gateway agent bridge (real agent FSM states → pixel character typing/reading/idle behavior)
- Agent interaction (click → sidebar selection, status labels above characters)
- Monitor auto-on (CRT screens light up when agents work at desks)
- Speech bubbles (permission/waiting indicators from gateway presence data)
- Matrix spawn/despawn effect (digital rain animation on agent connect/disconnect)
- PixiJS renderer migration (replace Canvas 2D with PixiJS Sprite batching, reuse existing workshop PixiJS app)
- Layout persistence (save/load pixel office state per host via localStorage)
- Layout editor (furniture placement, floor/wall painting, undo/redo)
- Pan/zoom polish (smooth camera following, keyboard shortcuts, DPR-aware rendering)

## Requirements

### Validated

- v1.0 Settings Page Revamp: Tab layout and save infrastructure (Phase 1 shipped)
- ARCH-01, ARCH-02: State architecture extraction — skill editor god-component decomposed into `skill-editor.svelte.ts` module (Phase 5 complete)
- CFIX-01 through CFIX-10: All 10 critical code fixes — AI endpoint bugs, DB layer performance, publish safety (Phase 6 complete)
- VALID-01 through VALID-05, A11Y-01: Validation UX — shared validation module, structured error panel, disabled publish button, toast feedback, aria fixes (Phase 7 complete)

### Active

See `.planning/REQUIREMENTS.md` for full REQ-ID breakdown.

### Out of Scope

- Settings Page Revamp Phases 2-4 — paused, will resume as v3.0
- Skill runtime execution engine — gateway-side, not hub
- Multi-tenant skill sharing/marketplace — future feature
- Real-time collaborative editing — unnecessary for single-user builder

## Context

**Skill builder current state:** The builder shipped with AI-assisted skill generation (tool/function calling), a DAG-based chapter editor, publish validation, and agent wizard integration. A 4-specialist review (Prompt Engineer, AI Systems Engineer, Code Reviewer, QA Specialist) identified 45 findings across code quality, UX, validation, and architecture.

**Three quick wins already deployed:**
1. Tool/function calling for AI generation (replaced fragile JSON parsing)
2. Enhanced prompts with few-shot examples + rich tool descriptions
3. Server-side publish validation

**Key implementation documents:**
- `VAULT/MINION/OpenClaw Skill Builder — Evaluation and Improvement Strategy.md`
- `VAULT/MINION/OpenClaw Skill Builder — Aggregated Review Observations.md`
- `VAULT/MINION/OpenClaw Skill Builder — UI Implementation Blueprint.md`

**Key files:**
- `src/routes/api/builder/ai/suggest-skill/+server.ts` — AI skill generation
- `src/routes/api/builder/ai/suggest-chapter/+server.ts` — AI chapter generation
- `src/server/services/builder.service.ts` — Builder service layer
- `src/lib/state/builder/skill-editor.svelte.ts` — Skill editor state module (all state, derived, business logic)
- `src/routes/(app)/builder/skills/[id]/+page.svelte` — Skill editor template + lifecycle (reduced from 1,789 to ~1,200 lines)
- `src/lib/components/builder/ChapterEditor.svelte` — Chapter editor modal
- `src/lib/components/builder/ChapterDAG.svelte` — DAG canvas
- `src/lib/data/tool-manifest.ts` — Tool metadata
- `src/server/db/schema/builder.ts` — Database schema

## Constraints

- **Tech stack**: SvelteKit 2 + Svelte 5 runes, Bun, Drizzle ORM + LibSQL/Turso
- **AI provider**: Anthropic Claude via direct API (tool/function calling)
- **No gateway changes**: All improvements are hub-side (UI + API + DB)
- **Phase 8 blocked**: Dry-run and approval nodes require gateway skill runtime (not yet built)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1.0 Settings Revamp paused at Phase 1 | Builder improvements are higher priority after evaluation | -- Pending |
| Tool/function calling for AI generation | Replaced fragile JSON regex parsing — deployed | ✓ Good |
| 4-specialist review before implementation | Caught 45 issues before they compound | ✓ Good |
| Phase 8 included as placeholder | Keeps runtime-dependent features visible in roadmap | -- Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-23 after milestone v3.0 Pixel Office initialization*
