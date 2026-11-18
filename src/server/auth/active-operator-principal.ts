import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
// Type-only: the runtime dependency direction is rbac.service -> this helper.
import type { CapabilityOverrideRow } from '$server/services/rbac.service';

/** Closed return of public.minion_operator_authority_v1 (contracts/authority-bridge.md). */
export interface OperatorAuthorityRows {
  version: 1;
  orgId: string;
  profileId: string;
  organizationStatus: 'active';
  deletionPending: false;
  roleModel: string | null;
  defaultRoleKey: string | null;
  membershipRole: string;
  assignedRoleKeys: string[];
  localRoleKeys: string[];
  rules: CapabilityOverrideRow[];
  authorityRows: { table: string; key: string[]; rowHash: string }[];
}

export type OperatorAuthorityFailure =
  | 'operator_scope_invalid'
  | 'operator_principal_inactive'
  | 'operator_authority_limit'
  | 'operator_authority_inconsistent'
  | 'operator_authority_unavailable';

/** Typed, credential-free failure. Never an empty-capability fallback. */
export class OperatorAuthorityError extends Error {
  constructor(readonly code: OperatorAuthorityFailure) {
    super(code);
    this.name = 'OperatorAuthorityError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TABLES = new Set([
  'organizations',
  'profiles',
  'organization_members',
  'member_roles',
  'org_roles',
  'permission_rules',
]);
const KNOWN: ReadonlySet<string> = new Set([
  'operator_scope_invalid',
  'operator_principal_inactive',
  'operator_authority_limit',
  'operator_authority_inconsistent',
]);

function isStringArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((v) => typeof v === 'string');
}

/** Exported for tests: strict closed-schema validation of the bridge JSON. */
export function validateOperatorAuthorityRows(
  value: unknown,
  orgId: string,
  profileId: string,
): OperatorAuthorityRows {
  const bad = () => new OperatorAuthorityError('operator_authority_unavailable');
  if (!value || typeof value !== 'object') throw bad();
  const v = value as Record<string, unknown>;
  const keys = [
    'version',
    'orgId',
    'profileId',
    'organizationStatus',
    'deletionPending',
    'roleModel',
    'defaultRoleKey',
    'membershipRole',
    'assignedRoleKeys',
    'localRoleKeys',
    'rules',
    'authorityRows',
  ];
  if (Object.keys(v).length !== keys.length || keys.some((k) => !(k in v))) throw bad();
  if (
    v.version !== 1 ||
    v.orgId !== orgId ||
    v.profileId !== profileId ||
    v.organizationStatus !== 'active' ||
    v.deletionPending !== false ||
    typeof v.membershipRole !== 'string' ||
    !(v.roleModel === null || typeof v.roleModel === 'string') ||
    !(v.defaultRoleKey === null || typeof v.defaultRoleKey === 'string') ||
    !isStringArray(v.assignedRoleKeys, 128) ||
    !isStringArray(v.localRoleKeys, 128) ||
    !Array.isArray(v.rules) ||
    v.rules.length > 10_000 ||
    !Array.isArray(v.authorityRows)
  ) {
    throw bad();
  }
  for (const rule of v.rules as Record<string, unknown>[]) {
    if (typeof rule?.role_key !== 'string' || typeof rule.module !== 'string') throw bad();
  }
  for (const row of v.authorityRows as Record<string, unknown>[]) {
    if (
      typeof row?.table !== 'string' ||
      !TABLES.has(row.table) ||
      !isStringArray(row.key, 3) ||
      typeof row.rowHash !== 'string' ||
      !SHA256.test(row.rowHash)
    ) {
      throw bad();
    }
  }
  return v as unknown as OperatorAuthorityRows;
}

async function callBridge(
  tx: CoreTx,
  orgId: string,
  profileId: string,
  lockRows: boolean,
): Promise<OperatorAuthorityRows> {
  if (!UUID.test(orgId) || !UUID.test(profileId))
    throw new OperatorAuthorityError('operator_scope_invalid');
  const [state] = await tx.execute<{ role: string; org: string | null; profile: string | null }>(
    sql`select current_setting('role') as role,
               current_setting('app.current_org_id', true) as org,
               current_setting('app.current_profile_id', true) as profile`,
  );
  if (
    state?.role !== 'app_ledger' ||
    state.org?.toLowerCase() !== orgId ||
    state.profile?.toLowerCase() !== profileId
  ) {
    throw new OperatorAuthorityError('operator_scope_invalid');
  }
  try {
    const [row] = await tx.execute<{ authority: unknown }>(
      sql`select public.minion_operator_authority_v1(${orgId}::uuid, ${profileId}::uuid, ${lockRows}::boolean) as authority`,
    );
    return validateOperatorAuthorityRows(row?.authority, orgId, profileId);
  } catch (error) {
    if (error instanceof OperatorAuthorityError) throw error;
    // drizzle wraps driver errors; the SQL exception text lives on the cause chain.
    let message = '';
    for (let e: unknown = error, i = 0; e instanceof Error && i < 4; e = e.cause, i += 1) {
      message += ` ${e.message}`;
    }
    const code = [...KNOWN].find((k) => message.includes(k));
    throw new OperatorAuthorityError(
      (code as OperatorAuthorityFailure) ?? 'operator_authority_unavailable',
    );
  }
}

/** Plain snapshot mode: no locks, requires READ ONLY REPEATABLE READ (enforced in SQL). */
export function readOperatorAuthorityReadOnlyInTx(tx: CoreTx, orgId: string, profileId: string) {
  return callBridge(tx, orgId, profileId, false);
}

/** Write-admission mode: stock-v1 + org authority advisory locks, then FOR SHARE rows. Reads/locks only. */
export function readOperatorAuthorityForWriteInTx(tx: CoreTx, orgId: string, profileId: string) {
  return callBridge(tx, orgId, profileId, true);
}

export interface ActiveOperatorPrincipalState {
  orgId: string;
  profileId: string;
  membershipRole: string;
  roleModel: string | null;
  defaultRoleKey: string | null;
  /** SHA-256 of canonical JSON of exactly the selected fields above plus authorityRows. */
  principalStateHash: string;
}

export async function assertActiveOperatorPrincipalReadOnlyInTx(
  tx: CoreTx,
  orgId: string,
  profileId: string,
): Promise<ActiveOperatorPrincipalState> {
  const rows = await readOperatorAuthorityReadOnlyInTx(tx, orgId, profileId);
  const selected = {
    orgId,
    profileId,
    membershipRole: rows.membershipRole,
    roleModel: rows.roleModel,
    defaultRoleKey: rows.defaultRoleKey,
    authorityRows: rows.authorityRows,
  };
  return {
    orgId,
    profileId,
    membershipRole: rows.membershipRole,
    roleModel: rows.roleModel,
    defaultRoleKey: rows.defaultRoleKey,
    principalStateHash: createHash('sha256').update(JSON.stringify(selected)).digest('hex'),
  };
}
