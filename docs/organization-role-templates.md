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
Staff and Viewer templates grant none. Existing global Manager permissions stay unchanged.
Team membership administration uses `users:manage`; it does not grant role editing.
Changing the default requires both `users:manage` and `roles:edit`.

A grantor cannot exceed their current data actions, record scope, field access, page
access, or rank. Simulation additionally restricts the real actor's current authority.
Brain sharing and visibility changes recheck current module and object write authority
inside the mutation transaction. Removing the final owner or recoverable access
administrator is rejected. An access administrator must retain the role and Team
management capabilities and pages required to repair access.

## Invitations

New-model invitations store the chosen local role, its revision, and the grantor.
Redemption revalidates that snapshot and the grantor's current authority. A later
change to the default does not change an outstanding invitation. If the role or
its authority changes, issue a new invitation. Redeeming as an existing member
does not promote that member or consume another use.

## Qualification

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
