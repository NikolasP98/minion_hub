# Minion Hub

## What This Is

Minion Hub is a SvelteKit web dashboard for managing and monitoring AI agent gateways. It provides UI for agents, sessions, chat, reliability metrics, a visual workshop canvas, a settings configuration page, and a visual skill builder for creating agent skills with AI-assisted chapter/DAG workflows.

## Core Value

Gateway administrators and skill authors can confidently manage, monitor, and extend their AI agents through a polished, reliable web interface.

## Current Milestone: v2.0 Skill Builder Improvements

**Goal:** Harden the visual skill builder — fix critical code bugs, improve validation UX, strengthen error handling, enhance AI generation quality, add data flow visualization, cost tracking, and skill versioning.

**Target features:**
- Critical code fixes (cyclic edges, N+1 queries, tool filtering, batch inserts)
- Publish validation UX (disable on errors, structured error panel, shared validation)
- Error handling hardening (modal save errors, mutation try/catch, timeouts)
- Tool manifest expansion + AI quality (descriptions, expandable cards, staged import, DAG context)
- Data flow visualization (upstream preview, root chapter config, edge labels)
- Cost tracking display (token usage, budget control)
- Skill versioning (schema, service, API, version history, changelog)
- Advanced features placeholder (dry-run, per-node test status, approval nodes — blocked on runtime)

## Requirements

### Validated

- v1.0 Settings Page Revamp: Tab layout and save infrastructure (Phase 1 shipped)

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
- `src/routes/(app)/builder/skills/[id]/+page.svelte` — Main skill editor
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

---
*Last updated: 2026-03-18 after milestone v2.0 initialization*
