# DB-Backed Dynamic Artifacts + Manual Create (Subsystem 5a)

**Date:** 2026-06-19
**Status:** Approved design — ready for implementation plan
**Scope:** Subsystem **5a** of the artifact-builder roadmap (#5). Add org-scoped,
DB-backed *dynamic* artifacts alongside the existing code-registered built-ins:
a storage table, an org-aware serving path, an async registry merge, and a
**manual admin create** path (name/icon/paste-an-HTML-bundle → stored → appears
in the agent's gallery, opening in the draggable windows). This is the
prerequisite for **5b** (the LLM artifact-builder, which will later replace the
manual paste with generation against the same storage) and **5c** (richer
request UX). Builds on the merged artifact foundation + the card gallery + the
draggable-windows feature.

## Context (verified)

- Built-in artifacts are **code-registered**: `getArtifactsForAgent(agentId)`
  (`src/lib/server/artifacts/registry.ts`) is **synchronous** and returns
  hard-coded descriptors (`overview`, and `triage` for `alert-watcher`). Bundles
  are served from a `BUNDLES` map of `?raw`-imported HTML in
  `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts` — a **ctx-free
  static** route gated only by `content-security-policy: frame-ancestors 'self'`.
- The roster load (`(app)/agents/autonomous/+page.server.ts`) and detail load
  (`[id]/+page.server.ts`) call `getArtifactsForAgent` to build `artifactsByAgent`
  / `artifacts`, which the gallery (`ArtifactGallery.svelte`, with an admin-only
  `+` stub) renders; tiles open in the draggable windows (`agentWindows`).
- `getArtifactContext(ctx, agentId, artifactId)` resolves an `ArtifactContext`;
  the artifact iframe fetches it through the gated `hub.artifact.context.get`
  bridge.
- The hub uses Postgres Drizzle schemas (`src/server/db/pg-*-schema.ts`) +
  Supabase migrations (`supabase/migrations/`) with **forced RLS** by `org_id`.
  `CoreCtx = { db, tenantId, profileId? }`.

## Decisions (confirmed)

- **Manual create is in 5a** — admin `+` opens a create form (title / icon /
  description / paste HTML bundle) → stored → appears in the gallery. 5a is thus
  independently useful and demonstrable end-to-end. 5b later swaps the manual
  paste for LLM generation against this same storage/serving.
- **Single-file HTML blob** stored as a `text` column (`entrypoint` always
  `index.html`, `kind` always `static`) — matches the built-in single-`index.html`
  pattern. Multi-file bundles are YAGNI.
- **DB descriptor id = the row uuid** (no prefix). The serving route + context
  resolver branch on "is this a known built-in id (`overview`/`triage`) → static,
  else → DB lookup by uuid". Uuids never collide with the built-in ids.
- **Org-aware serving** — the serving route resolves the session ctx and
  RLS-scopes the DB bundle fetch (404 if not owned), closing the route's current
  ctx-free gap.

## Architecture

### 1. Storage — `agent_artifacts` table

`src/server/db/pg-artifacts-schema.ts` (new Drizzle table) + a migration
`supabase/migrations/0004_agent_artifacts.sql`:

```
agent_artifacts(
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  agent_id     text not null,          -- the system/autonomous agent this artifact attaches to
  title        text not null,
  description  text not null default '',
  icon         text not null default 'LayoutDashboard',  -- a lucide name in PLUGIN_ICON_MAP (Puzzle fallback)
  html         text not null,          -- the self-contained bundle (served as index.html)
  created_by   text,                   -- profileId of the admin who created it
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
)
```
Indexed on `(org_id, agent_id)`. **Forced RLS** by `org_id` (mirrors the
existing hub org-scoped tables; the migration enables + forces RLS and adds the
org policy). Migration **applied to Supabase gxv** during implementation.

### 2. Store service — `src/lib/server/artifacts/store.ts`

Org-scoped CRUD (all take `CoreCtx`, RLS-enforced):
- `listArtifactRows(ctx, agentId): Promise<AgentArtifactRow[]>`
- `createArtifactRow(ctx, input: { agentId, title, description, icon, html }): Promise<AgentArtifactRow>` (sets `org_id = ctx.tenantId`, `created_by = ctx.profileId`)
- `getArtifactRow(ctx, id): Promise<AgentArtifactRow | null>` (for the serving route)
- `deleteArtifactRow(ctx, id): Promise<void>`
A pure mapper `artifactRowToDescriptor(row): ArtifactDescriptor` (id = row.id,
slot `'detail'`, kind `'static'`, entrypoint `'index.html'`) — unit-tested.

### 3. Registry — async merge

`getArtifactsForAgent` becomes **async** and ctx-taking:
`getArtifactsForAgent(ctx, agentId): Promise<ArtifactDescriptor[]>` = the built-in
descriptors (current logic) **+** `listArtifactRows(ctx, agentId).map(artifactRowToDescriptor)`.
`getArtifactContext(ctx, agentId, artifactId)`: built-in ids (`overview`/`triage`)
as today; otherwise (a uuid) → look up the row org-scoped, and if found return the
**base** `agentVmToArtifactContext(vm)` (DB artifacts get the standard context;
per-artifact data providers are 5b+). The two loads
(`+page.server.ts` roster + detail) `await` it (roster via `Promise.all` over
`systemAgents`), passing `requireCoreCtx(locals)`.

### 4. Serving route — org-aware

`src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts`: if `artifactId` is a
built-in (`overview`/`triage`) serve from `BUNDLES` (unchanged); else resolve
`requireCoreCtx(locals)` + `getArtifactRow(ctx, artifactId)` (RLS-scoped) and serve
`row.html` as `index.html` under the same `frame-ancestors 'self'` CSP +
`cache-control: no-store`; 404 if missing/not owned or `path !== 'index.html'`.
**Security:** the bundle is admin-authored and runs only inside the sandboxed,
same-origin-gated iframe (the existing artifact security model) — no server-side
HTML sanitization; isolation is the iframe + CSP, identical to built-ins.

### 5. Manual create API + UI

- **REST** under `src/routes/api/artifacts/` (admin-only, `requireCoreCtx` + admin
  check, org-scoped): `POST /api/artifacts` (create, body `{agentId,title,description,icon,html}`),
  `DELETE /api/artifacts/[id]` (delete). List is delivered via the page load (no
  separate GET needed).
- **UI:** the gallery `+` (admin-only, already gated by `canAdd`) opens an
  `ArtifactCreateModal.svelte` (reuses `ui/Modal`): inputs for title, description,
  an **icon picker** (a curated set of lucide names from `PLUGIN_ICON_MAP`), and a
  **textarea for the HTML bundle** (with a one-line hint linking the bridge
  contract). Submit → `POST` → `invalidate` the page load → the new artifact
  appears as a gallery tile (opens in a draggable window). Each DB tile gets a
  **delete** affordance for admins (small × / trash in the tile's popover) →
  `DELETE` → invalidate.

## Components & files

| File | Change |
|---|---|
| `src/server/db/pg-artifacts-schema.ts` | NEW — `agent_artifacts` Drizzle table |
| `supabase/migrations/0004_agent_artifacts.sql` | NEW — table + indexes + forced RLS (applied to gxv) |
| `src/lib/server/artifacts/store.ts` | NEW — org-scoped CRUD + `artifactRowToDescriptor` |
| `src/lib/server/artifacts/store.test.ts` | NEW — `artifactRowToDescriptor` unit tests |
| `src/lib/server/artifacts/registry.ts` | EDIT — `getArtifactsForAgent` async + DB merge; `getArtifactContext` DB branch (base context) |
| `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts` | EDIT — org-aware DB bundle serving |
| `src/routes/api/artifacts/+server.ts` | NEW — `POST` create (admin, org-scoped) |
| `src/routes/api/artifacts/[id]/+server.ts` | NEW — `DELETE` (admin, org-scoped) |
| `src/routes/(app)/agents/autonomous/+page.server.ts` | EDIT — `await Promise.all` async `getArtifactsForAgent(ctx, …)` |
| `src/routes/(app)/agents/autonomous/[id]/+page.server.ts` | EDIT — `await getArtifactsForAgent(ctx, …)` |
| `src/lib/components/artifacts/ArtifactGallery.svelte` | EDIT — `+` opens create modal; DB tiles get admin delete |
| `src/lib/components/artifacts/ArtifactCreateModal.svelte` | NEW — title/desc/icon/HTML create form |
| `src/lib/components/agents/AutonomousAgentCard.svelte` | EDIT — wire `+`/create + delete callbacks + `invalidate` |
| `messages/en.json`, `messages/es.json` | EDIT — create-form + delete labels |

## Out of scope (later)

- **5b** — the LLM artifact-builder (generation, the gw MCP, validation against
  the design contract); replaces the manual HTML paste.
- **5c** — richer request UX, build status/progress.
- Per-DB-artifact context **data providers** (DB artifacts get the base context in 5a).
- Multi-file bundles, versioning/history, edit-in-place (delete + recreate for now).
- Brain-agent artifacts (no brain card surface yet).

## Testing

- `store.ts`: `artifactRowToDescriptor` pure mapper unit-tested. CRUD is DB glue —
  verified by `bun run check` + live.
- Registry async merge + serving route: `bun run check` + live (built-ins still
  served; a created DB artifact serves + renders in a window; cross-org fetch 404s).
- API routes: admin-gating + org-scoping verified live.
- i18n parity en/es.

## Success criteria

- An admin clicks `+` on an autonomous agent's gallery, fills title/icon/description
  + pastes an HTML bundle, submits → the artifact appears as a gallery tile and
  opens in a draggable window rendering the pasted bundle (via the gated bridge).
- The artifact persists (DB), is **org-scoped** (another org cannot list or fetch
  it; the serving route 404s cross-org), and an admin can delete it.
- Built-in artifacts (`overview`, `triage`) are unchanged and still served.
- `bun run check` clean; the store mapper unit tests pass; migration applied to gxv.
