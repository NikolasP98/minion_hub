# Self-Serve Join Flow + Roles / Visibility / RLS — Design

**Date:** 2026-05-25
**Project:** `minion_hub` (data layer shared via `@minion-stack/db`)
**Status:** Design — awaiting user review before implementation plan

---

## Goal

Un-invited users who sign in (Google → Supabase) can get into an org without hitting a dead-end 403, via either (a) requesting access that an admin approves, or (b) an opaque admin-minted join link. Simultaneously, introduce a `super_admin` role tier with a curated, config-driven bundle of super-only views, a single role-based visibility layer, and defense-in-depth RLS on the Postgres tables.

This is one merged spec covering four bounded modules: **Join Flow**, **Super-Admin Tier**, **Role-Based Visibility**, and **RLS**. They share a data model and the `can()` access layer.

## Context (existing system — do not rebuild)

- **Coarse role:** `profiles.role` / `user.role` enum, currently `user | admin`. Read by `isAdmin`, `authorize.ts requireAdmin`, and the Supabase→Turso bridge (`mapProfileToUser`).
- **Fine-grained RBAC (already exists):** `roles` + `rolePermissions` tables (tenant-scoped), `user.roleId`, `$lib/permissions` PERMISSIONS catalog, `roles.service` / `permissions.service`, and a roles admin UI. **This stays as-is**; the new `ACCESS`/`can()` layer composes role + permissions, it does not replace RBAC.
- **Admin invite flow (already exists):** `invitation` table (Better Auth org plugin), `/api/invitations/[id]`, `/invite/accept?id=` page (logged-in accept + sign-up-and-accept). The only gap is the **un-invited OAuth sign-up** — this spec fills that.
- **Auth bridge:** `locals.user.id = profile.legacy_user_id ?? supabaseId`. Brand-new users have `legacy_user_id = null`, so their bridged id is the Supabase uuid.
- **DB split:** Supabase Postgres holds `profiles`, `user_identities`. Turso/libsql holds app data including `organization`, `member`, `roles`. **Turso has no Postgres RLS** — RLS applies only to the PG tables.
- **Server reads use the Supabase service-role key, which bypasses RLS.** RLS here is defense-in-depth for any future client/anon-key access; the `can()` layer is what enforces visibility server-side.

---

## Module 1 — Data Model

### Postgres (Supabase) — new tables + column

**`profiles.role`** — widen enum from `('user','admin')` to `('user','admin','super_admin')`. Migration: `ALTER TYPE`/recreate check; default stays `'user'`.

**`join_request`**
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `supabase_id` | uuid | requester's `auth.users.id` |
| `user_id` | text | bridged id at request time (`legacy_user_id ?? supabaseId`) |
| `email` | text | |
| `display_name` | text null | |
| `message` | text null | optional note from requester |
| `status` | text | `pending \| approved \| denied`, default `pending` |
| `organization_id` | text | target org (Default for now) |
| `requested_role` | text | default `user` |
| `reviewed_by` | text null | admin user id |
| `reviewed_at` | timestamptz null | |
| `created_at` / `updated_at` | timestamptz | |

Partial unique index: `(user_id, organization_id) WHERE status = 'pending'` — prevents duplicate open requests.

**`join_link`**
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `token` | text unique | opaque, 32 random bytes base64url — **the only thing in the URL** |
| `organization_id` | text | stored server-side |
| `role` | text | stored server-side |
| `created_by` | text | |
| `expires_at` | timestamptz null | |
| `max_uses` | int null | null = unlimited |
| `uses_count` | int | default 0 |
| `revoked` | boolean | default false |
| `created_at` | timestamptz | |

Schema files live in `@minion-stack/db` PG schema so the site can reuse them. Migrations authored via Drizzle → applied to Supabase (existing pipeline).

### Turso

No new tables. Approval/consume **writes** the `member` row here and ensures a `user` row exists.

---

## Module 2 — Join Flow

