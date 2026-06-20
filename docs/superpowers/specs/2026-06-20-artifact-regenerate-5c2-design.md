# Regenerate / Iterate + Versions (Subsystem 5c.2)

**Date:** 2026-06-20
**Status:** Approved design (user selected all 5c + "build it") — ready for plan
**Scope:** Second of four 5c sub-projects. Let an admin **refine an existing
generated artifact** with a follow-up prompt (the builder takes the current bundle
+ the refinement → a new bundle, self-repairing via 5c.1), keeping **version
history** with revert. Builds on 5a (storage) + 5b.2 (builder) + 5c.1 (self-repair).

> 5c order: 5c.1 self-repair ✅ → **5c.2 regenerate/iterate + versions** → 5c.3 async + progress → 5c.4 builder-as-agent card.

## Context (verified)

- 5a: `agent_artifacts` (id, org_id, agent_id, title, description, icon, html, created_by, created_at, updated_at; forced RLS). Store (`src/lib/server/artifacts/store.ts`): `createArtifactRow`, `getArtifactRow`, `deleteArtifactRow`, `listArtifactRows`, `artifactRowToDescriptor`. Each artifact = one row; stable id = the serving URL (`/artifacts/<uuid>/ui/index.html`). DB descriptors carry `deletable: true`.
- 5b.2: `generateArtifactHtml(ctx, {agentId, prompt})` (`builder.ts`) — schema assembly + self-repairing OpenRouter generation. `buildBuilderPrompt`/`extractHtml`/`validateBundle`/`buildRepairPrompt` (`builder-prompt.ts`, pure).
- UI: DB artifacts appear as gallery tiles (`ArtifactGallery.svelte`, admin delete) + open in draggable windows. Create via `ArtifactCreateModal` (Generate/Paste).
- Tenancy: `withOrgCore` (RLS); migrations at meta-repo root (controller-applied to gxv); `requireAdmin`/`requireCoreCtx`.

## Decisions

1. **In-place update + revisions table** (not version-rows-in-a-group): the artifact keeps its **stable id/URL**; regenerate updates `agent_artifacts.html` in place (bump `version`), and the **prior** state is snapshotted into a new `agent_artifact_revisions` table first. Clean: serving/gallery unchanged, blobs live in a dedicated history table, full revert possible. (Per-version rows + grouping would churn the serving + listing for no gain.)
2. **Regenerate = current bundle + refinement** (not a from-scratch re-prompt): the builder is given the current HTML + "apply this change: …" so iteration is incremental. Reuses 5c.1's self-repair loop.
3. **Revert** snapshots the *current* state first (so revert is itself undoable), then restores a revision's html. History is capped (keep the latest **10** revisions per artifact; older pruned).
4. **The original prompt is remembered:** add `prompt text` to `agent_artifacts` (last prompt used) so regenerate has the original intent + revisions record each version's prompt.

## Architecture

### 1. Schema — `agent_artifacts.version`/`prompt` + `agent_artifact_revisions`

Migration (meta-repo root `…_artifact_revisions.sql`, forced RLS, → gxv):
- `alter table agent_artifacts add column version int not null default 1, add column prompt text;`
- `create table agent_artifact_revisions (id uuid pk default gen_random_uuid(), org_id text not null, artifact_id uuid not null references agent_artifacts(id) on delete cascade, version int not null, prompt text, html text not null, created_by text, created_at timestamptz not null default now())` + index `(org_id, artifact_id, version desc)` + grant app_ledger + enable/force RLS + `…_org_guc` policy. Drizzle schema `pg-artifact-revisions-schema.ts` (+ the 2 new columns added to `pg-artifacts-schema.ts`).

### 2. Store — `src/lib/server/artifacts/store.ts` (+ revisions in the same/ sibling module)

