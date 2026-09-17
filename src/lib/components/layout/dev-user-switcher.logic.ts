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
 * no-organization group always sorts last.
 */
export function groupDevUsersByOrg(users: DevUserEntry[]): DevUserGroup[] {
  const groups = new Map<string | null, DevUserEntry[]>();
  for (const user of users) {
    const key = user.orgs[0]?.orgName ?? null;
    const list = groups.get(key);
    if (list) list.push(user);
    else groups.set(key, [user]);
  }
  const named = [...groups.entries()]
    .filter((entry): entry is [string, DevUserEntry[]] => entry[0] !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([orgName, groupUsers]) => ({ orgName, users: groupUsers }));
  const noOrg = groups.get(null);
  return noOrg ? [...named, { orgName: null, users: noOrg }] : named;
}

export function displayNameOf(user: DevUserEntry): string {
  return user.displayName ?? user.email ?? user.id;
}
