/**
 * Tenancy & identity — organizations, GoTrue users, memberships, roles,
 * app_modules, personal_agents, join links/requests. Everything downstream
 * (crm/catalog/pos/…) references the org ids exported here.
 *
 * Recon disagreement (see task brief "verify against code; code wins"):
 * `personal_agents` is declared as a Postgres table in
 * `@minion-stack/db/pg/schema/personal-agents.ts` and imported from
 * `@minion-stack/db/pg` by `src/server/services/personal-agent.service.ts` —
 * it is NOT a libsql/gateway table. Seeded here, not in gateway-libsql.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { matrixUuid, matrixTextId, personaEmail, QA_PASSWORD } from './ids';
import type { SeedContext } from './db';

export const ORG_BUSINESS = matrixUuid('tenancy.org.business');
export const ORG_PERSONAL = matrixUuid('tenancy.org.personal');
export const ORG_MODULES_OFF = matrixUuid('tenancy.org.business.modules-off');
export const ORG_IDENTITY_REQUIRED = matrixUuid('tenancy.org.business.identity-required');

/** GoTrue id for a user matrix id — every other module that needs "the owner"
 *  or "a contact's linked profile" calls this instead of re-deriving it. */
export function userId(matrixId: string): string {
  return matrixUuid(matrixId);
}

/** Find-or-create a GoTrue user by email, idempotently. Shared with
 *  ui-audit-compat.ts so the four ui-audit-* personas provision the same way. */