- `updateArtifactHtml(ctx, id, { html, prompt }): Promise<AgentArtifactRow>` — set html/prompt, `version = version + 1`, `updated_at = now()`; return the row (withOrgCore).
- `snapshotRevision(ctx, row): Promise<void>` — insert `{org_id, artifact_id: row.id, version: row.version, prompt: row.prompt, html: row.html, created_by}`; then prune to the latest 10 for that artifact.
- `listRevisions(ctx, artifactId): Promise<AgentArtifactRevisionRow[]>` (desc by version; html omitted from the list query for payload size — `{id, version, prompt, createdAt}`).
- `getRevision(ctx, revisionId): Promise<AgentArtifactRevisionRow | null>` (with html, for revert).
- `createArtifactRow` also stores the initial `prompt` (5b.2's generate passes it; manual paste passes none).

### 3. Builder — `src/lib/server/artifacts/builder.ts` + `builder-prompt.ts`

- `builder-prompt.ts`: add `buildRegeneratePrompt({ agent, schema, currentHtml, refinement, reference }): string` (pure, tested) — the base contract + agent + schema (as in `buildBuilderPrompt`) + a block: "Here is the CURRENT artifact. Apply this change and output the full updated HTML: {refinement}\n\nCURRENT:\n{currentHtml}".
- `builder.ts`: `regenerateArtifactHtml(ctx, { artifactId, refinement }): Promise<{ html: string; agentId: string }>` — load the row (`getArtifactRow`; throw if none), resolve the agent's schema (same as generate), `buildRegeneratePrompt(...)`, run the **same self-repair loop** (extract → validate → retry-with-feedback). Return new html + the row's agentId.

### 4. API — `src/routes/api/artifacts/[id]/...`

- `POST /api/artifacts/[id]/regenerate` (admin, org-scoped): body `{ refinement }` (400 if empty) → `regenerateArtifactHtml(ctx, {artifactId: id, refinement})` (502 on failure, nothing changed) → `snapshotRevision(ctx, currentRow)` → `updateArtifactHtml(ctx, id, { html, prompt: refinement })` → `json(artifactRowToDescriptor(updated))`.
- `GET /api/artifacts/[id]/revisions` (admin): `json(await listRevisions(ctx, id))`.
- `POST /api/artifacts/[id]/revert` (admin): body `{ revisionId }` → load the revision (`getRevision`, 404 if not in this org) + current row → `snapshotRevision(current)` → `updateArtifactHtml(ctx, id, { html: revision.html, prompt: revision.prompt })` → `json(descriptor)`.

### 5. UI — regenerate + history in the gallery tile / window

- `ArtifactGallery.svelte` (or the artifact window chrome): for `a.deletable && canAdd` DB tiles, the popover gains **Regenerate** + **History** actions (alongside Delete).
- **Regenerate** → a small `ArtifactRegenerateModal.svelte` (reuse `ui/Modal`): a refinement textarea + submit → `POST …/regenerate` with a generating spinner (self-repair may take longer) → on success `invalidateAll()` (the updated bundle reloads; the artifact window, if open, re-fetches). Inline error on failure.
- **History** → an `ArtifactHistory.svelte` panel (in the modal or window): lists revisions (version • prompt • relative time) with a **Revert** button each → `POST …/revert {revisionId}` → `invalidateAll()`.
- The artifact iframe is keyed so an `invalidateAll` after regenerate/revert remounts it with the new html (cache-control is already `no-store`).

## Components & files

| File | Change |
|---|---|
| `src/server/db/pg-artifacts-schema.ts` | EDIT — add `version`, `prompt` columns |
| `src/server/db/pg-artifact-revisions-schema.ts` | NEW — `agent_artifact_revisions` table |
| `supabase/migrations/<ts>_artifact_revisions.sql` | NEW (meta-repo root) — columns + revisions table + forced RLS (controller→gxv) |
| `src/lib/server/artifacts/store.ts` | EDIT — `updateArtifactHtml`, `snapshotRevision`(+prune 10), `listRevisions`, `getRevision`; `createArtifactRow` stores `prompt` |
| `src/lib/server/artifacts/store.test.ts` | EDIT — mapper still green; (revision row→view is pure if extracted) |
| `src/lib/server/artifacts/builder-prompt.ts` | EDIT — `buildRegeneratePrompt` (pure) |
| `src/lib/server/artifacts/builder-prompt.test.ts` | EDIT — `buildRegeneratePrompt` includes refinement + current + schema |
| `src/lib/server/artifacts/builder.ts` | EDIT — `regenerateArtifactHtml` (reuses self-repair loop) |
| `src/routes/api/artifacts/[id]/regenerate/+server.ts` | NEW — POST regenerate |
| `src/routes/api/artifacts/[id]/revisions/+server.ts` | NEW — GET revisions |
| `src/routes/api/artifacts/[id]/revert/+server.ts` | NEW — POST revert |
| `src/lib/components/artifacts/ArtifactRegenerateModal.svelte` | NEW — refinement prompt + submit |
| `src/lib/components/artifacts/ArtifactHistory.svelte` | NEW — revisions list + revert |
| `src/lib/components/artifacts/ArtifactGallery.svelte` | EDIT — Regenerate/History actions on DB tiles (admin) |
| `src/lib/components/agents/AutonomousAgentCard.svelte` | EDIT — wire the regenerate/history modals + `invalidateAll` |
| `messages/en.json`, `messages/es.json` | EDIT — regenerate/history/revert labels |

## Out of scope (later 5c)

- Async/progress for regenerate (5c.3 wraps both generate + regenerate). Builder-as-agent (5c.4). Diffing revisions; branching; manual-paste versioning (regenerate is for generated artifacts; paste edits replace).

## Testing

- Pure: `buildRegeneratePrompt` (refinement + current + schema keys). `validateBundle`/self-repair already tested (5c.1). (vitest)
- Store/API/UI: `bun run check` + live (regenerate updates in place + records a revision; revert restores; cross-org 404; prune keeps ≤10).
- i18n parity en/es; Svelte autofixer on new/edited `.svelte`.

## Success criteria

- An admin opens a generated artifact's actions → **Regenerate** → enters a refinement → after the spinner, the SAME artifact (stable id/window) shows the updated bundle; a revision was recorded.
- **History** lists prior versions (prompt + time); **Revert** restores one (and is itself undoable). Org-scoped; cross-org revisions 404.
- `bun run check` clean; pure unit tests pass; migration applied to gxv.
