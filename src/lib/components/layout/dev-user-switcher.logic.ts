/**
 * Pure grouping/filtering logic for DevUserSwitcher.svelte, extracted so it's
 * unit-testable without mounting the component (spec
 * 2026-09-16-hub-minion-run-dev-switcher §2.3, deliverable 5).
 */

export interface DevOrgEntry {
  orgId: string;
  orgName: string;
  orgKind: string;
  roleKey: string;
}

export interface DevUserEntry {
  id: string;
  email: string | null;
  displayName: string | null;
  username: string | null;
  platformRole: string | null;
  orgs: DevOrgEntry[];
}

export interface DevUserGroup {
  /** Group identity for `{#each}` keying — null = the "No organization"
   *  group. Two orgs can share a display name, so the key must be the org id,
   *  never the name (a duplicate-name key crashes Svelte's keyed each). */
  orgId: string | null;
  /** null = the "No organization" group, rendered last. */
  orgName: string | null;
  users: DevUserEntry[];
}

/** Plain `includes` filter over name/email/username, per spec §2.3. */
export function filterDevUsers(users: DevUserEntry[], query: string): DevUserEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return users;
  return users.filter((u) =>
    [u.displayName, u.email, u.username].some((field) => field?.toLowerCase().includes(q)),
  );
}

/**
 * Groups by each user's primary (first) org — `/api/dev/users` already sorts
 * users by that org's name, so within-group order is preserved. The
 * no-organization group always sorts last. Grouped (and keyed) by org id,
 * not name: two orgs can legitimately share a display name.
 */
export function groupDevUsersByOrg(users: DevUserEntry[]): DevUserGroup[] {
  const groups = new Map<string | null, { orgName: string | null; users: DevUserEntry[] }>();
  for (const user of users) {
    const org = user.orgs[0];
    const key = org?.orgId ?? null;
    const existing = groups.get(key);
    if (existing) existing.users.push(user);
    else groups.set(key, { orgName: org?.orgName ?? null, users: [user] });
  }
  const named = [...groups.entries()]
    .filter(
      (entry): entry is [string, { orgName: string | null; users: DevUserEntry[] }] =>
        entry[0] !== null,
    )
    .sort(([, a], [, b]) => (a.orgName ?? '').localeCompare(b.orgName ?? ''))
    .map(([orgId, { orgName, users: groupUsers }]) => ({ orgId, orgName, users: groupUsers }));
  const noOrg = groups.get(null);
  return noOrg ? [...named, { orgId: null, orgName: noOrg.orgName, users: noOrg.users }] : named;
}

export function displayNameOf(user: DevUserEntry): string {
  return user.displayName ?? user.email ?? user.id;
}
