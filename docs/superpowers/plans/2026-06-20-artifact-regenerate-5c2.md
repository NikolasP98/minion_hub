# Regenerate / Iterate + Versions (5c.2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Refine an existing generated artifact with a follow-up prompt (in-place update, self-repairing) + version history with revert.

**Architecture:** `version`/`prompt` columns on `agent_artifacts` + an `agent_artifact_revisions` table; store update/snapshot/list/get; a `regenerateArtifactHtml` builder path (reuses 5c.1 self-repair); 3 API routes; regenerate modal + history panel.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TS, Drizzle (gxv), `withOrgCore` RLS, Vercel AI SDK, Paraglide, Vitest, Bun. Hub, branch `dev`.

## Global Constraints

- Svelte 5 runes; TS strict, no `any`; i18n BOTH locales + `bun run i18n:compile` before check; `bun run check` 0/0; tests green. Commits UNSIGNED; no lockfile/sdd in commits. Svelte autofixer on `.svelte`.
- Tenancy: all DB via `withOrgCore({db:getCoreDb(),tenantId:ctx.tenantId},fn)` (RLS) + explicit `org_id`/owner predicates; write APIs `requireAdmin`+`requireCoreCtx`. **Migration → prod gxv by the controller** (T1 hand-off).

## Reference: verified shapes

- `pg-artifacts-schema.ts`: `agentArtifacts` (id uuid, orgId, agentId, title, description, icon, html, createdBy, createdAt, updatedAt); `AgentArtifactRow`. Store (`src/lib/server/artifacts/store.ts`): `createArtifactRow(ctx,{agentId,title,description,icon,html})`, `getArtifactRow(ctx,id)`, `deleteArtifactRow(ctx,id)`, `listArtifactRows`, `artifactRowToDescriptor(row)` (id=row.id, deletable:true). `scope(ctx)={db:getCoreDb(),tenantId:ctx.tenantId}`. Drizzle `eq,and,desc` from `drizzle-orm`.
- `builder.ts`: `generateArtifactHtml`; self-repair loop (MAX_ATTEMPTS=3) calling `attempt(prompt)`→`validateBundle`→`buildRepairPrompt`. `builder-prompt.ts` (pure): `buildBuilderPrompt({agent,schema,userPrompt,reference})`, `extractHtml`, `validateBundle`, `buildRepairPrompt`. `getSystemAgentDescriptors`, `getMasterFlow`+`flowExportedSpecs`, `flowVariableSchema`, `listExportToggles`, `overviewHtml?raw` — as used in `generateArtifactHtml`.
- Migration pattern: meta-repo root `supabase/migrations/<ts>_*.sql` (grant app_ledger + enable/force RLS + `<table>_org_guc` policy); `agent_artifacts` migration `20260619190000_agent_artifacts.sql` is the template.
- `requireAdmin`($server/auth/authorize), `requireCoreCtx`($server/auth/core-ctx), CoreCtx{db,tenantId,profileId?}. `invalidateAll` from `$app/navigation`.
- `ArtifactGallery.svelte`: DB tiles in a Popover with admin Delete (`a.deletable && canAdd`, `ondelete`). `AutonomousAgentCard.svelte` owns the create modal + `invalidateAll` on delete.

---

### Task 1: Schema — version/prompt + revisions table

**Files:** Modify `src/server/db/pg-artifacts-schema.ts`; Create `src/server/db/pg-artifact-revisions-schema.ts`; Create (META-REPO ROOT) `/home/nikolas/Documents/CODE/MINION/supabase/migrations/20260620140000_artifact_revisions.sql`.

**Interfaces — Produces:** `agentArtifacts` gains `version`,`prompt`; `agentArtifactRevisions` table + `AgentArtifactRevisionRow`.

- [ ] **Step 1: Columns** — in `pg-artifacts-schema.ts` add to the table: `version: integer('version').notNull().default(1),` and `prompt: text('prompt'),`. (Import `integer` from `drizzle-orm/pg-core` if not already.)

- [ ] **Step 2: Revisions table** — `pg-artifact-revisions-schema.ts`:
```ts
import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { agentArtifacts } from './pg-artifacts-schema';

export const agentArtifactRevisions = pgTable(
  'agent_artifact_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    artifactId: uuid('artifact_id').notNull().references(() => agentArtifacts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    prompt: text('prompt'),
    html: text('html').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ idx: index('agent_artifact_revisions_org_artifact_idx').on(t.orgId, t.artifactId, t.version) }),
);
export type AgentArtifactRevisionRow = typeof agentArtifactRevisions.$inferSelect;
```

