# Turso → Supabase: Legacy Cutover Plan

**Goal:** Turso becomes a **telemetry sink only**. Supabase is the single system-of-record for auth, tenancy, gateways, and all app data. **No `legacy_user_id`, no divergent tenant ids, no Turso cross-references outside telemetry.**

**Status:** Plan only — no destructive changes yet. This is a staged, reversible migration on **production login**, overlapping the in-flight Phase 5/6 work. **Coordinate with the migration agent before executing — do not run stages in parallel with their changes.**

---

## 1. Current state (what's still wrong)

| Concern | Today |
|---|---|
| **Session/tenant resolution** | Supabase auth resolves the **old tenant id `d6caa342`** (FACES). Data + gateway use the **Turso org id `21e0601b`**. The migration mapped data `d6caa342→21e0601b` but **left session resolution on `d6caa342`** → reads and writes are partitioned under different ids (this is why memory tabs render empty). |
| **`legacy_user_id` bridge** | 6 files: `supabase-bridge.ts`/`.runtime.ts`/`.test.ts`, `personal-agent.service.ts`, `supabase-credential.ts`. `mapProfileToUser` returns `profile.legacy_user_id ?? supabaseId` to match Turso `member` rows. |
| **Auth on Turso** | `resolve-identity.ts`, `tenant.ts` read Turso `member`/`organization`/`user`. `getDb()` = Turso (`db/client.ts`). |
| **Gateway auth on Turso** | `servers` table holds gateway tokens (`resolveServerTokenAuth`, `servers/[id]/token`, `cache.ts` system-gateway token). Gateway → hub ingest authenticates via these. |
| **App data on Turso** | ~15 routes still `getDb`: workshop saves, invitations, join-requests, marketplace install, bugs, my-agent settings, orgs, link/join. |

**~32 files reference Turso/`getDb`; 6 reference `legacy_user_id`.**

## 2. Telemetry boundary — what STAYS on Turso

Keep ONLY these on Turso (the target "telemetry sink"):
- `api/metrics/*` (gateway heartbeats, reliability events).
- Any reliability/metrics write path.
- **Decision needed:** the **system-gateway credential** in `cache.ts` (reads `servers`) — this is auth-adjacent telemetry config. Either move gateway creds to Supabase (preferred, see Stage 3) or keep a minimal `servers` read for telemetry only.

Everything else → Supabase.

## 3. Staged migration (ordered; each stage independently shippable + reversible)

> **Stage 0 — Backups & safety net (do first, every time).**
> - `pg_dump` prod Supabase (`gxv`) + Turso export (`turso db shell ... .dump`).
> - Vercel **Instant Rollback** point recorded; tag the pre-cutover commit.
> - Feature-flag the new resolution path so it can be toggled off without redeploy.

> **Stage 1 — Converge tenant ids (UNBLOCKS the memory feature; lowest-risk first).**
> - Pick the **canonical org id = `21e0601b`** (Turso/gateway already use it; data already migrated there).
> - Fix session resolution so Supabase auth returns `21e0601b`, **not** `d6caa342`:
>   - Add a `profiles.org_id` (or a `tenant_map` row) that maps the FACES profile → `21e0601b`.
>   - `resolveViaSupabase`/`resolveUserTenant`: resolve org from **Supabase** (`profiles.org_id` / `organization_members`), not Turso `member`.
> - Migrate any rows still under `d6caa342` → `21e0601b` (one `UPDATE … SET org_id` per table, RLS-aware).
> - **Verify:** logged-in user's `token-ep tenant=` prints `21e0601b`; memory tab shows rows; gateway organic writes (also `21e0601b`) now visible.
> - **Rollback:** revert resolution flag; org ids untouched elsewhere.

> **Stage 2 — Move tenancy reads off Turso `member`/`organization` → Supabase.**
> - Stand up Supabase `organizations` + `organization_members` as the source of truth (partly exists; seed/verify).
> - Rewrite `tenant.ts` `resolveUserTenant` + `resolve-identity.ts` to read Supabase orgs/members.
> - **Verify:** login, org switch, `(app)/+layout.server.ts` loads, all per-org reads. Test suite green.
> - **Rollback:** dual-read (Supabase first, Turso fallback) behind a flag during bake-in.

> **Stage 3 — Re-home gateway auth (`servers` tokens) onto Supabase.**
> - Create Supabase `gateways` table (token ciphertext + `org_id`). Migrate `servers` rows (incl. the netcup gateway `1cf319d2`) → Supabase, re-keyed to `21e0601b`.
> - Rewrite `resolveServerTokenAuth`, `servers/[id]/token`, `cache.ts` system-gateway lookup to read Supabase.
> - **Gateway side:** no change needed if the token value is preserved; the gateway keeps posting the same Bearer, the hub now resolves it from Supabase.
> - **Verify:** gateway metrics + message-ledger + **agent-memories ingest** still authenticate; org resolves `21e0601b` (now matches reads).
> - **Rollback:** keep Turso `servers` until Supabase path proven for a full bake cycle.

> **Stage 4 — Migrate remaining app data off Turso.**
> - workshop saves, invitations, join-requests, marketplace install, bugs, my-agent settings, link/join → Supabase tables + `getCoreDb`/`withOrg`.
> - One route at a time, each behind a verify + green check (follows the Phase-5 Tier pattern already established).

> **Stage 5 — Eliminate `legacy_user_id` + drop Turso auth tables (IRREVERSIBLE — last).**
> - Once nothing reads `legacy_user_id`: remove it from the 6 files; make ids canonical Supabase uuids.
> - `ALTER TABLE profiles DROP COLUMN legacy_user_id;`
> - Drop Turso `member`, `organization`, `user`, `servers`, `workspace-membership` (after Supabase equivalents proven). Delete legacy rows.
> - Remove `getDb`/`@minion-stack/db/schema`/`@libsql` imports from all non-telemetry files; `getDb` survives only for telemetry.
> - **Verify:** full E2E (login, tenancy, gateway ingest, memory, flows, chat); grep `legacy` = 0 non-telemetry hits; grep `getDb` = telemetry only.

## 4. Risks & invariants

- **Production login** — Stages 1–3 touch the auth hot path. Every stage must keep a dual-read/flag rollback until baked. Never drop a Turso table before its Supabase replacement has run a full bake cycle.
- **Concurrent migration agent** — they own this area (`user_agents STAYS Turso` per their notes, in-flight tenancy cutover). **Sequence with them**; do not run stages while they have uncommitted auth changes.
- **`user_agents`** — their notes say it stays on Turso; confirm whether that's still intended or also migrates.
- **Canonical id choice** — this plan picks `21e0601b` (gateway + data already there). If the migration agent intends Supabase-uuid canonical instead, Stage 1 flips direction (converge on the Supabase id, re-key gateway tokens) — decide before Stage 1.

## 5. Done = 
- `grep -rn "legacy" src/` → only unrelated (non-tenant) matches.
- `grep -rn "getDb\|@libsql\|/schema" src/` → telemetry paths only.
- No `legacy_user_id` column; no Turso `member`/`organization`/`servers`/`user`.
- One tenant id everywhere; gateway organic memories visible to the logged-in user.
