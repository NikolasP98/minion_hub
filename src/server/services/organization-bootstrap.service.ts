import { randomUUID } from 'node:crypto';
import { getPgClient } from '$server/db/pg-pool';
import { MODULES, ACTIONS, defaultCaps, defaultFieldLevel } from './rbac.service';

export const INITIAL_ADMINISTRATOR_KEY = 'custom-administrator';
export interface BootstrappedOrganization {
  id: string;
  name: string;
  slug: string;
  roleModel: 'legacy' | 'organization';
  created: boolean;
}

/** Bootstrap is the only new-model writer; external provisioning happens after commit. */
export async function bootstrapOrganization(
  input: { name: string; slug: string; profileId: string; organizationId?: string | null },
  client = getPgClient(),
): Promise<BootstrappedOrganization> {
  return client.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${input.profileId},114))`;
    const [creator] = await tx<{ pending: boolean }[]>`
      select coalesce((to_jsonb(p)->>'deletion_pending')::boolean,false) as pending
      from profiles p where id=${input.profileId}::uuid for share`;
    if (!creator || creator.pending) throw new Error('An active creator account is required');
    await tx`select pg_advisory_xact_lock(hashtextextended(${`org-bootstrap:${input.slug}`},113))`;
    const [existing] = await tx<
      {
        id: string;
        name: string;
        slug: string;
        role_model: 'legacy' | 'organization';
        status: string;
      }[]
    >`select id,name,slug,role_model,status from organizations where slug=${input.slug}`;
    if (existing) {
      if (input.organizationId && existing.id !== input.organizationId)
        throw new Error('Organization slug already exists with a different Workforce company ID');
      await tx`select pg_advisory_xact_lock(hashtextextended(${existing.id},112))`;
      const [current] = await tx<
        {
          id: string;
          name: string;
          slug: string;
          role_model: 'legacy' | 'organization';
          status: string;
        }[]
      >`
        select id,name,slug,role_model,status from organizations where id=${existing.id}::uuid for update`;
      if (current?.status !== 'active')
        throw new Error('Active organization required for provisioning');
      if (!current || current.slug !== input.slug)
        throw new Error('Organization changed during provisioning retry');
      const [membership] = await tx<{ role: string }[]>`
        select role from organization_members where organization_id=${existing.id}::uuid
        and profile_id=${input.profileId}::uuid for share`;
      if (membership?.role !== 'owner')
        throw new Error('Existing organization must be retried by its owner');
      // Retrying a partial external provisioning step must never reset role
      // edits or grant Administrator to an existing restricted member.
      return { ...current, roleModel: current.role_model, created: false };
    }
    const id = input.organizationId ?? randomUUID();
    await tx`select pg_advisory_xact_lock(hashtextextended(${id},112))`;
    const [organization] = await tx<{ id: string; name: string; slug: string }[]>`
      insert into organizations(id,name,slug,role_model,default_role_key)
      values(${id}::uuid,${input.name},${input.slug},'organization',${INITIAL_ADMINISTRATOR_KEY})
      returning id,name,slug`;
    await tx`insert into org_roles(org_id,key,name,rank,source_role_key,template_id,template_version,created_by)
      values(${id},${INITIAL_ADMINISTRATOR_KEY},'Administrator',80,'admin','admin',1,${input.profileId})`;
    const rules = MODULES.map((module) => {
      const caps = defaultCaps('admin', module);
      return {
        org_id: id,
        role_key: INITIAL_ADMINISTRATOR_KEY,
        module,
        ...Object.fromEntries(ACTIONS.map((action) => [`can_${action}`, caps[action]])),
        if_owner: false,
        field_level: defaultFieldLevel(module),
      };
    });
    await tx`insert into permission_rules ${tx(rules)}`;
    await tx`insert into organization_members(organization_id,profile_id,role)
      values(${id}::uuid,${input.profileId}::uuid,'owner')`;
    await tx`insert into member_roles(org_id,profile_id,role_key,granted_by)
      values(${id}::uuid,${input.profileId}::uuid,${INITIAL_ADMINISTRATOR_KEY},${input.profileId}::uuid)`;
    await tx`insert into doc_audit_log(org_id,ref_type,ref_id,actor_id,op,changes)
      values(${id},'organization',${id}::uuid,${input.profileId}::uuid,'create',
      ${JSON.stringify([{ field: 'role_model', old: null, new: 'organization', defaultRole: INITIAL_ADMINISTRATOR_KEY }])}::text::jsonb)`;
    return { ...organization, roleModel: 'organization' as const, created: true };
  });
}
