import { sql } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import { resolveFreshCapabilitiesInTransaction } from './rbac.service';
import { assertDigestPolicyCurrent, type DigestPolicy } from './pulse-digest.policy';
/** Same fresh personal-owner/module/grant boundary as dispatch, without a gateway side effect. */
export async function assertDigestOwnerTx(
  tx: CoreTx,
  scope: { tenantId: string; profileId: string },
  action: 'view' | 'edit' | 'export' = 'edit',
): Promise<void> {
  const [org] = await tx.execute<{ kind: string; status: string }>(
    sql`select kind,status from organizations where id=${scope.tenantId}::uuid for share`,
  );
  if (!org || org.kind !== 'personal' || org.status !== 'active')
    throw new Error('digest_owner_unavailable');
  const fresh = await resolveFreshCapabilitiesInTransaction(tx, scope.tenantId, scope.profileId);
  if (
    fresh.membershipRole !== 'owner' ||
    !fresh.capabilities.can('pulse', 'view') ||
    !fresh.capabilities.can('pulse', action)
  )
    throw new Error('digest_owner_unavailable');
  const [module] = await tx.execute<{ enabled: boolean }>(
    sql`select enabled from app_modules where org_id=${scope.tenantId} and module_id='pulse' for share`,
  );
  if (module?.enabled === false) throw new Error('digest_owner_unavailable');
}
export async function assertDigestAuthorityTx(tx: CoreTx, policy: DigestPolicy): Promise<void> {
  assertDigestPolicyCurrent(policy);
  await assertDigestOwnerTx(tx, { tenantId: policy.tenantId, profileId: policy.ownerProfileId });
  assertDigestPolicyCurrent(policy);
}
