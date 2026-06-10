# Turso → Supabase: Stage 5 Cutover Plan (2026-06-09 reality update)

**Supersedes** `docs/2026-06-05-turso-legacy-cutover-plan.md` (kept for history). This doc re-maps the remaining work to the **actual code state on `dev` today**, after Stages 2–4 shipped.

**Goal (unchanged):** Turso becomes a **telemetry sink only**. Supabase/Postgres is the single system-of-record for auth, tenancy, gateways, and all app data. No `legacy_user_id`, no Turso reads outside telemetry.

**Top-line finding:** the cutover is **~70% done**. The remaining ~30% is dominated by **one login-critical blocker** — Better Auth still runs on Turso — plus a short tail of reversible cleanups and the final irreversible drops.

---

## 0. What actually shipped since 2026-06-05 (corrected baseline)

Verified via git log on `dev` + code read 2026-06-09.

**✅ Done (on `dev`, behind dual-read where it touches the hot path):**
- `a3070a0` route all cloud auth/tenancy reads to Supabase; `3a64549` sever last Turso `user`/`organization` readers (pre-drop).
- `b0a8ae5` Stage 2 tenancy resolution → Supabase (`resolveSupabaseTenant`); `9a9b40a` orgs admin reads → Supabase; `7363a8c` user-admin surface → Supabase; `ab7d044` admin identity read/delete → Supabase vault.
- `78b8238` gateway-token auth dual-read (Supabase `gateway` primary → Turso `servers` fallback); `c286686` flows+workshop org-shared via `withOrgCore`; `28b0a11` 17 services through `withOrgCore` (RLS).
- **Bridge flip is effectively retired in hub identity:** `supabase-bridge.ts::mapProfileToUser` returns `id: supabaseId` (uuid), **not** `legacy_user_id`. Tenancy is Supabase-only. Personal-agent rows key on **profile uuid**.

