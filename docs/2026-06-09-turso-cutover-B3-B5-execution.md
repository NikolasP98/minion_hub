# Turso → Supabase: Track B3–B5 Execution (Better Auth → Postgres)

**Companion to** `docs/2026-06-09-turso-cutover-stage5-plan.md`. Covers the **login-critical** half of Track B: moving the Better Auth store off Turso onto Postgres/Supabase, plus the Turso auth-table drop. **Every step here touches the prod login hot path** — run B3/B4 against a preview or `dev` first and gate `master` on the smoke test (§B-smoke).

## Foundation already shipped (do not redo)
- `@minion-stack/db@0.8.0` — pg Better Auth schema at `@minion-stack/db/pg` (`user`, `session`, `account`, `verification`, `jwks`, `organization`, `member`, `invitation`, `oauthApplication`, `oauthAccessToken`, `oauthConsent`). Published.
- `@minion-stack/auth@0.4.0` — `createAuth({ provider: 'pg' })`. Published.
- Track A (hub `dev`): gateway-credential reads are Supabase-primary behind `GATEWAY_TURSO_FALLBACK`; `resolveProfileId` uuid-first.

## ⚠️ Scope correction — what BA→pg does and does NOT do
Moving Better Auth's **store** to Postgres does **not** change its **id scheme**: `user.id` stays the Better-Auth-generated text id. Therefore `profiles.legacy_user_id` (= BA `user.id`) **remains the BA-id ↔ profile-uuid bridge after B3/B4**. This track achieves **"Turso = telemetry only"** (the Turso auth tables become droppable) but it does **not** delete `legacy_user_id`. Eliminating `legacy_user_id` entirely requires **id unification** — either replacing Better Auth with Supabase GoTrue (`auth.users.id == profiles.id`) or customizing BA's id generation to emit the profile uuid. That is a **separate follow-on (call it Track D)**, explicitly out of scope here. So below, **B5 = drop the Turso auth tables**, not "drop legacy_user_id".

---

## Preconditions (Stage 0)
- `pg_dump` prod Supabase `gxv`; `turso db shell <hub-db> .dump` for the auth tables. Tag the pre-change hub commit; record a Vercel Instant-Rollback point.
- Confirm `SUPABASE_DB_URL` (the `getCoreDb()` target) points where you intend. **Known split (memory): hub `SUPABASE_DB_URL` has been LOCAL `127.0.0.1` while `PUBLIC_SUPABASE_URL` = prod gxv.** Verify before migrating data, or you'll write BA rows to the wrong DB.
- `BETTER_AUTH_SECRET` unchanged (session + JWT continuity depends on it).

---

## B3 — Wire the hub to the pg Better Auth store

### B3a. Update hub dependencies
`package.json`:
- `@minion-stack/db`: `file:deps/minion-stack-db-0.5.1-pg.tgz` → `0.8.0` (drops the vendored-tarball bridge; 0.8.0 is a superset — agentMemories, pg split, BA schema).
- `@minion-stack/auth`: `^0.2.0` → `^0.4.0`.

**Then (memory lesson — non-negotiable):**
```bash
rm -rf node_modules/@minion-stack/db node_modules/@minion-stack/auth
bun install
```
A db-ref change with stale `node_modules` passes local `bun build` but crashes the Vercel `npm install` at SvelteKit postbuild. A failed Vercel **build** keeps the previous deploy live (no downtime) — but verify the build before promoting.

### B3b. Create the pg Better Auth tables
No `supabase/migrations/` dir in the hub — pg DDL is applied via `mcp__supabase apply_migration` (prod) and `execute_sql`/psql (local). Author one migration `create_better_auth_tables` with `CREATE TABLE IF NOT EXISTS` for all 11 tables, column shapes matching `@minion-stack/db/pg` `auth.ts` (text ids, `timestamptz`, `boolean`), plus the indexes (`idx_session_user`, `idx_account_user`, `idx_verification_identifier`, `idx_member_org`, `idx_member_user`, `idx_invitation_org`, `idx_oauth_*`). Drizzle can generate the DDL: `drizzle-kit generate` against a pg config pointed at `@minion-stack/db/pg` auth exports, or hand-write from `auth.ts`.
- **RLS:** these are auth-infra tables read/written by the server (service role / bypass), not user-scoped via GUC. Match the existing pattern for `gateway`/`profiles` (no per-row org RLS, or RLS with a service bypass). Confirm `getCoreDb()`'s role can read/write them.

### B3c. Point `auth.ts` at pg
`src/lib/auth/auth.ts`:
```ts
import { getCoreDb } from '$server/db/pg-client';
import * as pgSchema from '@minion-stack/db/pg';   // exports the BA tables by model name
// ...
_auth = createAuth({
  db: getCoreDb(),
  schema: pgSchema,         // BA picks user/session/account/... by name; extra app tables ignored
  provider: 'pg',
  secret: env.BETTER_AUTH_SECRET ?? '',
  // ...unchanged: baseURL, trustedOrigins, google, plugins, hooks
});
```
- The sign-up hook already uses `getCoreDb()` for `provisionPersonalAgent` — good.
- `@minion-stack/db/pg` exports both BA tables and app tables; Better Auth's drizzle adapter selects its models by name. Verify no name clash surprised the adapter (the org plugin wants `organization`/`member`/`invitation` — present).

