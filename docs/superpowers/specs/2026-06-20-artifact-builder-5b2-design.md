# LLM Artifact Builder (Subsystem 5b.2)

**Date:** 2026-06-20
**Status:** Approved design (user authorized spec→plan→ponytail→build) — ready for plan
**Scope:** Subsystem **5b.2** of the artifact-builder roadmap (#5). A **hub-side LLM
builder** that, given an admin's request + an autonomous agent's exported-variable
schema (5b.1) + the artifact design contract, generates a self-contained HTML
artifact bundle and stores it via 5a (`createArtifactRow`). Wired to the gallery
`+` as a **Generate** mode alongside the existing manual paste. Completes #5.

## Context (verified)

- Hub server-side LLM = Vercel AI SDK: `createOpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' })` + `generateText({ model: openrouter(MODEL), prompt, temperature })` (see `reminder-compose.ts`, `crm-insights.service.ts`; cheap default `google/gemini-2.5-flash`).
- 5a storage: `createArtifactRow(ctx, { agentId, title, description, icon, html })` (`src/lib/server/artifacts/store.ts`) → `agent_artifacts` (org-scoped, forced RLS). `POST /api/artifacts` (manual) + `ArtifactCreateModal.svelte` (title/desc/icon/**paste html**).
- 5b.1: `flowVariableSchema(specs, toggles)` (enabled-only `VariableSpec[]` with `label`/`type`/`sample`); `flowExportedSpecs(flow)`; per-agent live values land in `ArtifactContext.vars` keyed by the same universal keys. System-agent descriptors (`getSystemAgentDescriptors()`) carry `flowId` + `name`/`role`/`description`/`trigger`.
- Reference bundle: `src/lib/artifacts/builtin/overview/index.html` (110 lines) — the canonical self-contained artifact: bridge client (`plugin:ready` → `host:hello` token-apply → `hub.artifact.context.get` rpc → render), token-bound CSS, loading/error states. Artifacts run in a `sandbox="allow-scripts"` iframe (opaque origin) under CSP `sandbox`.

## Decisions (made; surfaced for course-correction)

1. **Whole-bundle generation (Approach A), not a template-injection scheme.** The LLM is given the **overview bundle as the canonical example** and instructed to reuse its bridge `<script>` verbatim, changing only the render + styles to bind to the agent's variables. Leaner than extracting a template + injection machinery; the **sandbox + loading/error states are the safety net** for a malformed generation (admin regenerates). A constrained template is a future iteration if reliability warrants.
2. **Synchronous generation.** The admin submits and waits (~10–30s) with a spinner — matches the hub's existing sync LLM calls; no job infra.
3. **Title + icon are admin-provided** in the modal; the LLM generates the **HTML only** (metadata stays user-controlled, the LLM stays focused).
4. **Keep both modes.** The create modal gets a **Generate** tab (prompt → LLM, default) and keeps the **Paste HTML** tab (5a, power-user/fallback).
5. **Model:** `env.ARTIFACT_BUILDER_MODEL` with a capable fallback (`anthropic/claude-3.7-sonnet` — HTML/JS generation needs a strong model; cheap flash is for classification). Configurable.
6. **Light validation:** strip markdown fences; require non-empty HTML that contains the `hub.artifact.context.get` bridge call (so it actually fetches data) and a `<` tag. Runtime safety is the iframe sandbox, not server sanitization.

## Architecture

### 1. Builder — `src/lib/server/artifacts/builder.ts`

`generateArtifactHtml(ctx, { agentId, prompt }): Promise<string>`:
- Resolve the descriptor (`getSystemAgentDescriptors().find(id===agentId)`); 404-ish (throw) if none or no `flowId`.
- Compute the enabled schema: `flowVariableSchema(flowExportedSpecs(getMasterFlow(flowId)), await listExportToggles(ctx, flowId))` → the `VariableSpec[]` (key/label/type/sample) the artifact may bind to.
- Assemble the prompt via a pure helper `buildBuilderPrompt({ agent, schema, userPrompt, reference })` (in a sibling pure module `builder-prompt.ts`, unit-tested) — a system+user prompt embedding: the **contract** (self-contained HTML; reuse the reference's bridge `<script>` verbatim; theme via `var(--color-…)` tokens from `host:hello`; fetch data with `bridge … 'hub.artifact.context.get'`; the data shape `{ agentName, agentRole, status, trigger, vars: { <key>: value } }`; render loading/empty/error; no external network/CDN), the **reference bundle** (overview `?raw`), the **agent** (name/role/trigger), the **variable schema** (key/label/type/sample list), and the **user request**.
- `generateText({ model: openrouter(env.ARTIFACT_BUILDER_MODEL ?? 'anthropic/claude-3.7-sonnet'), prompt, temperature: 0.3 })`.
- `extractHtml(text)` (pure, tested): strip ```html / ``` fences + leading prose; return the `<!doctype/<html`…`</html>` slice (or the whole text if it's already raw HTML).
- `validateBundle(html)` (pure, tested): non-empty, contains `hub.artifact.context.get` and `<`; throw a clear Error otherwise.
- Return the HTML.

### 2. API — `src/routes/api/artifacts/generate/+server.ts`

`POST` (admin, org-scoped): `requireAdmin(locals)` → `requireCoreCtx(locals)` → body `{ agentId, title, icon, description?, prompt }` (400 if missing `agentId`/`title`/`prompt`) → `html = await generateArtifactHtml(ctx, { agentId, prompt })` (502 with the error message on generation/validation failure) → `createArtifactRow(ctx, { agentId, title, description, icon, html })` → `json(artifactRowToDescriptor(row), { status: 201 })`. Mirrors `POST /api/artifacts` + the builder step.

### 3. UI — `ArtifactCreateModal.svelte` (Generate tab)

The existing modal gains a 2-tab toggle: **Generate** (default) and **Paste HTML** (current). Generate tab fields: title, icon picker (reused), description (optional), and a **prompt** textarea ("Describe the artifact — e.g. 'a card showing reminders sent vs failed this month'"). A hint lists the agent's **available variables** (the enabled schema labels, passed in as a prop from the page load). Submit (disabled unless title + prompt) → `POST /api/artifacts/generate` with a **loading/generating** state (spinner + "Generating…"), longer timeout; on 201 → `oncreated()` + close + reset; on error → inline message (the builder's reason). Paste tab unchanged (5a).

The available-variable hint needs the agent's enabled schema at the card: the autonomous loads (already loading `flowTogglesByFlow` in 5b.1) also expose `flowSchemaByFlow: Record<flowId, VariableSpec[]>` (enabled schema per agent flow) so the modal can show "available variables". (Small addition to the existing loads.)

## Components & files

| File | Change |
|---|---|
| `src/lib/server/artifacts/builder-prompt.ts` | NEW — pure `buildBuilderPrompt(...)` + `extractHtml` + `validateBundle` |
| `src/lib/server/artifacts/builder-prompt.test.ts` | NEW — unit tests (extractHtml fence-strip, validateBundle pass/fail, prompt includes schema keys) |
| `src/lib/server/artifacts/builder.ts` | NEW — `generateArtifactHtml(ctx, {agentId, prompt})` (OpenRouter call + schema assembly) |
| `src/routes/api/artifacts/generate/+server.ts` | NEW — `POST` generate (admin, org-scoped) |
| `src/lib/components/artifacts/ArtifactCreateModal.svelte` | EDIT — Generate/Paste tabs; Generate calls `/generate` with loading state + variable hint |
| `src/routes/(app)/agents/autonomous/+page.server.ts`, `[id]/+page.server.ts` | EDIT — also expose `flowSchemaByFlow` (enabled `VariableSpec[]` per flow) for the modal hint |
| `src/lib/components/agents/AutonomousAgentCard.svelte` | EDIT — pass `flowSchemaByFlow[agent.flowId]` to the modal |
| `messages/en.json`, `messages/es.json` | EDIT — Generate-tab labels (generate / prompt / generating / available variables / paste) |

## Out of scope (later — 5c / fast-follow)

- Constrained **template injection** (fixed bridge client + LLM render-body only) — the robustness upgrade if whole-bundle generation proves flaky.
- **Async/job** generation + progress streaming; regenerate/iterate-on-an-existing-artifact; multi-turn refinement.
- The artifact-builder as a **system agent** in the autonomous roster (the original #5 "admin-only system agent" framing) — 5b.2 ships the capability; surfacing the builder itself as an agent card is later.
- Brain-agent artifacts; non-agent flows; gateway-side builder + the gw MCP (#4, parked).

## Testing

- `builder-prompt.ts` pure: `extractHtml` (fenced + raw + prose-prefixed), `validateBundle` (pass + each failure mode), `buildBuilderPrompt` includes the agent name + every schema key + the user prompt. (vitest)
- `builder.ts` (OpenRouter call) + the API + modal: `bun run check` + live smoke (generate one artifact end-to-end). No live LLM in unit tests.
- i18n parity en+es; Svelte autofixer on the modal.

## Success criteria

- An admin opens the gallery `+` → **Generate** tab → enters title/icon + a prompt → submits → after a spinner, a generated artifact appears as a gallery tile and renders in a draggable window (themed, bound to the agent's live `vars`, via the sandboxed bridge).
- The generated bundle is stored (5a, org-scoped) and reuses the canonical bridge handshake (data loads through `hub.artifact.context.get`).
- Generation failure (LLM error / invalid output) returns a clear error; the modal surfaces it; nothing is stored.
- Manual **Paste HTML** still works. `bun run check` clean; pure-helper unit tests pass.
