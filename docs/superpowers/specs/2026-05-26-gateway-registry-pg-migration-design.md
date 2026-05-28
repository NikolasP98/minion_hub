# Gateway Registry → Supabase Postgres Migration — Design

**Date:** 2026-05-26
**Project:** `minion_hub` (+ `@minion-stack/db` PG schema, repo-root `supabase/migrations`)
**Status:** Design — approved, awaiting written-spec review before implementation plan

---

## Goal

Migrate the relational-core server/gateway tables from Turso to Supabase Postgres, re-keyed to `profiles.id`, so that: (a) each user's gateway credentials (URL + token) are pulled per-user from the database, and (b) admins can add/link gateways from a Settings page. High-throughput log/event tables stay in Turso (per the "PG-first, Turso for logs/events" rule). The migration uses a strangler-fig, per-table cutover to protect live production data.

## Why

- The Plugins nav section is empty because `/api/plugins/ui-list` resolves the gateway via `getSystemGatewayCredentials` (oldest server system-wide, env fallback) — not the connecting user's linked gateway.
- The user↔gateway link (`user_servers`) and credentials (`servers.token`) currently live in Turso; the target architecture puts the relational core in Supabase Postgres keyed to `profiles.id`, consistent with the broader auth/Supabase direction.

## Non-goals

- Migrating the high-throughput log/event tables (they stay in Turso).
- Changing the gateway's own internal data model (this is the hub's registry/cache of gateways, not the gateway runtime).

---

## Scope: table set

**→ Postgres (15 relational-core tables):**
`gateway` (renamed from `servers`), `user_gateway` (renamed from `user_servers`), `agents`, `user_agents`, `personal_agents`, `sessions`, `session_tasks`, `missions`, `skills`, `channels`, `settings`, `server_backups`, `server_provision_configs`, `builder`, `marketplace_installs`.

**Stay in Turso (~9 log/event tables):**
`connection_events`, `unified_events`, `activity_bins`, `gateway_heartbeats`, `reliability_events`, `credential_health`, `skill_execution_stats`, `config_snapshots`, `chat_messages`.

Turso event rows reference the PG gateway by id **cross-DB (no FK)** — the same pattern the join tables already use.

---

## Architecture

### A. Keys & ID remapping

- Every migrated row gets a **new `uuid` primary key** (`gen_random_uuid()` default for new rows; backfill assigns uuids deterministically).
- Every `user_id` column becomes `profile_id uuid REFERENCES profiles(id)`, resolved during backfill via `profiles.legacy_user_id` reverse-lookup (old Better-Auth/bridged text id → profile uuid). Rows whose user has no profile are skipped and logged.
- A backfill-time map `old_text_id → new_uuid` (per table, held in the migration script) rewrites all intra-PG foreign keys as rows are inserted.
- `gateway.legacy_server_id text` preserves the old Turso `servers.id` so Turso event rows (which still carry the old serverId) can join to the new gateway until their own future migration.

### B. user_gateway link + credential resolution

- `gateway`: `id uuid pk`, `legacy_server_id text`, `name text`, `url text`, `token_ciphertext text`, `token_iv text`, `created_at`, `updated_at`. Token sealed with the existing AES-GCM envelope (`@minion-stack/db` `sealSecret`/`openSecret`, as `user_identities` does).
- `user_gateway`: `profile_id uuid → profiles(id)`, `gateway_id uuid → gateway(id)`, `role text`, `is_default boolean`, `created_at`. PK `(profile_id, gateway_id)`.
- New resolver `getUserGatewayCredentials(profileId)` (PG): returns the user's default (or first) linked gateway `{ url, token }`, decrypting via `openSecret`. `gateway-rpc.ts` `resolveCredentials()` calls this with the connecting user's `profiles.id`; the old `getSystemGatewayCredentials` (oldest-server) becomes a fallback only when no user context exists (e.g. metrics push). Env vars (`MINION_GATEWAY_URL`/`OPENCLAW_GATEWAY_TOKEN`) remain a last-resort bootstrap.

### C. Data layer split

