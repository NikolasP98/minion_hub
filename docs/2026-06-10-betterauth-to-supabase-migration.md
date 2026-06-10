# Better Auth → Supabase Auth (GoTrue): Full Migration Plan

**This is the correct Track B.** It **supersedes** `docs/2026-06-09-turso-cutover-B3-B5-execution.md` (which planned moving Better Auth's *store* to Postgres — the wrong target; we are **removing** Better Auth, not relocating it).

**Goal:** Supabase Auth (GoTrue) is the **sole** auth provider. Remove Better Auth entirely (handler, factory, client, self-host branch, jwks plugin, Turso auth tables). Because GoTrue's `auth.users.id == profiles.id` (uuid), this **eliminates `legacy_user_id`** — completing the Turso cutover *and* the id-unification in one arc.

**Decisions (locked 2026-06-10):**
- **Supabase Auth is the only provider** — the self-host `resolveViaBetterAuth` path is dropped (self-host runs against a Supabase project).
- **Gateway JWT → standalone jose keypair + hand-served JWKS** (not Better Auth's jwt plugin), issuer/audience kept stable so the gateway's `oidcIssuers` keeps validating.

> ⚠️ Every phase touches prod login. Ship to a preview/`dev` deploy, run the smoke test (§Smoke), gate `master`. Each phase is independently shippable + reversible until S7's drops.

---

## ✅ Progress + next-session scope (2026-06-10)

All shipped to hub `origin/dev` only — `master`/Vercel untouched, `check 0/0`, `test 627` throughout. **S0 verified all 5 prod users are in GoTrue with profiles; the 2 password users (admin@facesculptors.net, renzo) already have GoTrue bcrypt passwords → no reset needed.**

| Step | State | Commit |
|---|---|---|
| S0 verify prod users | ✅ done | (mcp query) |
| S1 login email→`signInWithPassword` | ✅ done | `efabed7` |
| S2 social→`linkIdentity` | ✅ done | `7a0eabe` |
| S3 OrgPicker drop `org.setActive` | ✅ done | `7f52bea` |
| S4 p1 wire `/join?token=` consume | ✅ done | `f882c0f` |
| S4 p2 TeamTab → join-links | ✅ done | `85427f1` |
| S4 p3 retire `/invite/accept` + delete dead routes | ✅ done | `2c6c72d` |
| S4 p4 `auth.users→profiles` trigger + email signup UI | ✅ done | `2c6c72d` |
| S5 gateway JWT → standalone jose + hand-served JWKS | ✅ done | `37e77c4` |
| S6 **delete Better Auth** (sole provider = GoTrue) | ✅ done | `6227f3b` |

**Better Auth is fully removed.** No `authClient`, no `getAuth`, no `better-auth`/`@minion-stack/auth` deps. `check 0/0`, `test 627`, `build` clean throughout; all on `origin/dev` (latest `6227f3b`), `master`/Vercel untouched.

**Prod gxv migrations applied this session:** `on_auth_user_created` trigger (+ EXECUTE lockdown), `gateway_signing_keys` table (RLS forced, service-role-only).

### NEXT SESSION — what's left

**0. SMOKE TEST FIRST (you — I can't log in / browser-test).** Deploy `dev` to a preview and verify S1–S6 end-to-end:
- (a) **password login** for admin@facesculptors.net / renzo.gt03@gmail.com — session persists, `/my-agent` + hosts load.
- (b) **Google login** still works; identity linked.
- (c) **email sign-up** (new toggle on `/login`) → new GoTrue user → `profiles` row auto-created by the trigger → onboarding provisions the personal agent.
- (d) **join-link** round-trip: Settings → Team → generate link → open in another session → "Join {org}" → membership in `organization_members`.
- (e) **gateway JWT** (`PUBLIC_GATEWAY_JWT_AUTH=true`): dashboard connects; the gateway validates the standalone-signed JWT against the new `/.well-known/jwks.json` — **no `JWT rejected`** in gateway logs. First token issuance lazily mints + persists the standalone key in `gateway_signing_keys`. (S2 social-linking needs **"Manual linking" enabled** in Supabase auth settings.)

If all pass → merge `dev` → `master` (the S1–S6 cutover goes to Vercel prod). Bake.

**1. S7 — irreversible drops (ONLY after smoke + bake + your explicit go-ahead).** Destructive, prod-affecting, NOT reversible — left undone deliberately:
- Remove the Track A1 legacy branch in `resolveProfileId` (`personal-agent.service.ts` + `supabase-credential.ts`); `ALTER TABLE profiles DROP COLUMN legacy_user_id` (now safe: GoTrue `auth.users.id == profiles.id`).
- Drop Turso `user`/`session`/`account`/`verification`/`jwks`/`organization`/`member`/`invitation`/`oauth_*`.
- Flip `GATEWAY_TURSO_FALLBACK=false`, delete the Track A2 `servers` fallback in `resolveServerTokenAuth`, drop Turso `servers`.
- Set `GATEWAY_JWT_INCLUDE_LEGACY_JWKS=false` (stop serving the old BA public key once no live token is signed by it) — verify the gateway only sees the standalone key first.
- Strip `@minion-stack/db/schema` (sqlite) + `@libsql` imports from non-telemetry code; `getDb()` survives only for `/api/metrics/*`.
- **Done =** `grep legacy` → 0 non-telemetry; `grep getDb/@libsql` → telemetry only; one provider (GoTrue), one id space (profile uuid).

**Loose ends (optional):** the unused `sendInvitationEmail` export in `email.service.ts` (harmless); `roles.service.ts` is no longer on the login path (kept for any custom-roles UI).

### Carryover facts
- B1/B2 (db@0.8.0 pg-BA-schema + auth@0.4.0 provider param) are **published but unused** — they assumed keeping BA; `@minion-stack/auth` is retired from the hub in S6. Harmless.
- `SUPABASE_DB_URL` split risk: it has been LOCAL `127.0.0.1` while `PUBLIC_SUPABASE_URL` = prod gxv — verify target before any data op.
- Canonical org ids: FACES `21e0601b`, MINION `c9e8dc46`.

---

## Current state (already GoTrue — do not rebuild)
- **Google login:** `supabase.auth.signInWithOAuth` → `/auth/callback` → `exchangeCodeForSession` + `syncGoogleLogin()` (upserts `profiles` + `user_identities`). `src/routes/auth/callback/+server.ts`, `src/server/auth/identity-sync.ts`.
- **Session (cloud):** `resolveIdentity` → `resolveViaSupabase` → `resolveSupabaseUser` → `supabase.auth.getUser()`. Gated by `AUTH_PROVIDER==='supabase'` (`resolve-identity.ts:274`).
- **Tenancy:** Supabase `organizations`/`organization_members` + `active_org` cookie (`/api/active-org`).

## Better Auth removal surface (from the 2026-06-10 inventory)
- **Email/password** sign-in + sign-up: `authClient.signIn.email` / `signUp.email` (`login/+page.svelte:45`, `invite/accept/+page.svelte`).
- **Social linking:** `authClient.linkSocial` (`ConnectedIdentities.svelte:41`).
- **Org-plugin client:** `authClient.organization.list/setActive/acceptInvitation` (`login/+page.svelte:54-56`, `OrgPicker.svelte:49`, `invite/accept`).
- **Gateway JWT/OIDC:** `gateway-jwt.service.ts` (jose + `jwks` private key `symmetricDecrypt`'d with `BETTER_AUTH_SECRET`); `/api/auth/*` + `/.well-known/openid-configuration` proxy (`hooks.server.ts:20-58`); `oidcProvider` plugin (`auth.ts:57`).
- **Self-host:** `resolveViaBetterAuth` + jwks-heal (`resolve-identity.ts:187-331`), `seed.ts`, `getAuth()`/`auth.ts`, `auth-client.ts`, `@minion-stack/auth` dep.
- **Dead already:** `verification`, `oauth_application`/`oauth_access_token`/`oauth_consent` tables.

---

## Phases

### S0 — Preconditions
- Confirm prod `AUTH_PROVIDER=supabase` (cloud already GoTrue). `pg_dump` gxv; Turso auth-table dump; Vercel rollback point; tag commit.
- **Verify prod user composition** (decides S7 data handling): query GoTrue `auth.users` vs Turso `user`/`account`. Identify any **email/password** users — Better Auth stores **scrypt** hashes; GoTrue uses **bcrypt** → hashes **cannot** migrate. Those users need a password reset / magic-link re-establish. (Google users already in `auth.users`.)

### S1 — Email/password sign-in + sign-up → GoTrue
- `login/+page.svelte`: `authClient.signIn.email({email,password})` → `supabase.auth.signInWithPassword({email,password})`.
- `invite/accept/+page.svelte` + any signup: `authClient.signUp.email` → `supabase.auth.signUp`.
- **Profile creation on email signup:** Google path uses `syncGoogleLogin`. Add the equivalent for email — preferred: a Supabase **DB trigger** `on auth.users insert → upsert public.profiles` (one source of truth, fires for every GoTrue signup regardless of method), replacing the per-method app-side upsert. Verify `profiles.id = auth.users.id`.
- Remove the `authClient.organization.list/setActive` post-login calls (S3 covers active-org).

### S2 — Social linking → GoTrue
- `ConnectedIdentities.svelte`: `authClient.linkSocial({provider:'google'})` → `supabase.auth.linkIdentity({provider:'google'})`. Verify `user_identities` still reflects links (identity-sync).

### S3 — Org client calls → Supabase
- Drop `authClient.organization.setActive` → already `active_org` cookie via `/api/active-org`.
- Drop `authClient.organization.list` → server load from `organization_members` (already the tenancy source).
- Remove `organizationClient()`/`jwtClient()` from `auth-client.ts` (then delete the file in S6).

### S4 — Invitation flow → Supabase-native
- `invite/accept`: replace `authClient.organization.acceptInvitation` with a Supabase path. **Recommended:** reuse the existing Supabase `join_request`/`join_link` flow (already cut over) and **deprecate Better Auth `invitation`**; or add a thin Supabase `invitations` table + accept endpoint that upserts `organization_members`. Pick join-link reuse unless email-invitation-by-id is a hard requirement.

### S5 — Gateway JWT/OIDC → standalone jose (the hard part)
- **Keypair:** generate a standalone EdDSA keypair. Store the private key OUTSIDE Better Auth — env `GATEWAY_JWT_PRIVATE_JWK` (Infisical) or a dedicated `gateway_signing_keys` Supabase table (NOT `BETTER_AUTH_SECRET`-encrypted). Keep the **kid** stable.
- **Rewrite `gateway-jwt.service.ts`:** drop `symmetricDecrypt` + the `jwks`-table read; load the standalone private key; sign EdDSA with **issuer = hub URL (unchanged)**, **audience = `openclaw-gateway` (unchanged)**, same custom claims (role/agentIds/orgId).
- **Serve JWKS:** hand-roll `/.well-known/jwks.json` (and a minimal `/.well-known/openid-configuration` pointing at it) returning the standalone **public** key — this is what the gateway's `oidcIssuers` fetches. Issuer URL unchanged ⇒ no gateway config edit needed; the gateway re-fetches JWKS and picks up the new `kid`.
- **Rotation coordination:** deploy hub (new key + JWKS) → the gateway's JWKS cache refreshes on its TTL (or restart bots). Brief overlap acceptable; tokens are 1h. **Verify gateway still validates** before removing the old path.
- Remove `oidcProvider` plugin + jwks-heal logic.

### S6 — Remove Better Auth
- `hooks.server.ts`: delete `authHandle` (`/api/auth/*` proxy) — but **keep** the hand-served `/.well-known/jwks.json` + `openid-configuration` from S5.
- `resolveIdentity`: drop the `AUTH_PROVIDER` branch + `resolveViaBetterAuth` + `isJwksDecryptError`/`healStaleJwks` — always Supabase (metrics-bearer paths unchanged).
- Move the after-signup `provisionPersonalAgent` hook off Better Auth → the S1 DB trigger or a post-signup app call (OAuth callback already provisions).
- Delete `auth.ts`, `auth-client.ts`, `seed.ts` BA usage; remove `@minion-stack/auth` dep. (`@minion-stack/db@0.8.0`'s pg BA schema + `@minion-stack/auth@0.4.0` provider param become unused — harmless; retire the package for the hub later.)
- `permissions.service.ts`: drop the Better-Auth/`role_permissions` self-host branch → role from `profiles.role` only.

### S7 — Drop Turso auth tables + `legacy_user_id` (irreversible; after bake)
- Handle email/pw users per S0 (reset). Confirm all active users in GoTrue `auth.users` + `profiles`.
- Remove the legacy branch in `resolveProfileId` (Track A1's flagged code) + any `legacy_user_id` reads — now safe (GoTrue id == profile uuid).
- `ALTER TABLE profiles DROP COLUMN legacy_user_id;`
- Drop Turso `user`/`session`/`account`/`verification`/`jwks`/`organization`/`member`/`invitation`/`oauth_*`.
- Flip `GATEWAY_TURSO_FALLBACK=false` permanently; delete the gated `servers` fallback (Track A2) + drop Turso `servers`.
- Remove `@minion-stack/db/schema` (sqlite) + `@libsql` imports from non-telemetry code; `getDb()` survives only for `api/metrics/*`.
- **Done =** `grep legacy` → 0 non-telemetry; `grep getDb/@libsql` → telemetry only; one auth provider (GoTrue); one id space (profile uuid).

---

## Smoke test (you; gates `master`, after S1–S6 on a preview)
1. Existing user **password login** (or, if scrypt user, the reset flow) — session persists.
2. Existing **Google login** — works; identity linked.
3. **New sign-up** (email + Google) → `auth.users` + `profiles` row created (trigger) + personal agent provisioned.
4. **Tenant** resolves `21e0601b`; `/my-agent` + hosts load.
5. **Gateway JWT** (`PUBLIC_GATEWAY_JWT_AUTH=true`) — dashboard connects; gateway validates the standalone-signed JWT (new JWKS); no `JWT rejected`.
6. **Invite accept** (S4 path) grants org membership.

## Sequence & reversibility
S1→S2→S3→S4 (client/login swaps, reversible) → **S5** (gateway JWT decouple — verify gateway validation before proceeding) → **S6** (remove Better Auth) → smoke → bake → **S7** (irreversible drops). Track A's kill-switch + the published packages are independent and already safe.

## Risk register
- **Email/pw hash incompatibility** (scrypt→bcrypt) — those users MUST reset; verify the prod set in S0.
- **JWKS rotation gap** (S5) — keep issuer/JWKS URL stable; verify gateway re-validates before removing the BA path.
- **Profile-creation race** — without the auth.users→profiles trigger, a GoTrue signup with no profile row traps the user; add the trigger in S1.
- **`SUPABASE_DB_URL` split** (local vs prod gxv) — verify target before any data op.
- **Concurrent migration agent** owns this domain — confirm no uncommitted auth work before starting.
