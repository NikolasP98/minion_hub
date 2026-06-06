# Org-Scoping & Server-Side RLS Enforcement — Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make org the DB-enforced isolation boundary **for the hub server itself**, not just the direct-client surface — extend the proven `app_ledger`/`app.current_org_id` GUC mechanism (today only on `messages` + `agent_memories`) to every org-scoped Postgres table, and route every hub service through it so a forgotten `tenant_id` filter can no longer leak. Plus: org-share flows/workshop_saves, make `built_agents.tenant_id` required, fix the `listUsers` org leak, finish the Turso `legacy_user_id` cutover.

**Prod reality (verified 2026-06-06 via mcp__supabase against the hub project):**
- Canonical org id = `organizations.id` (**uuid**). `tenant_id` columns are uuid FKs to it. `21e0601b-f632-43fd-8414-d644af4271f4` = FACES SCULPTORS, `c9e8dc46-…` = MINION. Cross-store convergence ✅.
- **~Every org table ALREADY has an `auth.uid()` org policy:** `<table>_access: is_admin() OR EXISTS(organization_members om WHERE om.profile_id = auth.uid() AND om.organization_id = <table>.tenant_id)`. (Applied directly to prod by the migration agent — NOT in repo `supabase/migrations/`, which is why a file-based recon misses them.)
- **But only `messages` + `agent_memories` are `FORCE`d**, and the hub server connects via `SUPABASE_DB_URL` as the **`postgres` role (`rolbypassrls = true`)** → the hub server **bypasses every one of those policies**. Server-side isolation today = app-layer `tenant_id` filters only. The `auth.uid()` policies protect just the browser/PostgREST surface (anon/authenticated keys).
- `app_ledger` role exists (`nologin nobypassrls`), already granted to `postgres`.
- `flows` / `flow_groups` / `flow_runs`: RLS enabled, **zero policies** → fail-closed for clients, server-only today (a defense-in-depth gap, not a leak).
- `workshop_saves` policy = `profile_id = auth.uid() OR tenant_id IS NULL OR member-of-org` → *creator-private OR org*, not org-shared.