**⚠️ Still load-bearing on Turso (the real remaining surface):**
1. **Better Auth login.** `packages/auth/src/factory.ts:44` = `drizzleAdapter(getDb(), { provider: 'sqlite', schema })`. Hub `auth.ts` passes `db: getDb()` (Turso) + `@minion-stack/db/schema` (sqlite). Better Auth owns `user`/`account`/`session`/`verification`, the `oidcProvider` owns **`jwks`**, and the `organization` plugin owns **`organization`/`member`/`invitation`** — all on Turso. `hooks.server.ts` routes `/api/auth/*` + `/.well-known/openid-configuration` through `getAuth().handler`. **This is the blocker to "Turso = telemetry only."**
2. `resolveProfileId()` legacy fallback — `personal-agent.service.ts` + `supabase-credential.ts` still match `or(profiles.legacyUserId == userId, profiles.id == userId)`. Vestigial in cloud mode (all cloud users are uuid-keyed) but breaks if the **gateway** still emits legacy ids.
3. `invitation` table on Turso (read by `api/invitations/[id]` + written by the Better Auth org plugin — same table as #1).
4. `servers` Turso telemetry fallback in `cache.ts` / `gateway-rpc.ts` / `resolve-identity.ts` (dual-read, Supabase `gateway` already primary).

---

## 1. Architecture today (accurate)

Auth is a **hybrid**, both branches converging in `hooks.server.ts::finishApp`:
- **Better Auth path** (Turso): owns the session cookie, login, OIDC. `getAuth().handler` serves `/api/auth/*`. Session → `user.id` = Better Auth user id.
- **Supabase bridge path**: `resolveIdentity` maps the authenticated principal → `profiles` (uuid) and resolves the active org from Supabase `organization_members`. All app data reads/writes are Supabase, keyed by profile uuid + org GUC (RLS via `withOrgCore`).

`legacy_user_id` survives **only** as a join key between the two id-spaces during the bake. Once Better Auth issues Supabase-uuid principals (or is replaced), the bridge column is droppable.

---

## 2. Telemetry boundary — what STAYS on Turso (the end state)

- `api/metrics/*` (gateway heartbeats, reliability events) + any reliability write path.
- **Nothing auth/tenancy/app.** `getDb` survives only in telemetry modules + `db/client.ts` (provider def).

---

## 3. Remaining work — ordered tracks (reversible first, irreversible last)

> **Stage 0 (every track, every time):** `pg_dump` prod Supabase `gxv` + `turso db shell … .dump`; record a Vercel Instant-Rollback point; tag the pre-change commit; keep new paths behind a dual-read/flag until baked.

### TRACK A — Reversible cleanups (solo, shippable to `dev`, no prod drops, no login risk)

Order them; each is an independent green-check + verify increment.

- **A1 — `resolveProfileId` → uuid-first.** Reorder the `or()` to try uuid first, keep `legacyUserId` as fallback (no behavior change, documents intent). **Do NOT remove the legacy branch yet** — gated on Track-C verification that the gateway emits uuids. Files: `personal-agent.service.ts`, `supabase-credential.ts`. Reversible.
- **A2 — `servers` telemetry fallback wave-2.** Once the Supabase `gateway` path has a full bake (it's been primary since `78b8238`), delete the Turso `servers` fallback reads in `cache.ts`, `gateway-rpc.ts`, `resolve-identity.ts`. Keep behind a `GATEWAY_TURSO_FALLBACK` flag for one deploy, then remove. Reversible until the flag is deleted.
- **A3 — drop dead `_db` params.** `createMembership(getDb(), …)` ignores the handle (`join/links.service.ts`, `requests.service.ts`, `join/membership.ts`). Remove the param. Pure cleanup.

**Track A exit:** legacy surface shrinks to Better Auth (Track B) + the `legacy_user_id` column (Track C). `check 0/0`, `test` green, no Vercel promotion required to be safe (dev-only until you choose to release).

### TRACK B — Better Auth → Postgres (THE blocker; login-critical; needs your smoke test)

Spans **3 repos**: `@minion-stack/auth` (factory) + `@minion-stack/db` (pg Better-Auth schema) + `minion_hub`.

- **B1 — pg Better-Auth schema.** Add Better Auth's tables to `@minion-stack/db/pg`: `user`, `account`, `session`, `verification`, `jwks`, + org-plugin `organization`/`member`/`invitation` (or reuse the existing Supabase `organizations`/`organization_members` if the plugin can be pointed at them — verify column shape). New `@minion-stack/db` minor.
- **B2 — factory provider param.** `packages/auth/src/factory.ts`: accept `provider: 'sqlite' | 'pg'` (or a second `createPgAuth`), pass through to `drizzleAdapter`. New `@minion-stack/auth` minor.
- **B3 — hub wiring.** `auth.ts`: `createAuth({ db: getCoreDb(), schema: pgSchema, provider: 'pg', … })`. Update the sign-up hook (already uses `getCoreDb()` for personal-agent — good). Verify `oidcProvider` jwks read/write hits pg.
- **B4 — data migration.** Existing Turso BA rows: `user`/`account` must migrate (or users re-auth — **decide**: Google OAuth users re-link cleanly; password users would need a reset). `session` can be dropped (users re-login). `jwks` **must** migrate or OIDC consumers (the gateway's hub-JWT verification, `PUBLIC_GATEWAY_JWT_AUTH`) break until keys re-issue — coordinate with the gateway's `oidcIssuers`.
- **B5 — bridge convergence.** With Better Auth issuing principals from pg keyed to `profiles.id`, `legacy_user_id` becomes truly vestigial. Remove the legacy branch from A1's `resolveProfileId`.

**⚠️ Prod smoke test (you):** after deploy to a preview/`dev`: log in (Google + password), verify session persists, org resolves to `21e0601b`, `/my-agent` loads, hosts list non-empty, OIDC discovery + gateway JWT still validate. **Do not promote to `master` until this passes.**

### TRACK C — Irreversible prod drops (LAST; needs you + a soak window)

Only after Track A + B are deployed and baked (≥ a few days of prod login with no `legacy`/Turso-auth errors):
- `grep -rn "legacy_user_id\|legacyUserId" src/` → 0 non-telemetry hits (precondition).
- `ALTER TABLE profiles DROP COLUMN legacy_user_id;` (prod Supabase).
- Drop Turso `user`, `account`, `session`, `verification`, `jwks`, `member`, `organization`, `invitation`, `servers`, `user_servers`, `workspace_membership` (each only after its Supabase replacement has baked).
- Remove `@minion-stack/db/schema` (sqlite) + `@libsql` imports from all non-telemetry files.
- **Verify (you):** full E2E — login, tenancy, gateway ingest, memory, flows, chat; `grep legacy` = 0; `grep getDb` = telemetry only.

---

## 4. Gateway coordination points (don't break these)

- **Hub-issued JWT / OIDC** (`PUBLIC_GATEWAY_JWT_AUTH`, gateway `oidcIssuers`): Track B4 re-keys `jwks`. The gateway validates hub JWTs against the issuer's JWKS — migrate keys without a gap, or temporarily allow both.
- **Gateway → hub ingest** (memory, message-ledger, metrics): authenticates by **token, not user id** (`resolveServerTokenAuth`) → unaffected by legacy removal, but Track A2 must keep the Supabase `gateway` token resolving.
- **`resolveProfileId` legacy ids:** confirm whether the gateway's personal-agent provisioning / channel-identity lookups still send legacy better-auth ids. If yes, B5 waits on a gateway change.

## 5. Risk register

- **Production login** (Track B) — highest risk; dual-path + preview smoke test before `master`; never drop a Turso table before its pg replacement bakes.
- **JWKS gap** (B4) — OIDC/gateway-JWT breakage if keys rotate without overlap.
- **Concurrent migration agent** — they own this domain; confirm no uncommitted auth work before starting B/C.
- **Password users** (B4) — Better Auth uses scrypt; migrating `account` rows preserves hashes (same algo) — verify before assuming re-auth.

## 6. Done =
- `grep -rn "legacy" src/` → only non-tenant matches; no `legacy_user_id` column.
- `grep -rn "getDb\|@libsql\|/schema" src/` → telemetry paths only.
- Better Auth on Postgres; no Turso `user`/`account`/`session`/`jwks`/`member`/`organization`/`invitation`/`servers`.
- One tenant id (`21e0601b`) everywhere; gateway organic memories visible to the logged-in user.

## 7. Suggested execution order
**A1 → A3 → A2** (shrink surface, all solo/reversible) → **B1 → B2 → B3 → B4 → B5** (login migration, your smoke test gates `master`) → **C** (drops, your soak + E2E). Tracks A and B-schema (B1) can proceed in parallel; B4/B5/C are strictly sequential and gated on you.