### Routes

- **`/join`** — new top-level route (sibling of `/login`, `/invite`), auth-required but **outside** the `(app)` membership gate.
  - `+page.server.ts`: requires `locals.user` (else redirect `/login`). If `?token=` present → resolve + consume link (see service). On success redirect `303 → /`. On invalid/expired/revoked/maxed → return a flag so the page shows a friendly message + the request form.
  - `+page.svelte`: request-access form (email/name prefilled from session, optional message). States: form / submitting / "pending approval" / "request denied" / link-error.

### Gate change

`(app)/+layout.server.ts`: where it currently `throw error(403, 'No organization membership…')`, instead:
```ts
if (memberships.length === 0) {
  if (user.role === 'super_admin') { /* skip gate, seed a virtual all-orgs ctx */ }
  else throw redirect(303, '/join');
}
```
Super-admins are never redirected (they operate cross-org). The friendly `src/routes/+error.svelte` stays for genuine errors.

### API

- `POST /api/join-requests` — body `{ message? }`; derives email/name/ids from `locals.user`; idempotent on pending; on create fires admin email.
- `GET /api/join-requests` — admin (`users.manage`): list pending (+ history).
- `POST /api/join-requests/[id]/approve` — body `{ role, organizationId }`; creates membership, marks approved.
- `POST /api/join-requests/[id]/deny` — marks denied.
- `POST /api/join-links` — admin: `{ organizationId, role, expiresAt?, maxUses? }` → returns token URL.
- `GET /api/join-links` — admin: list active.
- `POST /api/join-links/[id]/revoke`.

### Email

On request create, send via Resend (`noreply@minion-ai.org`) to **every user whose role is `admin` or `super_admin`** (queried, not hard-coded). Subject/body name the requester + a link to the Join requests page.

---

## Module 3 — Super-Admin Tier

- Widen `UserRole` union to `'user' | 'admin' | 'super_admin'` in `supabase-bridge.ts` (`ProfileRow.role`, `BridgedUser.role`, `mapProfileToUser`), `user.svelte.ts`, and any `role` typing. `mapProfileToUser`: `role: profile.role === 'super_admin' ? 'super_admin' : profile.role === 'admin' ? 'admin' : 'user'`.
- `super_admin` implies all `admin` capability + the super-views bundle + cross-org operation.
- **Super-views registry** — `$lib/access/super-views.ts`:
  ```ts
  export const SUPER_VIEWS = [
    { key: 'reliability.monitor', route: '/reliability', nav: { label: 'Reliability', icon: 'activity' } },
    { key: 'orgs.all',           route: '/orgs',        nav: { label: 'All Orgs',    icon: 'building' } },
    { key: 'config.editor',      route: '/config',      nav: { label: 'Config',      icon: 'settings' } },
  ] as const;
  ```
  Each entry auto-registers into `ACCESS` as `{ minRole: 'super_admin' }`. Adding a super-only view = one line. Internal config module (not a runtime/installable plugin).
- **All-orgs / tenant switcher (`/orgs`)** — new super-only view: lists every organization, lets a super-admin act in any tenant context (sets the working `tenantCtx`/org for subsequent queries). This satisfies "wire systems from a super-level." Scope of first cut: read-only list + switch-into-org; deeper cross-org tooling deferred.

---

## Module 4 — Role-Based Visibility

