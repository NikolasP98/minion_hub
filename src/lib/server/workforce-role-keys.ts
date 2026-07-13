const MAX_ROLE_KEYS = 64;
const MAX_ROLE_KEY_LENGTH = 128;

/** Canonical, bounded role claims prevent oversized JWTs and cache fragmentation. */
export function canonicalizeWorkforceRoleKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((entry) => {
        if (typeof entry !== 'string') return [];
        const roleKey = entry.trim();
        return roleKey.length > 0 && roleKey.length <= MAX_ROLE_KEY_LENGTH ? [roleKey] : [];
      }),
    ),
  ]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_ROLE_KEYS);
}

/** A role change must miss the identity-token cache immediately. */
export function workforceIdentityCacheKey(input: {
  userId: string;
  companyId: string | null;
  roleKeys: unknown;
}): string {
  return JSON.stringify([
    input.userId,
    input.companyId ?? '',
    canonicalizeWorkforceRoleKeys(input.roleKeys),
  ]);
}
