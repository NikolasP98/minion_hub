# Turso ↔ Supabase data-layer split migration

**Status:** planned (recon complete 2026-06-05)
**Decision:** Turso = telemetry/monitoring sink (high write volume). Supabase = system of record (auth + all relational app data, RLS multi-tenancy).

## Why this split (provider eval summary)
- **Turso (libSQL/SQLite):** stateless HTTP (no connection exhaustion from many gateway writers), per-row pricing + cheap storage (fits append-only firehoses: `gateway_heartbeats` 89k, `unified_events` 55k), edge reads. Single-writer + no RLS + weak analytics — fine for append-only telemetry.
- **Supabase (Postgres):** MVCC concurrency, native RLS (org/tenant scoping by `auth.uid()`), bundled Auth/Realtime/Storage, full SQL — fits interactive relational app data.
- **Trade-off:** no cross-DB joins → telemetry rows must **denormalize keys** (agent_id, org_id, channel as plain columns) and correlate in-app. Two drivers, two backups.
- This **formalizes the existing de-facto split** (reliability/events already Turso; flows/messages/notes already Supabase).

## Target end-state
- `getDb()` → renamed conceptually to the **telemetry DB** (Turso/libSQL). Keeps: `gateway_heartbeats`, `unified_events`, `reliability_events`, `connection_events`, `agent_activity_bins`, `credential_health_snapshots`, `bugs`(?).
- **Supabase** (`@minion-stack/db/pg` + supabase client) = everything else.

## Table classification (cloud Turso 62 → target)
- **Stay Turso (telemetry, ~6):** gateway_heartbeats, unified_events, reliability_events, connection_events, agent_activity_bins, credential_health_snapshots.
- **Already in Supabase (skip):** flows, flow_groups, flow_runs, user_identities; servers→`gateway`, user_servers→`user_gateway`, member→`organization_members`, organization→`organizations`, user→`profiles`(+auth.users).
- **Covered by Supabase native `auth` (drop):** session→auth.sessions, account→auth.identities, verification→auth.one_time_tokens, jwks(n/a). Decide: oauth_access_token/oauth_application/oauth_consent (→ drop, Supabase OAuth), invitation (→ keep only if BA-style org invites wanted; else join_request covers).
- **MOVE to Supabase `public` (~37 app tables):** agents, agent_groups, agent_group_members, agent_built_skills, personal_agents, marketplace_agents, marketplace_installs, user_agents, built_agents, built_skills, built_skill_tools, built_agent_skills, built_tools, built_chapters, built_chapter_edges, built_chapter_tools, skills, skill_execution_stats, channels, channel_assignments, channel_identities, device_identities, server_backups, server_provision_configs, backup_configs, config_snapshots, sessions, session_tasks, tasks, missions, chat_messages, workshop_saves, files, workspace_membership, settings, user_preferences, roles, role_permissions.

## Porting rules (per `src/pg/schema/gateway.ts` precedent)
- `sqliteTable`→`pgTable`; `text('id').primaryKey()` stays text where ids are app strings, else `uuid().defaultRandom()`. Add `legacy_*_id text` bridge columns where Turso telemetry/log rows still carry old ids.
- `integer(mode:'timestamp')`→`timestamp(withTimezone:true)`; `integer(mode:'boolean')`→`boolean`; bare `integer`→`integer`/`bigint`.
- **FK remap:** `user`→`profiles.id`(uuid), `servers`→`gateway.id`(uuid), `organization`→`organizations.id`. References crossing into telemetry (Turso) become plain columns (no FK).
- RLS per existing pattern: `auth.uid()=profiles.id`, admin via `profiles.role='admin'`, org-scoped via `organization_members`.

## Phases
0. **Backup** — cloud Turso schema snapshot saved `minion_hub/.migration-backup/turso-schema.sql`; rely on Supabase PITR + Turso backups before mutations.
1. **Author PG schema** for the ~37 app tables in `packages/db/src/pg/schema/` (FK + legacy-id bridge). `pnpm db:pg:generate` → DDL.
2. **Apply DDL additively** to prod Supabase (tables don't exist → safe; live app still on Turso).
3. **Data migration** Turso→Supabase with **id remapping** (legacy user_id → profile uuid by email; server_id → gateway uuid by legacy_server_id). Small volumes (chat_messages 60, marketplace_agents 7, personal_agents 3, built_* ~70, prefs 13). Skip 145k telemetry rows.
4. **Build + release** `@minion-stack/db` (hub consumes published pkg, not local src) → bump + install in hub (+ site).
5. **Repoint hub services** from `@minion-stack/db/schema` (sqlite/getDb) → `/pg` + supabase client. Inventory: every `src/server/services/*` + `db/client.ts`. Tenancy `resolveUserTenant` → Supabase `organization_members` (retire `legacy_user_id`).
6. **Cutover + verify** — point `.env.local` (+ Vercel envs) ; verify login + tenancy + agents/flows/chat E2E. ⚠️ login blast radius.

## Done already (this session)
- Prod Supabase orgs: `organizations` + `organization_members` (RLS); 2 orgs **MINION** + **FACES SCULPTORS** (`21e0601b`), all 4 profiles in both.
- `organizations.service.ts` reads orgs from Supabase by `user.supabaseId` (no legacy bridge).