`$lib/access/policy.ts`:
```ts
type Capability = { minRole?: UserRole; permission?: string };
const ROLE_RANK = { user: 0, admin: 1, super_admin: 2 } as const;

export const ACCESS: Record<string, Capability> = {
  'users.manage':   { minRole: 'admin' },
  'agents.publish': { permission: 'marketplace:publish' }, // example: permission-gated element
  // SUPER_VIEWS entries (reliability.monitor, orgs.all, config.editor)
  // are merged in at module load as { minRole: 'super_admin' }
};

export function can(key: string, user?: { role: UserRole }, perms?: Set<string>): boolean {
  const cap = ACCESS[key];
  if (!cap) return false;
  if (cap.minRole && ROLE_RANK[user?.role ?? 'user'] >= ROLE_RANK[cap.minRole]) return true;
  if (cap.permission && perms?.has(cap.permission)) return true;
  return false;
}
```
- Client wrapper: `can(key)` reads `page.data.user` + `page.data.permissions`.
- **`<RoleGate key="…">{children}</RoleGate>`** — for one-off elements.
- **Grouped/dynamic lists** — tag nav data with `requires` and filter (no wrapper-per-item):
  ```svelte
  {#each navItems.filter(i => !i.requires || can(i.requires)) as item}…{/each}
  ```
- **Server enforcement** — same `can()` in `+page.server.ts` / `+layout.server.ts`: `if (!can('users.manage', locals.user, perms)) throw error(403)`. Client hiding is UX only; the server is the gate.

---

## Module 5 — RLS (defense-in-depth, Postgres only)

Enable RLS on `profiles`, `user_identities`, `join_request`, `join_link`. Policies:
- **Owner:** `auth.uid()` matches the row's user (`profiles.id`, `user_identities.user_id` via profile, `join_request.supabase_id`) → select/insert/update own.
- **Admin/super-admin:** `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin'))` → select/update all (super-admin also for cross-org rows).
- `join_link`: admin/super-admin only for all ops; no owner concept.

Server service-role paths bypass RLS by design — documented in the migration comment so it isn't mistaken for the enforcement layer.

---

## Services (shared-ready)

- `join-requests.service` (PG via supabase-admin): `createRequest`, `listPending`, `approve`, `deny`.
- `join-links.service` (PG via supabase-admin): `createLink`, `resolveLink(token)`, `consumeLink(token, user)`, `revoke`. `consumeLink` and `approve` both call one shared **`createMembership(user, orgId, role)`** helper (Turso: insert `member` + ensure `user` row) so hub-now / site-later behave identically. `consumeLink` guards `max_uses`/`revoked`/`expires_at` and increments `uses_count` atomically.
- Pure helpers (unit-testable, no I/O): `generateOpaqueToken()`, `isLinkUsable(link, now)`, `can()`.

## Data Flow

```
New Google user → Supabase OAuth → profile (role=user, no member)
  → (app) layout: no membership → redirect /join
     ├─ ?token  → resolveLink(PG) → consumeLink → createMembership(Turso) → /
     └─ no token → request form → join_request(PG, pending) → email all admins
                                     → admin approves → createMembership(Turso) → next login OK
```

## Error Handling

- Invalid/expired/revoked/maxed link → friendly `/join` message + fall back to request form.
- Duplicate pending request → idempotent (return existing, show "pending").
- Link consume race on `max_uses` → atomic conditional update (`uses_count < max_uses`); loser sees "link no longer available".
- Approval of an already-approved/denied request → no-op with clear message.

## Testing

- **Unit (pure):** `generateOpaqueToken` (uniqueness/length), `isLinkUsable` (expiry/revoke/max matrix), `can()` against the ACCESS map (user/admin/super_admin × minRole/permission), `mapProfileToUser` super_admin mapping.
- **Service:** request lifecycle (create→approve→membership exists in Turso; create→deny), link create→consume→uses_count increment→max-uses exhaustion, `createMembership` idempotency.
- **RLS:** smoke test with two PG clients (owner vs other; admin) confirming row visibility.
- **Route/component:** light — `/join` token-vs-form branch, `<RoleGate>` show/hide, nav filter.

## Out of Scope (future)

- Broader Turso→Postgres migration (RLS over app data).
- Multi-org request targeting UI beyond Default (approval already accepts an org param).
- Runtime-toggleable feature flags or an installable plugin for super-views (internal registry chosen).
- Site-side request entry point (data layer is shared-ready; UI deferred).
