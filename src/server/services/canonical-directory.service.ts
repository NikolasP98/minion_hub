import { getPgClient } from '$server/db/pg-pool';

export interface CanonicalProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  avatar_url: string | null;
  created_at: string | null;
  username: string | null;
}

export interface CanonicalOrganizationMembership {
  id: string;
  name: string;
  slug: string | null;
  kind: string | null;
  role: string;
}

/**
 * Read the identity row through the canonical Postgres connection.
 *
 * Authentication and tenancy must not depend on the optional PostgREST data
 * plane: a PostgREST outage previously degraded a valid user into a claims-only
 * identity and made existing organization memberships appear absent.
 */
export async function loadCanonicalProfile(profileId: string): Promise<CanonicalProfile | null> {
  try {
    const rows = await getPgClient()<CanonicalProfile[]>`
      select id, email, display_name, role, avatar_url, created_at, username
      from public.profiles
      where id = ${profileId}::uuid
      limit 1
    `;
    return rows[0] ?? null;
  } catch (error) {
    // Keep the previous migration-lag tolerance: enrichment columns may reach
    // application code before every database has them. Only undefined-column
    // gets a core-only retry; connection and authorization failures propagate.
    if ((error as { code?: unknown })?.code !== '42703') throw error;
    const rows = await getPgClient()<
      Array<Pick<CanonicalProfile, 'id' | 'email' | 'display_name' | 'role'>>
    >`
      select id, email, display_name, role
      from public.profiles
      where id = ${profileId}::uuid
      limit 1
    `;
    const profile = rows[0];
    return profile ? { ...profile, avatar_url: null, created_at: null, username: null } : null;
  }
}

/** All canonical organizations for a profile, ordered for deterministic defaults. */
export async function loadCanonicalMemberships(
  profileId: string,
): Promise<CanonicalOrganizationMembership[]> {
  return getPgClient()<CanonicalOrganizationMembership[]>`
    select
      o.id,
      o.name,
      o.slug,
      o.kind,
      m.role
    from public.organization_members m
    inner join public.organizations o on o.id = m.organization_id
    where m.profile_id = ${profileId}::uuid
    order by o.name asc, o.id asc
  `;
}

export async function hasCanonicalMembership(profileId: string, orgId?: string): Promise<boolean> {
  const rows = orgId
    ? await getPgClient()<Array<{ present: number }>>`
        select 1 as present
        from public.organization_members
        where profile_id = ${profileId}::uuid
          and organization_id = ${orgId}::uuid
        limit 1
      `
    : await getPgClient()<Array<{ present: number }>>`
        select 1 as present
        from public.organization_members
        where profile_id = ${profileId}::uuid
        limit 1
      `;
  return rows.length > 0;
}