export async function findOrCreateGoTrueUser(
  admin: SupabaseClient,
  id: string,
  email: string,
  password: string,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email === email);
    if (found) {
      const { error: updateError } = await admin.auth.admin.updateUserById(found.id, {
        password,
        email_confirm: true,
        user_metadata: metadata,
      });
      if (updateError) throw updateError;
      return found.id;
    }
    if (data.users.length < 200) break;
  }
  // GoTrue assigns its own id unless the deployment supports a caller-supplied
  // one; we ask for `id` (deterministic) but fall back to whatever comes back
  // so a stack that ignores it still works — callers key off the RETURN value.
  const created = await admin.auth.admin.createUser({
    id,
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (created.error || !created.data.user) {
    // Retry without the explicit id — some GoTrue versions reject a client-chosen uuid.
    const retry = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (retry.error || !retry.data.user)
      throw retry.error ?? new Error(`createUser failed for ${email}`);
    return retry.data.user.id;
  }
  return created.data.user.id;
}

interface UserSpec {
  id: string;
  systemRole: string | null; // member_roles.role_key ('custom-reception' for the custom-role persona)
  sourceRoleKey?: string; // createCustomRole-style: what the custom role was cloned from
  legacyRole: 'owner' | 'admin' | 'member';
  orgs: string[]; // organization ids this user belongs to
  platformAdmin?: boolean;
  accountType?: 'person' | 'service';
  provisioningStatus?: 'pending' | 'provisioning' | 'active' | 'error';
  skipMemberRoles?: boolean; // the legacy-member fallback path
}

const USERS: UserSpec[] = [
  { id: 'tenancy.user.owner', systemRole: 'owner', legacyRole: 'owner', orgs: [ORG_BUSINESS] },
  { id: 'tenancy.user.admin', systemRole: 'admin', legacyRole: 'admin', orgs: [ORG_BUSINESS] },
  { id: 'tenancy.user.manager', systemRole: 'manager', legacyRole: 'member', orgs: [ORG_BUSINESS] },
  { id: 'tenancy.user.staff', systemRole: 'staff', legacyRole: 'member', orgs: [ORG_BUSINESS] },
  { id: 'tenancy.user.viewer', systemRole: 'viewer', legacyRole: 'member', orgs: [ORG_BUSINESS] },
  {
    id: 'tenancy.user.custom-role',
    systemRole: 'custom-reception',
    sourceRoleKey: 'staff',
    legacyRole: 'member',
    orgs: [ORG_BUSINESS],
  },
  {
    id: 'tenancy.user.legacy-member',
    systemRole: null,
    legacyRole: 'member',
    orgs: [ORG_BUSINESS],
    skipMemberRoles: true,
  },
  {
    id: 'tenancy.user.platform-admin',
    systemRole: 'staff',
    legacyRole: 'member',
    orgs: [ORG_BUSINESS],
    platformAdmin: true,
  },
  {
    id: 'tenancy.user.service-account',
    systemRole: 'staff',
    legacyRole: 'member',
    orgs: [ORG_BUSINESS],
    accountType: 'service',
  },
  {
    id: 'tenancy.user.pending-agent',
    systemRole: 'staff',
    legacyRole: 'member',
    orgs: [ORG_BUSINESS],
    provisioningStatus: 'pending',
  },
  { id: 'tenancy.user.no-org', systemRole: null, legacyRole: 'member', orgs: [] },
  {
    id: 'tenancy.user.two-orgs',
    systemRole: 'staff',
    legacyRole: 'member',
    orgs: [ORG_BUSINESS, ORG_PERSONAL],
  },
];

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, admin, register, now } = ctx;

  await sql`
    insert into organizations (id, name, slug, kind)
    values
      (${ORG_BUSINESS}, 'QA Business Org', 'qa-business', 'business'),
      (${ORG_PERSONAL}, 'QA Personal Org', 'qa-personal', 'personal'),
      (${ORG_MODULES_OFF}, 'QA Modules-Off Org', 'qa-modules-off', 'business'),
      (${ORG_IDENTITY_REQUIRED}, 'QA Identity-Required Org', 'qa-identity-required', 'business')
    on conflict (id) do update set name = excluded.name, slug = excluded.slug, kind = excluded.kind
  `;
  for (const [id, matrixId] of [
    [ORG_BUSINESS, 'tenancy.org.business'],
    [ORG_PERSONAL, 'tenancy.org.personal'],
    [ORG_MODULES_OFF, 'tenancy.org.business.modules-off'],
    [ORG_IDENTITY_REQUIRED, 'tenancy.org.business.identity-required'],
  ] as const) {
    register(matrixId, { table: 'organizations', where: { id } });
  }

  await sql`
    insert into app_modules (org_id, module_id, enabled)
    values
      (${ORG_MODULES_OFF}, 'pos', false),
      (${ORG_MODULES_OFF}, 'stock', false)
    on conflict (org_id, module_id) do update set enabled = excluded.enabled
  `;

  await sql`
    insert into pos_settings (org_id, requirements)
    values (${ORG_IDENTITY_REQUIRED}, ${sql.json({ identityDocument: 'required' })})
    on conflict (org_id) do update set requirements = excluded.requirements
  `;

  for (const spec of USERS) {
    const id = userId(spec.id);
    const email = personaEmail(spec.id);
    const gotrueId = await findOrCreateGoTrueUser(admin, id, email, QA_PASSWORD, {
      full_name: spec.id,
    });

    await sql`
      insert into profiles (id, email, display_name, role, account_type)
      values (
        ${gotrueId}, ${email}, ${spec.id}, ${spec.platformAdmin ? 'admin' : 'user'},
        ${spec.accountType ?? 'person'}
      )
      on conflict (id) do update set
        email = excluded.email, display_name = excluded.display_name,
        role = excluded.role, account_type = excluded.account_type
    `;
    // 'tenancy.user.pending-agent' and 'tenancy.user.legacy-member' are
    // registered below against the table their matrix entry actually
    // promises (personal_agents / organization_members) — registering them
    // here too would just be overwritten (a duplicate registration).
    if (spec.id !== 'tenancy.user.pending-agent' && spec.id !== 'tenancy.user.legacy-member') {
      register(spec.id, { table: 'profiles', where: { id: gotrueId } });
    }

    for (const orgId of spec.orgs) {
      await sql`
        insert into organization_members (organization_id, profile_id, role)
        values (${orgId}, ${gotrueId}, ${spec.legacyRole})
        on conflict (organization_id, profile_id) do update set role = excluded.role
      `;
      if (!spec.skipMemberRoles && spec.systemRole) {
        await sql`
          insert into member_roles (org_id, profile_id, role_key)
          values (${orgId}, ${gotrueId}, ${spec.systemRole})
          on conflict (org_id, profile_id, role_key) do nothing
        `;
      }
    }

    const primaryOrg = spec.orgs[0];
    if (spec.systemRole === 'custom-reception' && primaryOrg) {
      await sql`
        insert into org_roles (org_id, key, name, rank, source_role_key, created_by)
        values (${primaryOrg}, 'custom-reception', 'Reception (QA)', 40, ${spec.sourceRoleKey ?? 'staff'}, ${gotrueId})
        on conflict (org_id, key) do update set name = excluded.name
      `;
      await sql`
        insert into permission_rules (org_id, role_key, module, can_view, can_create, can_edit, can_delete, can_export, can_manage, if_owner)
        values (${primaryOrg}, 'custom-reception', 'pos', true, true, true, false, false, false, true)
        on conflict (org_id, role_key, module) do update set if_owner = excluded.if_owner
      `;
    }

    if (primaryOrg) {
      const agentId = matrixTextId(spec.id, 'personal-agent');
      await sql`
        insert into personal_agents (id, profile_id, agent_id, display_name, provisioning_status)
        values (${agentId}, ${gotrueId}, ${agentId}, ${`${spec.id} agent`}, ${spec.provisioningStatus ?? 'active'})
        on conflict (profile_id) do update set provisioning_status = excluded.provisioning_status
      `;
    }
  }
  register('tenancy.user.pending-agent', {
    table: 'personal_agents',
    where: { profile_id: userId('tenancy.user.pending-agent'), provisioning_status: 'pending' },
  });
  register('tenancy.user.legacy-member', {
    table: 'organization_members',
    where: { organization_id: ORG_BUSINESS, profile_id: userId('tenancy.user.legacy-member') },
  });

  // join_request / join_link — three fixed rows, org.business.
  const pendingRequestId = matrixUuid('tenancy.join.request-pending');
  await sql`
    insert into join_request (id, supabase_id, user_id, email, display_name, status, organization_id, requested_role)
    values (
      ${pendingRequestId}, ${userId('tenancy.user.no-org')}, ${userId('tenancy.user.no-org')},
      ${personaEmail('tenancy.user.no-org')}, 'QA No-Org Requester', 'pending', ${ORG_BUSINESS}, 'user'
    )
    on conflict (id) do update set status = excluded.status
  `;
  register('tenancy.join.request-pending', {
    table: 'join_request',
    where: { id: pendingRequestId },
  });

  const expiredToken = 'qa-join-link-expired';
  const revokedToken = 'qa-join-link-revoked';
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  await sql`
    insert into join_link (id, token, organization_id, role, created_by, expires_at, revoked)
    values
      (${matrixUuid('tenancy.join.link-expired')}, ${expiredToken}, ${ORG_BUSINESS}, 'user', ${userId('tenancy.user.owner')}, ${yesterday}, false),
      (${matrixUuid('tenancy.join.link-revoked')}, ${revokedToken}, ${ORG_BUSINESS}, 'user', ${userId('tenancy.user.owner')}, null, true)
    on conflict (token) do update set expires_at = excluded.expires_at, revoked = excluded.revoked
  `;
  register('tenancy.join.link-expired', { table: 'join_link', where: { token: expiredToken } });
  register('tenancy.join.link-revoked', { table: 'join_link', where: { token: revokedToken } });
}
