# RBAC Framework (ERPNext-inspired)

**Status:** Phase 1 shipped (2026-06-25). Phases 2–4 staged.
**Goal:** one well-structured, data-driven permission framework so every surface —
the dashboard UI, the API, and the agent's MCP tools — gates access through the
*same* model. "Respect per-user permissions": the agent can never do more than the
signed-in user.

## Model (maps ERPNext → Minion)

| ERPNext concept | Minion mechanism |
|---|---|
| Roles / Role Profiles | `permission_roles` catalog (owner>admin>manager>staff>viewer) + `member_roles` multi-role assignment per (org, profile) |
| Role Permission Manager (doctype×role rights) | capability matrix `role × module × action(view/create/edit/delete/export/manage)` — defaults in code (`rbac.service.DEFAULT` via `defaultCaps`), per-org overrides in `permission_rules` |
| Org isolation (≈ Company user-permission) | `app.current_org_id` GUC + PUBLIC `*_org_guc` RLS (already in place) |
| Read enforcement (data tier) | `app_assistant_ro` DB role: SELECT on business tables only, no writes (migration `assistant_ro_role`) |
| User Permissions (record-level) | **Phase 3** — per-user RLS predicate (`app.current_profile_id` GUC + assignee/owner match) |
| Permission Levels (field-level) | **Phase 4** — tiered read roles / restricted views hiding sensitive columns (cost, margin, PII) |

Effective capability for a member = OR across their roles of `override ?? code-default`,
per (module, action). Unknown role/module → NONE (fail-closed).

### Default matrix (code)
- **owner / admin** → all actions, all modules.
- **manager** → business modules: view/create/edit/export (no delete/manage); admin modules: view.
- **staff** → crm/scheduling/support/comms: view/create/edit; finance/sales/projects/memberships: view; admin modules: none.
- **viewer** → business modules: view only.
- **overview** → view for everyone.

Business modules: crm, finance, sales, scheduling, support, projects, memberships, comms.

## Enforcement layers (defense in depth)
1. **DB role + RLS** — `app_assistant_ro` (table scope + read-only) + org GUC (cross-org). Authoritative; a bug in app code can't widen it.
2. **API capability check** — endpoints call `resolveCapabilities(org, profile)` and gate (`capabilities.canRunAnalytics()`, `can(module, action)`).
3. **Agent inheritance** — the agent's data tools hit those same endpoints under the owner's principal, so they inherit the user's caps automatically.

## Phase status
- **Phase 1 — foundation (DONE):** migration `permissions_framework` (3 tables, seeded catalog, members backfilled `member→manager` so nobody loses access). `rbac.service.ts` engine + tests. `resolveAssistantPrincipal` now returns `capabilities`; `/api/gateway/query` gates on `canRunAnalytics()`, `/api/gateway/insight` on `can('crm'|'finance','view')`.
- **Phase 2 — enforcement everywhere:** unify the legacy platform-permission path (`permissions.service.ts` / `$lib/permissions`, today derived from `profiles.role`) behind this engine; emit `resource:action` strings from caps so existing UI nav gating becomes role-matrix-driven; add per-module guards to business API routes; build the Role Permission Manager UI (writes `permission_rules`).
- **Phase 3 — record-level:** `app.current_profile_id` GUC in `withOrgCore`/query txn; RLS predicates `role allows all OR owner/assignee = current profile` for staff-tier roles (ERPNext "if owner" / User Permissions).
- **Phase 4 — field-level:** tiered read DB roles (e.g. `app_assistant_ro` vs a `*_sensitive` role) or column-restricted views to hide cost/margin/PII from lower roles (ERPNext permission levels).

## MCP topology decision
Single consolidated agent toolset (not per-module servers + router): one Postgres
core DB behind one RLS/role boundary, so there's no backend to federate. `crm_query`
is comprehensive read coverage; future write tools join the same namespace, each
gated by this matrix. Matches `mcp-builder` guidance (consolidate, consistent
prefixes, focused responses).