**Mechanism (how we close the server bypass — proven by `messages`/`agent_memories`):**
`withOrgCore(orgId, fn)` runs `fn` in a core-db transaction that does `SET LOCAL ROLE app_ledger` (a **non-bypass** role → RLS now applies even though the connection role is `postgres`) + `select set_config('app.current_org_id', orgId, true)`. For each table we add a **coexisting** GUC policy `<table>_org_guc: tenant_id::text = current_setting('app.current_org_id', true)` (permissive → OR'd with the existing `auth.uid()` policies, so the client surface is unaffected) + `grant ... to app_ledger` + `force row level security`. Then convert the owning service from `ctx.db.…` to `withOrgCore(ctx.tenantId, tx => tx.…)`.

**Why this is incrementally safe (no big-bang breakage):** adding a GUC policy + grant + force is **non-breaking** — `postgres` keeps bypassing (force doesn't affect a `rolbypassrls` role), so any not-yet-converted service keeps working. Converting one service at a time flips only that feature to enforced; if its GUC value were wrong it returns zero rows for *that feature only* — per-feature testable, never a global outage. The only true login-hot-path risk is in Phase 5/6 (user-scoped + Turso auth).

**Tech Stack:** SvelteKit (hub), Drizzle ORM (`postgres-js`), Supabase Postgres (RLS + GUC), `@minion-stack/db/pg`, hand-written SQL in `supabase/migrations/`, vitest.

**Convention (from `messages.service`):** unit-test pure transform helpers; verify the DB/RLS path with a live two-org isolation query (not a mocked unit test). `bun run check` (types) + `bun run test` must stay 0/0 / green.

---

## Locked decisions (product Q&A 2026-06-06)

| Decision | Choice |
|---|---|
| flows / workshop_saves | **Pure org-shared.** Visibility = org membership only. Drop the `profile_id=auth.uid()` and `tenant_id IS NULL` clauses. `profile_id` may remain as a non-authoritative created-by column. Backfill null `tenant_id` rows to an org (or archive). |
| agents | Gateway `agents` + builder `built_agents` org-scoped (make `built_agents.tenant_id` NOT NULL). `personal_agents` STAY user-scoped. |
| enforcement | **Close the server-side bypass (full).** `withOrgCore` + GUC policy + force on every org table; convert every hub service. |
| Turso | Cut over + scope together (cutover plan Stages 3–5) — last, gated. |

## Target scoping matrix

- **ORG-scoped, server enforced via `withOrgCore` (GUC policy + force + grant):** `sessions`, `session_tasks`, `missions`, `tasks`, `chat_messages`, `channels`, `channel_assignments`, `skills`, `settings`, `built_skills`, `built_agents`, `built_tools`, `built_chapters`, `built_chapter_edges`, `built_chapter_tools`, `built_skill_tools`, `built_agent_skills`, `agent_built_skills`, `marketplace_installs`, `files`, `agent_groups`, `agent_group_members`, `device_identities`, `config_snapshots`, `backup_configs`, `server_backups`, `server_provision_configs`, `skill_execution_stats`, `flows`, `flow_groups`, `flow_runs`, `workshop_saves`. (`messages`, `agent_memories` already done.)
- **USER-scoped (keep `auth.uid()` profile policy; do NOT add org GUC):** `user_preferences`, `personal_agents`, `user_identities`, `channel_identities`, `user_agents`, `workspace_membership`, `notes` (user+org).
- **GATEWAY/PROFILE-scoped (keep):** `gateway`, `user_gateway`.
- **GLOBAL (no tenant; keep):** `marketplace_agents`, `profiles`, `organizations`/`organization_members` (own auth.uid policies), `join_link`/`join_request`, Better-Auth tables.
- **Membership, not entity:** `listUsers` must filter by the active org via `organization_members` (currently returns all users — Phase 4).

## CRITICAL: `agent_group_members` and other child tables have no `tenant_id`

Use a parent-join GUC policy: `EXISTS(SELECT 1 FROM agent_groups g WHERE g.id = group_id AND g.tenant_id::text = current_setting('app.current_org_id', true))`. Same for `built_*` children (join to `built_skills`/`built_agents`/`built_chapters`). Confirm each child's FK column name against `@minion-stack/db/pg` before writing the policy.

---

## Phase 1 — Foundation + pilot (`agent_groups`) [login-safe]  ← THIS PHASE

### Task 1: `withOrgCore()` helper — DONE-CRITERIA: helper + passing unit test

**Files:** Create `minion_hub/src/server/db/with-org-core.ts`; Test `minion_hub/src/server/db/with-org-core.test.ts`.

- [ ] Write failing unit test: empty orgId throws; sets `app_ledger` role + `app.current_org_id` GUC inside the txn; returns fn result. (Mock `./pg-client` `getCoreDb` with a fake `transaction` that captures executed SQL.)
- [ ] Implement `withOrgCore` mirroring `withOrg` but on `getCoreDb()`.
- [ ] `bun run vitest run src/server/db/with-org-core.test.ts` → PASS.
- [ ] Commit `feat(hub): withOrgCore — RLS-scoped core-db txn helper`.

### Task 2: `agent_groups` GUC policy migration

**Files:** Create `supabase/migrations/<ts>_agent_groups_org_guc.sql`.

- [ ] Migration: grant app_ledger on `agent_groups` + `agent_group_members`; add `agent_groups_org_guc` (`tenant_id::text = current_setting('app.current_org_id', true)`, FOR ALL) and `agent_group_members_org_guc` (parent-join on `agent_groups.tenant_id`); `force row level security` on both. (Coexists with existing `admin_all`/`member_sel`.)
- [ ] Apply to local Supabase; two-org isolation check (set GUC to orgA → only orgA rows; bogus GUC → 0 rows).
- [ ] Commit.

### Task 3: Convert `agent-group.service.ts` to `withOrgCore`

**Files:** Modify `minion_hub/src/server/services/agent-group.service.ts`.

- [ ] Wrap every `ctx.db.…` op in `withOrgCore(ctx.tenantId, async (tx) => …)` (read+write). Keep existing `tenant_id`/`profile_id` filters (defense-in-depth). Keep `cached()` wrappers (withOrgCore goes inside the loader).
- [ ] `bun run check` → 0/0; `bun run test` → green.
- [ ] Commit `feat(hub): RLS-enforce agent_groups via withOrgCore (pilot)`.

### Task 4: CHECKPOINT — report; gate prod-DB apply

- [ ] Report pilot result. **Prod migration apply is gated:** the prod hub DB is the migration agent's domain — coordinate before applying any `*_org_guc.sql` to prod. Local-verified + committed is the autonomous boundary.

---

## Phase 2 — RLS rollout: operational tables [login-safe]
Repeat Phase-1 Task 2+3 per table/cluster. One migration + one service-conversion commit each.
- [ ] `sessions` (`session.service.ts`; keep gateway_id filter) · `session_tasks` · `missions` · `tasks` · `chat_messages`
- [ ] CHECKPOINT.

## Phase 3 — RLS rollout: config / plugins / builder [login-safe]
Plugin model holds: `skills` row = plugin existence (has gateway_id) → org GUC still scopes the row; `settings` = plugin settings (org+gateway). Keep gateway_id filters.
- [ ] `channels` + `channel_assignments` · `skills` · `settings`
- [ ] builder cluster (`built_skills`,`built_agents`,`built_tools`,`built_chapters`,`built_chapter_edges`,`built_chapter_tools`,`built_skill_tools`,`built_agent_skills`,`agent_built_skills`) — child tables use parent-join policies
- [ ] `marketplace_installs` (catalog `marketplace_agents` STAYS global — no GUC) · `files` · `device_identities` · `config_snapshots` · `backup_configs` · `server_backups` · `server_provision_configs` · `skill_execution_stats`
- [ ] CHECKPOINT.

## Phase 4 — flows/workshop org-shared + built_agents + users-list [login-safe]
- [ ] `flows`/`flow_groups`/`flow_runs`: add `*_org_guc` policies + grant + force; convert the flows routes/loader to `withOrgCore` scoped by org only; backfill null `tenant_id`. **Org-shared** (no profile gating).
- [ ] `workshop_saves`: replace `member_sel` with pure org membership (drop `profile_id`/`tenant_id IS NULL`); add `*_org_guc`; convert service.
- [ ] `built_agents.tenant_id` → NOT NULL (backfill/clean nulls first); service always supplies it.
- [ ] `listUsers` (`user.service.ts`): derive visible users from `organization_members` for `ctx.tenantId`; add exclusion test.
- [ ] CHECKPOINT.

## Phase 5 — user-scoped tables [mild login exposure — verify]
These already have correct `auth.uid()` profile policies and are read server-side via bypass. Decision: leave their server reads on bypass+app-filter (they're inherently user-keyed, low cross-tenant risk) OR add a `withProfile` GUC mechanism. Default: **leave as-is**, just confirm policies + `force` where warranted. Revisit only if audit demands.
- [ ] Confirm `user_preferences`, `user_identities`, `channel_identities`, `personal_agents`, `notes` policies are correct + sufficient.
- [ ] CHECKPOINT.

## Phase 6 — Turso cutover Stages 3–5 [PRODUCTION LOGIN — gated]
= `docs/2026-06-05-turso-legacy-cutover-plan.md` Stages 3–5. Do NOT start autonomously. Requires migration-agent coordination + a user-performed prod login smoke test.
- [ ] Stage 3 gateway-token re-home · Stage 4 remaining `getDb` app data → Supabase+withOrgCore · Stage 5 (IRREVERSIBLE) drop `legacy_user_id` + Turso auth tables.
- [ ] Done: `grep legacy` non-tenant only; `grep getDb|@libsql` telemetry only; one tenant id everywhere; full E2E.

---

## Task 0 results (verified 2026-06-06)
- organizations.id = **uuid**; tenant_id columns uuid; GUC comparison = `tenant_id::text = current_setting('app.current_org_id', true)` (text compare → empty/unset GUC fails closed safely).
- `app_ledger` exists, `nologin nobypassrls`, granted to postgres. `postgres` & `service_role` = `rolbypassrls=true` (this is the bypass being closed).
- Only `messages`+`agent_memories` forced today. Convergence gate: **PASS**.
