import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireDevBackend } from '$server/dev-backend';
import { requireAuth } from '$server/auth/authorize';
import { supabaseAdmin } from '$server/supabase';
import { legacyRoleKey, SYSTEM_ROLE_KEYS } from '$server/services/rbac.service';

/** owner > admin > manager > staff > viewer, per rbac.service.ts's model comment. */
const ROLE_RANK = new Map(SYSTEM_ROLE_KEYS.map((key, i) => [key as string, i]));
function roleRank(key: string): number {
  return ROLE_RANK.get(key) ?? SYSTEM_ROLE_KEYS.length; // custom roles sort after system roles
}

const LIST_CAP = 500;
const PAGE_SIZE = 200;

interface DevOrgEntry {
  orgId: string;
  orgName: string;
  orgKind: string;
  roleKey: string;
}

interface DevUserEntry {
  id: string;
  email: string | null;
  displayName: string | null;
  username: string | null;
  platformRole: string | null;
  orgs: DevOrgEntry[];
}

/**
 * GET /api/dev/users — spec §2.2. Every user in the DEV database, grouped by
 * org and role, capped at 500, sorted by org name then role rank then name.
 * Users with zero orgs are included last (the no-org persona exercises
 * /join). DEV-only (404 elsewhere); any authenticated role may call this.
 */
export const GET: RequestHandler = async ({ locals }) => {
  requireDevBackend(locals);
  requireAuth(locals);

  const admin = supabaseAdmin();

  const authUsers: Array<{ id: string; email?: string }> = [];
  for (let page = 1; authUsers.length < LIST_CAP; page += 1) {
    const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (listErr) throw listErr;
    authUsers.push(...data.users);
    if (data.users.length < PAGE_SIZE) break;
  }
  const ids = authUsers.slice(0, LIST_CAP).map((u) => u.id);
  if (ids.length === 0) return json({ users: [] });

  const [
    { data: profiles, error: pErr },
    { data: memberRoles, error: mrErr },
    { data: legacyMembers, error: lmErr },
    { data: orgs, error: oErr },
  ] = await Promise.all([
    admin.from('profiles').select('id, display_name, username, role').in('id', ids),
    admin.from('member_roles').select('org_id, profile_id, role_key').in('profile_id', ids),
    admin
      .from('organization_members')
      .select('organization_id, profile_id, role')
      .in('profile_id', ids),
    admin.from('organizations').select('id, name, kind'),
  ]);
  if (pErr) throw pErr;
  if (mrErr) throw mrErr;
  if (lmErr) throw lmErr;
  if (oErr) throw oErr;

  const orgsById = new Map(
    ((orgs ?? []) as Array<{ id: string; name: string; kind: string }>).map((o) => [o.id, o]),
  );

  const orgsByUser = new Map<string, DevOrgEntry[]>();
  const seenPairs = new Set<string>();
  for (const row of (memberRoles ?? []) as Array<{
    org_id: string;
    profile_id: string;
    role_key: string;
  }>) {
    const org = orgsById.get(row.org_id);
    if (!org) continue;
    seenPairs.add(`${row.org_id}:${row.profile_id}`);
    const list = orgsByUser.get(row.profile_id) ?? [];
    list.push({ orgId: org.id, orgName: org.name, orgKind: org.kind, roleKey: row.role_key });
    orgsByUser.set(row.profile_id, list);
  }
  // Legacy fallback (pre-RBAC members with no member_roles row) — skip any
  // (org, profile) pair member_roles already covered.
  for (const row of (legacyMembers ?? []) as Array<{
    organization_id: string;
    profile_id: string;
    role: string | null;
  }>) {
    const key = `${row.organization_id}:${row.profile_id}`;
    if (seenPairs.has(key)) continue;
    const org = orgsById.get(row.organization_id);
    if (!org) continue;
    const list = orgsByUser.get(row.profile_id) ?? [];
    list.push({
      orgId: org.id,
      orgName: org.name,
      orgKind: org.kind,
      roleKey: legacyRoleKey(row.role),
    });
    orgsByUser.set(row.profile_id, list);
  }
  for (const list of orgsByUser.values()) list.sort((a, b) => a.orgName.localeCompare(b.orgName));

  const profilesById = new Map(
    (
      (profiles ?? []) as Array<{
        id: string;
        display_name: string | null;
        username: string | null;
        role: string | null;
      }>
    ).map((p) => [p.id, p]),
  );

  const users: DevUserEntry[] = authUsers.slice(0, LIST_CAP).map((u) => {
    const profile = profilesById.get(u.id);
    return {
      id: u.id,
      email: u.email ?? null,
      displayName: profile?.display_name ?? null,
      username: profile?.username ?? null,
      platformRole: profile?.role ?? null,
      orgs: orgsByUser.get(u.id) ?? [],
    };
  });

  users.sort((a, b) => {
    const aOrg = a.orgs[0];
    const bOrg = b.orgs[0];
    if (!aOrg || !bOrg) {
      if (!aOrg && !bOrg) return nameOf(a).localeCompare(nameOf(b));
      return aOrg ? -1 : 1; // no-org users sort last
    }
    const orgCmp = aOrg.orgName.localeCompare(bOrg.orgName);
    if (orgCmp !== 0) return orgCmp;
    const rankCmp = roleRank(aOrg.roleKey) - roleRank(bOrg.roleKey);
    if (rankCmp !== 0) return rankCmp;
    return nameOf(a).localeCompare(nameOf(b));
  });

  return json({ users });
};

function nameOf(u: DevUserEntry): string {
  return u.displayName ?? u.email ?? u.id;
}
