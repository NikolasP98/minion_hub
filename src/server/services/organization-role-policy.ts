import { createHash } from 'node:crypto';
import { getPgClient } from '$server/db/pg-pool';

export { MAX_ORGANIZATION_ROLES } from '$lib/rbac/role-limits';

export type OrganizationRoleModel = 'legacy' | 'organization';
export interface OrganizationRolePolicy {
  roleModel: OrganizationRoleModel;
  defaultRoleKey: string | null;
}

/** Missing columns mean the pre-migration legacy schema; unknown values never grant authority. */
export function parseOrganizationRolePolicy(
  row:
    | {
        role_model?: unknown;
        default_role_key?: unknown;
      }
    | null
    | undefined,
): OrganizationRolePolicy {
  if (!row) throw new Error('Organization role policy unavailable');
  const model = row.role_model ?? 'legacy';
  if (model !== 'legacy' && model !== 'organization')
    throw new Error('Unknown organization role model');
  const defaultRoleKey = typeof row.default_role_key === 'string' ? row.default_role_key : null;
  if (model === 'organization' && !defaultRoleKey)
    throw new Error('Organization default role unavailable');
  return { roleModel: model, defaultRoleKey };
}

export async function loadOrganizationRolePolicy(orgId: string): Promise<OrganizationRolePolicy> {
  const [row] = await getPgClient()<
    Array<{ role_model: string | null; default_role_key: string | null }>
  >`
    select to_jsonb(o)->>'role_model' as role_model,
           to_jsonb(o)->>'default_role_key' as default_role_key
    from public.organizations o where id=${orgId}::uuid and status='active'
  `;
  return parseOrganizationRolePolicy(row);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function rolePolicyRevision(
  policy: OrganizationRolePolicy,
  roles: readonly Record<string, unknown>[],
  rules: readonly Record<string, unknown>[],
): string {
  const sorted = (rows: readonly Record<string, unknown>[]) =>
    [...rows].map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256')
    .update(JSON.stringify(canonical({ policy, roles: sorted(roles), rules: sorted(rules) })))
    .digest('hex');
}