- `getCoreDb()` → Drizzle **Postgres** client (Supavisor pooler, `prepare: false`) for the 15 core tables.
- `getEventsDb()` → existing **Turso** client for the log/event tables (alias of today's `getDb()`).
- PG schemas live in `@minion-stack/db/pg/schema/<table>.ts`; migrations authored via `drizzle.pg.config.ts` → repo-root `supabase/migrations`.
- Services import `getCoreDb`/`getEventsDb` per the table they touch; during transition a per-table flag selects the read source (see D).

### D. Strangler-fig cutover (per table)

Order: `gateway` + `user_gateway` first (they unblock resolution + Settings UI), then leaf tables in dependency order. For each table:
1. **Create** the PG table (+ RLS) via migration.
2. **Backfill** Turso→PG (assign uuids via the map, remap FKs + user_id→profile_id).
3. **Dual-write**: writes go to both Turso and PG (PG is authoritative-in-waiting).
4. **Flip reads** to PG behind a per-table flag `MIGRATE_<TABLE>=pg` (default `turso`).
5. **Verify** (row counts, spot-checks, app smoke).
6. **Stop Turso writes**; Turso copy becomes read-only legacy.
Each step is independently reversible (flip the flag back). No downtime.

### E. Settings → "Gateways" admin page

- Route `(app)/settings/gateways/` (gated `users.manage`). Lists gateways (name, url, linked-user count, default), add (name/url/token → sealed), assign/unassign users, set per-user default, revoke.
- API: `/api/gateways` (GET list, POST create), `/api/gateways/[id]` (PATCH/DELETE), `/api/gateways/[id]/links` (POST assign user, DELETE unassign). All `requireAdmin`.
- Reuses the existing `HostsOverlay` add-form patterns where practical; the host-pill dropdown continues to work (now reading PG).

### F. RLS

RLS on all 15 PG core tables (defense-in-depth; the hub server uses the service-role key and bypasses these — app-layer scoping via `getCoreDb` queries + `requireAdmin`/per-user filters is the enforcement). Baseline policies: a user can select rows for gateways they're linked to (via `user_gateway`); admins (`profiles.role = 'admin'`) select/write all. `gateway`/`user_gateway` write policies: admin-only.

---

## Data flow (post-migration)

```
connecting user (profiles.id) → getUserGatewayCredentials(profileId) [PG gateway ⋈ user_gateway]
  → {url, openSecret(token)} → gateway-rpc WS handshake → /api/plugins/ui-list etc.
admin → Settings/Gateways → /api/gateways → gateway + user_gateway (PG)
Turso event write → references gateway.legacy_server_id (cross-DB, no FK)
```

## Error handling & rollback

- Backfill is idempotent (upsert on `legacy_*` natural keys); re-runnable.
- A user with no profile (`legacy_user_id` unmatched) → row skipped + logged; surfaced in a backfill report.
- Per-table flag flip-back is the rollback (reads return to Turso; dual-write kept both in sync).
- Credential resolution: no linked gateway → clear error ("no gateway linked to your account") instead of the opaque system fallback.

## Testing

- Pure: id-map remap, `user_id→profile_id` resolution, `getUserGatewayCredentials` (default selection, decryption), sealed-token round-trip.
- Per-table migration tests: backfill correctness (counts + FK integrity on an in-memory/seeded fixture), dual-write parity, flag-driven read source.
- RLS smoke tests (linked user vs other vs admin).
- Settings/Gateways route + API tests (admin gate, create/seal, assign).
- E2E: link a gateway to a user → that user's `/api/plugins/ui-list` resolves it → Plugins section appears.

## Open risks (acknowledged)

- New-uuid + `profiles.id` re-keying is the heaviest option: every FK and user reference remaps across 15 tables on live prod data. The strangler-fig flags + idempotent backfill maps are the mitigation.
- Cross-DB references (Turso events → PG gateway) have no FK integrity; the `legacy_server_id` bridge is the join key until events migrate too.
- Dual-write doubles write paths during transition — must be removed promptly after each table flips.

## Sequencing (waves, detailed in the plan)

1. PG `gateway` + `user_gateway` + resolver + `getCoreDb()` + Settings/Gateways UI (delivers the user-facing goal).
2. Core entity tables: `agents`, `user_agents`, `personal_agents`, `skills`.
3. Session/mission tables: `sessions`, `session_tasks`, `missions`.
4. Channels + settings + builder + marketplace_installs.
5. Backups + provision-configs.
6. Decommission Turso writes for migrated tables; finalize.