- [ ] **Step 3: Migration** (absolute meta-repo path):
```sql
alter table public.agent_artifacts add column if not exists version int not null default 1;
alter table public.agent_artifacts add column if not exists prompt text;

create table if not exists public.agent_artifact_revisions (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  artifact_id uuid not null references public.agent_artifacts(id) on delete cascade,
  version     int not null,
  prompt      text,
  html        text not null,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists agent_artifact_revisions_org_artifact_idx on public.agent_artifact_revisions (org_id, artifact_id, version);
grant select, insert, update, delete on public.agent_artifact_revisions to app_ledger;
alter table public.agent_artifact_revisions enable row level security;
alter table public.agent_artifact_revisions force row level security;
create policy agent_artifact_revisions_org_guc on public.agent_artifact_revisions
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
```

- [ ] **Step 4: Verify + commit** — `bun run check` 0. Commit ONLY the hub schema files:
```bash
git add src/server/db/pg-artifacts-schema.ts src/server/db/pg-artifact-revisions-schema.ts
git -c commit.gpgsign=false commit -m "feat(artifacts): version/prompt columns + agent_artifact_revisions table"
```

> **CONTROLLER HAND-OFF:** commit the migration in the meta-repo + apply to **gxv** (`mcp__supabase__apply_migration`), verify forced RLS on the new table + the 2 new columns, before T2's live use.

---

### Task 2: Store — update + revisions

**Files:** Modify `src/lib/server/artifacts/store.ts`.

**Interfaces — Produces:** `updateArtifactHtml(ctx,id,{html,prompt}):Promise<AgentArtifactRow>`; `snapshotRevision(ctx,row):Promise<void>` (prune to 10); `listRevisions(ctx,artifactId):Promise<Array<{id,version,prompt,createdAt}>>`; `getRevision(ctx,revisionId):Promise<AgentArtifactRevisionRow|null>`. `createArtifactRow` also persists `prompt`.