### B3d. Repoint the custom JWT signer to pg (jwks continuity, part 1)
`src/server/services/gateway-jwt.service.ts` reads `jwks` from `@minion-stack/db/schema` (**Turso**) and signs gateway JWTs with the private key. After jwks moves to pg this **must** switch:
```ts
import { jwks } from '@minion-stack/db/pg';
import { getCoreDb } from '$server/db/pg-client';
// ...read latest jwks row from getCoreDb()
```
If this is missed, gateway-JWT minting (`PUBLIC_GATEWAY_JWT_AUTH`) reads an empty/again-Turso jwks → JWT auth breaks while the rest of login works.

---

## B4 — Migrate the data (Turso → pg)

One-off Node script (run with the hub's env) using both clients: `getDb()` (Turso, source) + `getCoreDb()` (pg, dest). Idempotent upserts keyed on the text `id` (preserved). Order respects FKs: `user` → `account`/`session`/`member`/`invitation` → org tables → oauth tables.

**Tables:**
- **`user`** — migrate all. `id` preserved (so `profiles.legacy_user_id` keeps matching).
- **`account`** — migrate all. `password` is a Better Auth scrypt hash → **copy verbatim** (same algo post-migration, so passwords keep working). OAuth `access_token`/`refresh_token` copy as stored.
- **`jwks`** — **migrate verbatim (critical).** Same `id` + `public_key` + `private_key` → the signing keypair and the served JWKS are byte-identical, so existing 1h-tokens stay valid and the gateway's JWKS fetch needs no change. **Do not regenerate keys.** (jwks continuity, part 2.)
- **`organization` / `member` / `invitation`** — migrate if the BA org plugin has prod rows. (Note: tenancy reads use the *separate* Supabase `organizations`/`organization_members`; these BA-plugin tables back the invite flow + `activeOrganizationId`. Converging the two org-table sets is the later cleanup, not here.)
- **`session`** — **skip** (everyone re-logs-in once; low friction, avoids copying live cookies).
- **`verification`** — **skip** (ephemeral email/reset tokens; expire fast).
- **`oauth_application` / `oauth_access_token` / `oauth_consent`** — migrate if the hub registered OIDC clients (the gateway as an OIDC consumer). `oauth_application` (client registrations) and `oauth_consent` should migrate; `oauth_access_token` can be skipped (short-lived).

**Verify after:** row counts match (minus skipped); a known user's `account.password` present; `jwks` row identical (`select id, left(public_key,20) from jwks` both sides).

---

## B5 — Drop the Turso auth tables (irreversible; after a full bake)

Only after B3/B4 deployed and **baked** (≥ a few days of prod login with zero `[authHandle]`/jwks errors) and the smoke test passed on `master`:
- Drop Turso `user`, `account`, `session`, `verification`, `jwks`, `organization`, `member`, `invitation`, and (if migrated) `oauth_application`/`oauth_access_token`/`oauth_consent`.
- Flip `GATEWAY_TURSO_FALLBACK=false` permanently and delete the gated `servers` fallback branches (Track A2) + the now-dead Turso `servers` reads.
- Remove `@minion-stack/db/schema` (sqlite) + `@libsql` imports from auth/gateway modules; `getDb()` survives **only** for telemetry (`api/metrics/*`).
- **NOT in B5:** `profiles.legacy_user_id` stays (it's now an intra-pg BA-id↔uuid bridge). Its removal is Track D (id unification / GoTrue).

---

## B-smoke — the prod smoke test (you; gates `master`)
Run against a Vercel preview or `dev` deploy of B3/B4 **before** promoting to `master`:
1. **Password login** — existing user logs in (scrypt hash migrated). Session persists across reload.
2. **Google login** — existing Google user logs in (account row migrated; account-linking intact).
3. **New sign-up** — creates BA `user` (pg) + triggers `provisionPersonalAgent` (pg) with no error.
4. **Tenant** — logged-in user resolves org `21e0601b`; `/my-agent` + hosts list load (non-empty).
5. **Gateway JWT** (`PUBLIC_GATEWAY_JWT_AUTH=true`) — dashboard connects; the gateway validates the hub JWT (jwks served from pg, keys unchanged). Check no `JWT rejected` in `gateway.svelte.ts` path.
6. **OIDC discovery** — `/.well-known/openid-configuration` + `/api/auth/jwks` return 200 with the migrated keys.

Any failure → Vercel Instant Rollback (no Turso table dropped yet, so fully reversible).

---

## Sequence & reversibility
**B3a → B3b → B3c → B3d** (deploy together; reversible via dep revert + Instant Rollback — Turso untouched) → **B4** (data migrate; reversible, pg is additive) → **B-smoke** (gates master) → bake → **B5** (irreversible drops). Track A's `GATEWAY_TURSO_FALLBACK` and the published packages are independent and already safe.

## Risk register (delta from the main plan)
- **`SUPABASE_DB_URL` split** — migrating data to a local `127.0.0.1` Postgres instead of prod gxv silently no-ops the cutover. Verify first.
- **jwks gap** — regenerating keys (instead of migrating rows) invalidates live gateway JWTs until re-fetch; migrate `jwks` verbatim AND repoint `gateway-jwt.service.ts` (B3d).
- **Stale node_modules on db-ref change** — `rm -rf` + reinstall before trusting any build (B3a).
- **`legacy_user_id` expectation** — this track does NOT remove it; if "no legacy_user_id" is a hard goal, scope Track D (GoTrue/id-unification) separately.
- **Concurrent migration agent** owns this domain — confirm no uncommitted auth work before B3.
