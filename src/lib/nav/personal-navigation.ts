/** Personal layout is presentation only. Reconcile it against the current RBAC catalog on every read. */
export interface PersonalNavigation {
  version: 1;
  organizationId: string;
  hidden: string[];
  order: string[];
}
export function isPersonalNavigation(value: unknown): value is PersonalNavigation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { version, organizationId, hidden, order, ...rest } = value as Record<string, unknown>;
  const keys = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.length <= 100 &&
    v.every((s) => typeof s === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(s)) &&
    new Set(v).size === v.length;
  return (
    version === 1 &&
    typeof organizationId === 'string' &&
    organizationId.length > 0 &&
    organizationId.length <= 100 &&
    keys(hidden) &&
    keys(order) &&
    !Object.keys(rest).length
  );
}
export function personalNavigation(value: unknown, organizationId: string): PersonalNavigation {
  return isPersonalNavigation(value) && value.organizationId === organizationId
    ? value
    : { version: 1, organizationId, hidden: [], order: [] };
}
export function orderPersonalSections<T extends { id: string }>(
  catalog: T[],
  preference: PersonalNavigation,
): T[] {
  const ranks = new Map(preference.order.map((id, index) => [id, index]));
  return [...catalog].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
}
export function canUseFullNavigation(
  roles: readonly string[] | undefined,
  platformRole?: string,
): boolean {
  return (
    platformRole === 'admin' ||
    Boolean(roles?.some((role) => ['owner', 'admin', 'manager'].includes(role)))
  );
}
export const emptySectionHref = (id: string) => `/account/home?section=${encodeURIComponent(id)}`;