- [ ] **Step 1: Implement** — in `store.ts` (import `agentArtifactRevisions, AgentArtifactRevisionRow` from `$server/db/pg-artifact-revisions-schema`; ensure `and,eq,desc` imported):
```ts
export function updateArtifactHtml(ctx: CoreCtx, id: string, input: { html: string; prompt?: string | null }): Promise<AgentArtifactRow> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx.update(agentArtifacts)
      .set({ html: input.html, prompt: input.prompt ?? null, version: sql`${agentArtifacts.version} + 1`, updatedAt: new Date() })
      .where(and(eq(agentArtifacts.id, id), eq(agentArtifacts.orgId, ctx.tenantId)))
      .returning();
    return rows[0];
  });
}

export function snapshotRevision(ctx: CoreCtx, row: AgentArtifactRow): Promise<void> {
  return withOrgCore(scope(ctx), async (tx) => {
    await tx.insert(agentArtifactRevisions).values({
      orgId: ctx.tenantId, artifactId: row.id, version: row.version, prompt: row.prompt, html: row.html, createdBy: ctx.profileId ?? null,
    });
    // prune: keep the latest 10 revisions per artifact. Versions are contiguous
    // (each snapshot is the then-current version), so a threshold delete suffices.
    await tx.delete(agentArtifactRevisions)
      .where(and(
        eq(agentArtifactRevisions.orgId, ctx.tenantId),
        eq(agentArtifactRevisions.artifactId, row.id),
        lte(agentArtifactRevisions.version, row.version - 10),
      ));
  });
}

export function listRevisions(ctx: CoreCtx, artifactId: string): Promise<Array<{ id: string; version: number; prompt: string | null; createdAt: Date }>> {
  return withOrgCore(scope(ctx), (tx) =>
    tx.select({ id: agentArtifactRevisions.id, version: agentArtifactRevisions.version, prompt: agentArtifactRevisions.prompt, createdAt: agentArtifactRevisions.createdAt })
      .from(agentArtifactRevisions)
      .where(and(eq(agentArtifactRevisions.orgId, ctx.tenantId), eq(agentArtifactRevisions.artifactId, artifactId)))
      .orderBy(desc(agentArtifactRevisions.version)));
}

export function getRevision(ctx: CoreCtx, revisionId: string): Promise<AgentArtifactRevisionRow | null> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx.select().from(agentArtifactRevisions)
      .where(and(eq(agentArtifactRevisions.id, revisionId), eq(agentArtifactRevisions.orgId, ctx.tenantId))).limit(1);
    return rows[0] ?? null;
  });
}
```
Add `lte` + `sql` to the `drizzle-orm` import (alongside the existing `eq,and,desc`). In `createArtifactRow`, add `prompt: input.prompt ?? null` to the insert values and `prompt?: string | null` to its input type (so 5b.2's generate can pass the prompt; manual paste passes none).

- [ ] **Step 2: Verify + commit** — `bun run check` 0; `bun run test -- src/lib/server/artifacts/store.test.ts` green.
```bash
git add src/lib/server/artifacts/store.ts
git -c commit.gpgsign=false commit -m "feat(artifacts): updateArtifactHtml + snapshotRevision(prune 10) + list/getRevision"
```

---

### Task 3: Builder — regenerate path

**Files:** Modify `src/lib/server/artifacts/builder-prompt.ts`, `builder-prompt.test.ts`, `builder.ts`.

**Interfaces — Produces:** `buildRegeneratePrompt({agent,schema,currentHtml,refinement,reference}):string`; `regenerateArtifactHtml(ctx,{artifactId,refinement}):Promise<{html,agentId}>`.

- [ ] **Step 1: Failing test** — append to `builder-prompt.test.ts`:
```ts
import { buildRegeneratePrompt } from './builder-prompt';
describe('buildRegeneratePrompt', () => {
  it('includes the refinement, the current html, and a schema key', () => {
    const p = buildRegeneratePrompt({ agent: { name: 'Reminders', role: 'r', trigger: 't' }, schema: [{ key: 'reminders.sent', type: 'int', label: 'Sent' }], currentHtml: '<html>CUR</html>', refinement: 'make it a bar chart', reference: '<!doctype html>' });
    expect(p).toContain('make it a bar chart');
    expect(p).toContain('<html>CUR</html>');
    expect(p).toContain('reminders.sent');
  });
});
```

- [ ] **Step 2: Run red** — `bun run test -- src/lib/server/artifacts/builder-prompt.test.ts` → FAIL.

- [ ] **Step 3: Implement prompt** — in `builder-prompt.ts`, add (reuse the same contract/variable block buildBuilderPrompt produces — factor a shared `contractBlock(agent, schema, reference)` if clean, else inline):
```ts
export function buildRegeneratePrompt(args: {
  agent: { name: string; role: string; trigger: string };
  schema: VariableSpec[];
  currentHtml: string;
  refinement: string;
  reference: string;
}): string {
  const base = buildBuilderPrompt({ agent: args.agent, schema: args.schema, userPrompt: `Refine the existing artifact: ${args.refinement}`, reference: args.reference });
  return [
    base,
    '',
    'You are EDITING an existing artifact, not starting over. Apply this change and output the FULL updated HTML document:',
    args.refinement,
    '',
    'CURRENT ARTIFACT:',
    args.currentHtml,
  ].join('\n');
}
```

- [ ] **Step 4: Implement builder** — in `builder.ts`, factor the self-repair loop into a reusable inner (or duplicate minimally) and add:
```ts
export async function regenerateArtifactHtml(
  ctx: CoreCtx,
  args: { artifactId: string; refinement: string },
): Promise<{ html: string; agentId: string }> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('artifact builder unavailable: OPENROUTER_API_KEY not set');
  const row = await getArtifactRow(ctx, args.artifactId);
  if (!row) throw new Error('artifact not found');
  const desc = getSystemAgentDescriptors().find((d) => d.id === row.agentId);
  const flow = desc?.flowId ? getMasterFlow(desc.flowId) : undefined;
  const specs = flow ? flowExportedSpecs(flow) : [];
  const toggles = desc?.flowId ? await listExportToggles(ctx, desc.flowId).catch(() => ({})) : {};
  const schema = flowVariableSchema(specs, toggles);
  const base = buildRegeneratePrompt({
    agent: { name: desc?.name ?? row.agentId, role: desc?.role ?? '', trigger: desc?.trigger ?? '' },
    schema, currentHtml: row.html, refinement: args.refinement, reference: overviewHtml,
  });
  const html = await runBuildLoop(apiKey, base); // the self-repair loop, extracted
  return { html, agentId: row.agentId };
}
```
Extract the loop from `generateArtifactHtml` into `async function runBuildLoop(apiKey: string, basePrompt: string): Promise<string>` (the `MAX_ATTEMPTS` attempt→validate→repair loop) and call it from BOTH `generateArtifactHtml` and `regenerateArtifactHtml`. Add `getArtifactRow` + `buildRegeneratePrompt` imports.

- [ ] **Step 5: Verify + commit** — test PASS; `bun run check` 0.
```bash
git add src/lib/server/artifacts/builder-prompt.ts src/lib/server/artifacts/builder-prompt.test.ts src/lib/server/artifacts/builder.ts
git -c commit.gpgsign=false commit -m "feat(builder): regenerateArtifactHtml + buildRegeneratePrompt (reuses self-repair loop)"
```

---

### Task 4: API — regenerate / revisions / revert

**Files:** Create `src/routes/api/artifacts/[id]/regenerate/+server.ts`, `…/[id]/revisions/+server.ts`, `…/[id]/revert/+server.ts`.

> No unit test (route glue); admin-gating + org-scope verified live.

- [ ] **Step 1: regenerate** — `[id]/regenerate/+server.ts`:
```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { regenerateArtifactHtml } from '$lib/server/artifacts/builder';
import { getArtifactRow, snapshotRevision, updateArtifactHtml, artifactRowToDescriptor } from '$lib/server/artifacts/store';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as { refinement?: string } | null;
  if (!body?.refinement) throw error(400, 'refinement required');
  const current = await getArtifactRow(ctx, params.id);
  if (!current) throw error(404, 'artifact not found');
  let html: string;
  try { ({ html } = await regenerateArtifactHtml(ctx, { artifactId: params.id, refinement: body.refinement })); }
  catch (e) { throw error(502, `regeneration failed: ${(e as Error).message}`); }
  await snapshotRevision(ctx, current);
  const updated = await updateArtifactHtml(ctx, params.id, { html, prompt: body.refinement });
  return json(artifactRowToDescriptor(updated));
};
```

- [ ] **Step 2: revisions** — `[id]/revisions/+server.ts`: `GET` → requireAdmin + requireCoreCtx → `json(await listRevisions(ctx, params.id))`.

- [ ] **Step 3: revert** — `[id]/revert/+server.ts`: `POST` body `{revisionId}` → requireAdmin + requireCoreCtx → `const rev = await getRevision(ctx, body.revisionId)` (404 if null) → guard `rev.artifactId === params.id` (400 else) → `const current = await getArtifactRow(ctx, params.id)` (404 if null) → `await snapshotRevision(ctx, current)` → `const updated = await updateArtifactHtml(ctx, params.id, { html: rev.html, prompt: rev.prompt })` → `json(artifactRowToDescriptor(updated))`.

- [ ] **Step 4: Verify + commit** — `bun run check` 0.
```bash
git add "src/routes/api/artifacts/[id]/regenerate/+server.ts" "src/routes/api/artifacts/[id]/revisions/+server.ts" "src/routes/api/artifacts/[id]/revert/+server.ts"
git -c commit.gpgsign=false commit -m "feat(artifacts): regenerate / revisions / revert API (admin, org-scoped)"
```

---

### Task 5: UI — regenerate modal + history + gallery actions

**Files:** Create `src/lib/components/artifacts/ArtifactRegenerateModal.svelte`, `ArtifactHistory.svelte`; Modify `ArtifactGallery.svelte`, `AutonomousAgentCard.svelte`, `messages/en.json`, `messages/es.json`.

- [ ] **Step 1: i18n** — both locales: `artifact_regenerate` ("Regenerate"/"Regenerar"), `artifact_regenerate_prompt` ("What should change?"/"¿Qué debe cambiar?"), `artifact_regenerate_loading` ("Regenerating…"/"Regenerando…"), `artifact_history` ("History"/"Historial"), `artifact_revert` ("Revert"/"Revertir"), `artifact_history_empty` ("No previous versions"/"Sin versiones previas"), `artifact_version` ("v{n}"/"v{n}").

- [ ] **Step 2: ArtifactRegenerateModal.svelte** — props `{ open=$bindable, artifactId, ondone }`; a refinement `<textarea>` + submit (disabled unless non-empty) → `generating` $state → `POST /api/artifacts/${artifactId}/regenerate` `{refinement}` (Spinner + `artifact_regenerate_loading`); on ok → `ondone()` + close + reset; on error → inline message. ui/Modal, runes.

- [ ] **Step 3: ArtifactHistory.svelte** — props `{ open=$bindable, artifactId, onreverted }`; on open, `GET /api/artifacts/${artifactId}/revisions` → list rows (`artifact_version {n}` • prompt • relative time) each with a **Revert** button → `POST …/revert {revisionId}` → `onreverted()` + refetch; empty → `artifact_history_empty`. ui/Modal, runes.

- [ ] **Step 4: Gallery actions** — `ArtifactGallery.svelte`: for `a.deletable && canAdd` tiles, add **Regenerate** + **History** buttons in the tile Popover (next to Delete) → new optional props `onregenerate?: (a) => void`, `onhistory?: (a) => void`.

- [ ] **Step 5: Card wiring** — `AutonomousAgentCard.svelte`: `let regenFor = $state<ArtifactDescriptor|null>(null)`, `let historyFor = $state<ArtifactDescriptor|null>(null)`; gallery `onregenerate={(a)=>regenFor=a}` / `onhistory={(a)=>historyFor=a}`; render `<ArtifactRegenerateModal open={!!regenFor} artifactId={regenFor?.id ?? ''} ondone={() => { regenFor=null; invalidateAll(); }} />` (+ bind/close handling) and the same for history with `onreverted={() => invalidateAll()}`. Use `{#if regenFor}`/`{#if historyFor}` guards.

- [ ] **Step 6: Validate + verify** — Svelte autofixer on the 2 new + 2 edited `.svelte`; `bun run i18n:compile && bun run check` 0.

- [ ] **Step 7: Commit**
```bash
git add src/lib/components/artifacts/ArtifactRegenerateModal.svelte src/lib/components/artifacts/ArtifactHistory.svelte src/lib/components/artifacts/ArtifactGallery.svelte src/lib/components/agents/AutonomousAgentCard.svelte messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(artifacts): regenerate modal + history/revert panel + gallery actions"
```

---

### Task 6: Full verification

- [ ] **Step 1:** `bun run i18n:compile && bun run check` → 0/0; `bun run test` → green (builder-prompt + store tests pass; no NEW failures).
- [ ] **Step 2: Live (best-effort, needs key + migration applied)** — regenerate a generated artifact (refinement) → same id/window shows the update + a revision recorded; History lists it; Revert restores; cross-org revision 404. If no instance, note deferred.
- [ ] **Step 3:** Commit any fixes.

---

## Self-Review

**Spec coverage:** version/prompt cols + revisions table + migration (T1) ✓; store update/snapshot(prune10)/list/get + createArtifactRow prompt (T2) ✓; `buildRegeneratePrompt` (pure, tested) + `regenerateArtifactHtml` reusing the extracted self-repair loop (T3) ✓; regenerate/revisions/revert API admin+org-scoped, snapshot-before-update, revert-snapshots-current, cross-org 404 (T4) ✓; regenerate modal + history/revert panel + gallery actions + card wiring + invalidateAll (T5) ✓; in-place update keeps stable id/URL ✓; i18n en/es (T5) ✓. Out-of-scope (async, builder-as-agent) absent.

**Placeholder scan:** none — complete code. T3's "extract `runBuildLoop`" is a concrete refactor (the loop already exists in `generateArtifactHtml`), reused by both paths.

**Type consistency:** `updateArtifactHtml`/`snapshotRevision`/`listRevisions`/`getRevision` (T2) consumed by the API (T4). `regenerateArtifactHtml(ctx,{artifactId,refinement})` (T3) consumed by the regenerate route (T4). `buildRegeneratePrompt` (T3) uses `VariableSpec`. `AgentArtifactRevisionRow` (T1) used in store (T2). Revisions migration columns (T1) match the Drizzle schema. `artifactRowToDescriptor` returns the updated row's descriptor (same id) so the gallery/window reload the new html on `invalidateAll`.
