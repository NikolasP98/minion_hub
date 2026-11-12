# Organization role templates

New organization role provisioning is controlled by `ORG_ROLE_TEMPLATES_ENABLED`.
The default is `false`. Apply both `20261112010000_organization_role_templates.sql`
and `20261112020000_notification_role_model_sources.sql` before enabling it.
The latter retains the notification worker's column privileges and live source fence.

When enabled, provisioning creates an organization with `role_model='organization'`,
one local Administrator role, explicit permissions, and an explicit assignment to its
creator. Ownership remains a separate organization membership attribute. The initial
default role is Administrator, so admitted members initially receive full access.
Changing the default affects future admissions; existing assignments remain intact.

Existing organizations retain `role_model='legacy'`. The flag does not convert them.
Turning the flag off stops new-model provisioning. It does not change organizations
already created with the new model. Retain their metadata and assignments on rollback.

## Rollout order

Use a planned notification maintenance window. This procedure does not authorize
production migration, worker activation, or enabling `ORG_ROLE_TEMPLATES_ENABLED`.
Keep that flag `false` until the owner approves the release.

The full new notification projector requires both migrations even when new
organization provisioning is disabled. Its SQL reads `organizations.role_model`
and the restricted `org_roles` source. The previous worker's strict catalog check
rejects the additional source grants and fence installed by migration `20000`.
The new catalog checker accepts the reviewed catalog before and after that change,
but the full new projector cannot process the pre-migration schema.

1. Follow the [worker release runbook's later-upgrade procedure](../scripts/ops/hub-worker-release.md#later-upgrades).
   For an active worker, stop admission, signal its owned lifecycle to drain, and
   require actual process exit. Keep `NOTIFICATION_WORKER=0` in the reviewed host
   environment while staging. Changing the environment alone does not stop an
   already running owner. Retain durable queued work, leases, receipts, and evidence.
2. Apply `20261112010000_organization_role_templates.sql`, then
   `20261112020000_notification_role_model_sources.sql` through the approved
   migration process. Keep the old worker stopped throughout both migrations.
3. Deploy the compatible full Hub readers and notification worker artifact with
   `ORG_ROLE_TEMPLATES_ENABLED=false`. Stage the owned adapter-node service with
   `NOTIFICATION_WORKER=0` and verify its immutable artifact identity and the
   release runbook's host and listener requirements.
4. If a qualified worker was active before this upgrade, resume only the new
   artifact within the approved window. Verify catalog admission, a single live
   owner, its build/catalog/projector identity, heartbeat, and authorized legacy
   projection/readback evidence. A deployment does not authorize a first worker
   activation; follow the separate first-activation gate if no worker was active.
5. Enable `ORG_ROLE_TEMPLATES_ENABLED=true` only after compatible consumers,
   migration/native evidence, and runtime verification pass and the owner approves
   activation. New organization creation is the final switch.

Notification processing may pause and durable work may accumulate during this
window. This is not a zero-interruption rollout. Do not deploy the old worker
against migration `20000`, remove its source fence to admit an old artifact, or
restart incompatible code as an automatic rollback. On failure, keep provisioning
disabled, preserve evidence, and use a compatible forward repair. Turning the
provisioning flag off does not remove organization-model rows or permit reverting
their readers.

## Create and manage roles

Use Settings → Roles to copy a versioned Administrator, Manager, Staff, or Viewer
template, duplicate an existing role, or create a blank role. Template copies are
independent. A rename preserves the role key and existing references. Creating a role
does not assign it to anyone. The catalog supports at most 256 local roles per organization.

The `roles` module has independent view, create, edit, and delete permissions.
The Manager template grants those four actions within the manager's own permissions.
Staff and Viewer templates grant none. Existing global Manager data permissions stay unchanged.
Team membership administration uses `users:manage`; it does not grant role editing.
Changing the default requires both `users:manage` and `roles:edit`.

Grant ceilings apply to future grants in existing legacy organizations too. Role
assignment and admission refresh current actual and simulated authority under the
organization policy lock. Removing the final explicit legacy assignment must not
expose a membership fallback broader than the actor can grant.

A grantor cannot exceed their current data actions, record scope, field access, page
access, or rank. Simulation additionally restricts the real actor's current authority.
Brain sharing and visibility changes recheck current module and object write authority
inside the mutation transaction. Role grants also check existing role-linked
Brain ACLs and legacy Administrator access to current and future private Brains.
Permission edits recheck newly enabled Brain actions, and invitations freeze the
selected role's Brain ACL revision. Object checks use both actual and simulated
authority under the same organization lock as Brain ACL/visibility writers.
Known recipients are checked against their complete before/after role union.
Newly activated actions, record scope, read/export field tiers, page access and
role-management rank must fit the grantor's actual and effective authority.
Private Brain checks also include
creator rights, user ACLs and verified personal-agent read/write access. Agent
IDs supplied by callers do not prove ownership. Grantors use their current
browser profile authority; owning an agent does not expand that grant authority.

The object-authority snapshot supports at most 4,096 Brains and 65,536 ACL
rows and matching personal-agent bindings per organization. A permission edit
also supports at most 4,096 affected members and a one-million-cell evaluation
budget per data/object plane. Exceeding a bound rejects the grant with 503; results are never truncated
into a permissive answer.

Removing the final owner or recoverable access
administrator is rejected. An access administrator must retain the role and Team
management capabilities and pages required to repair access.

## Invitations

New-model invitations store the chosen local role, its revision, and the grantor.
Redemption revalidates that snapshot and the grantor's current authority.
New legacy invitations also record and verify their grantor and role revision.
An older legacy invitation without that provenance cannot admit a new member:
the administrator must issue a new link. Existing-member replay remains a no-op. A later
change to the default does not change an outstanding invitation. If the role or
its authority changes, issue a new invitation. Redeeming as an existing member
does not promote that member or consume another use. Re-admission of an inactive
member replaces stale role assignments with exactly the verified invited role.
Retained private-object rights are checked before they can become usable again.

## Qualification

### Shared database client

The application shares a postgres-js pool with Drizzle. Drizzle changes that
client's JSON serializers and date parsers. Raw audit writes therefore use
`JSON.stringify(...)::text::jsonb`, and invitation expiry accepts both parsed
dates and timestamp strings. Role revisions use explicit key/name/rank projections
so date-parser changes cannot invalidate an unchanged catalog.

The native role, bootstrap and admission fixtures initialize Drizzle on the same
production-configured raw client. They verify stored audit arrays, dated invites
and stable revisions across that initialization boundary.

### Required checks

Run the normal `bun run check`, `bun run test`, and `bun run build` gates, plus
`bun run lint:design` and `bun run lint:tokens`. Native role suites are registered
in `scripts/qc/native-postgres-manifest.ts` and require an explicitly selected
loopback `HUB_TEST_DB_URL`; `REQUIRE_ORG_ROLES_POSTGRES=1` makes its absence an error.
The notification projection protocol requires its own guarded disposable PostgreSQL
fixture. Never point qualification commands at production.

The QA matrix includes an organization with one local Administrator and explicitly
assigned owner/member personas, plus a member without an assignment to prove denial.
`scripts/qa/seed/tenancy.ts` exports `seedOrganizationRoleFixtures` for additive
qualification of those fixtures without resetting the shared QA database.
