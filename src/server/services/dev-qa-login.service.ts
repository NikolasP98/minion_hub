import { supabaseAdmin } from '$server/supabase';
import { legacyRoleKey, SYSTEM_ROLE_KEYS } from '$server/services/rbac.service';

const QA_DOMAIN = 'qa.minion.test';
const UI_AUDIT_EMAILS = new Set([
  'ui-audit-owner@minion.test',
  'ui-audit-manager@minion.test',
  'ui-audit-member@minion.test',
  'ui-audit-restricted@minion.test',
]);

export const DEV_QA_AUTH_SCAN_CAP = 5_000;
export const DEV_QA_ELIGIBLE_CAP = 500;
export const DEV_QA_AUTH_PAGE_SIZE = 200;

export interface DevQaLoginOrg {
  orgName: string;
  roleKey: string;
}

export interface DevQaLoginUser {
  id: string;
  email: string;
  displayName: string | null;
  orgs: DevQaLoginOrg[];
}

export interface DevQaLoginList {
  users: DevQaLoginUser[];
  truncated: boolean;
}

/** Normalize only ASCII email syntax used by synthetic QA identities. */
export function normalizeEligibleQaEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().replace(/[A-Z]/g, (char) => char.toLowerCase());
  if (!email || /[^\x00-\x7F]/.test(email)) return null;
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (parts[1] === QA_DOMAIN || UI_AUDIT_EMAILS.has(email)) return email;
  return null;
}

const ROLE_RANK = new Map(SYSTEM_ROLE_KEYS.map((key, index) => [key as string, index]));
function roleRank(roleKey: string): number {
  return ROLE_RANK.get(roleKey) ?? SYSTEM_ROLE_KEYS.length;
}

export async function listDevQaLoginUsers(): Promise<DevQaLoginList> {
  const admin = supabaseAdmin();
  const selected: Array<{ id: string; email: string }> = [];
  let scanned = 0;
  let truncated = false;

  for (let page = 1; scanned < DEV_QA_AUTH_SCAN_CAP; page += 1) {
    const remaining = DEV_QA_AUTH_SCAN_CAP - scanned;
    const perPage = Math.min(DEV_QA_AUTH_PAGE_SIZE, remaining);
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const rows = data.users;
    scanned += rows.length;

    for (const row of rows) {
      const email = normalizeEligibleQaEmail(row.email);
      if (!email) continue;
      if (selected.length < DEV_QA_ELIGIBLE_CAP) selected.push({ id: row.id, email });
      else truncated = true;
    }

    if (rows.length < perPage) break;
    if (scanned >= DEV_QA_AUTH_SCAN_CAP) truncated = true;
  }

  if (selected.length === 0) return { users: [], truncated };
  const ids = selected.map((user) => user.id);
  const [profilesResult, memberRolesResult, legacyMembersResult] = await Promise.all([
    admin.from('profiles').select('id, display_name').in('id', ids),
    admin.from('member_roles').select('org_id, profile_id, role_key').in('profile_id', ids),
    admin
      .from('organization_members')
      .select('organization_id, profile_id, role')
      .in('profile_id', ids),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (memberRolesResult.error) throw memberRolesResult.error;
  if (legacyMembersResult.error) throw legacyMembersResult.error;

  const memberRoles = (memberRolesResult.data ?? []) as Array<{
    org_id: string;
    profile_id: string;
    role_key: string;
  }>;
  const legacyMembers = (legacyMembersResult.data ?? []) as Array<{
    organization_id: string;
    profile_id: string;
    role: string | null;
  }>;
  const organizationIds = [
    ...new Set([
      ...memberRoles.map((row) => row.org_id),
      ...legacyMembers.map((row) => row.organization_id),
    ]),
  ];
  const organizationsResult =
    organizationIds.length === 0
      ? { data: [], error: null }
      : await admin.from('organizations').select('id, name').in('id', organizationIds);
  if (organizationsResult.error) throw organizationsResult.error;

  const profilesById = new Map(
    ((profilesResult.data ?? []) as Array<{ id: string; display_name: string | null }>).map(
      (row) => [row.id, row.display_name],
    ),
  );
  const orgNames = new Map(
    ((organizationsResult.data ?? []) as Array<{ id: string; name: string }>).map((row) => [
      row.id,
      row.name,
    ]),
  );
  const orgsByUser = new Map<string, DevQaLoginOrg[]>();
  const covered = new Set<string>();

  for (const row of memberRoles) {
    const orgName = orgNames.get(row.org_id);
    if (!orgName) continue;
    covered.add(`${row.org_id}:${row.profile_id}`);
    const orgs = orgsByUser.get(row.profile_id) ?? [];
    orgs.push({ orgName, roleKey: row.role_key });
    orgsByUser.set(row.profile_id, orgs);
  }
  for (const row of legacyMembers) {
    if (covered.has(`${row.organization_id}:${row.profile_id}`)) continue;
    const orgName = orgNames.get(row.organization_id);
    if (!orgName) continue;
    const orgs = orgsByUser.get(row.profile_id) ?? [];
    orgs.push({ orgName, roleKey: legacyRoleKey(row.role) });
    orgsByUser.set(row.profile_id, orgs);
  }
  for (const orgs of orgsByUser.values()) {
    orgs.sort((a, b) => a.orgName.localeCompare(b.orgName) || a.roleKey.localeCompare(b.roleKey));
  }

  const users = selected.map((user) => ({
    ...user,
    displayName: profilesById.get(user.id) ?? null,
    orgs: orgsByUser.get(user.id) ?? [],
  }));
  users.sort((a, b) => {
    const aOrg = a.orgs[0];
    const bOrg = b.orgs[0];
    if (aOrg && bOrg) {
      const org = aOrg.orgName.localeCompare(bOrg.orgName);
      if (org !== 0) return org;
      const role = roleRank(aOrg.roleKey) - roleRank(bOrg.roleKey);
      if (role !== 0) return role;
    } else if (aOrg || bOrg) {
      return aOrg ? -1 : 1;
    }
    const name = (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email);
    return name || a.email.localeCompare(b.email) || a.id.localeCompare(b.id);
  });
  return { users, truncated };
}
