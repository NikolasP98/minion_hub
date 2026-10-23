import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { CoreTx } from '$server/db/with-org-core';
import { getOrgTransactionDb } from '$server/db/pg-client';
import { resolveFreshCapabilitiesInTransaction } from './rbac.service';
import {
  assertPulseConfigCurrent,
  readPulseWorkerConfig,
  pulseConfigFingerprint,
  type PulseWorkerConfig,
} from './pulse-worker-config';
import { pulseHash } from './pulse-action-contract';
import { prepareQualifiedGateway } from '$lib/server/gateway-rpc';

export type PulseAuthority = {
  orgId: string;
  profileId: string;
  gatewayId: string;
  channel: 'prd' | 'dev';
  agentId: string;
  originSessionKey: string;
  endpoint: string;
  credentialRevision: string;
  authorityHash: string;
  qualificationRevision: string;
  validUntil: number;
};
export class PulseAuthorityError extends Error {
  constructor(
    readonly reason:
      'authority_unavailable' | 'qualification_unavailable' = 'authority_unavailable',
  ) {
    super(reason);
  }
}
/** Called as the bookkeeping role, before temporarily entering app_ledger. No provisioning/fallback. */
export async function resolvePulseAuthorityTx(
  tx: CoreTx,
  ctx: Pick<CoreCtx, 'tenantId' | 'profileId'>,
  config: PulseWorkerConfig,
): Promise<PulseAuthority> {
  try {
    assertPulseConfigCurrent(config);
  } catch {
    throw new PulseAuthorityError('qualification_unavailable');
  }
  if (!ctx.profileId || ctx.tenantId !== config.tenantId || ctx.profileId !== config.ownerProfileId)
    throw new PulseAuthorityError();
  const [org] = await tx.execute<{ kind: string; status: string }>(
    sql`select kind,status from organizations where id=${ctx.tenantId}::uuid for share`,
  );
  if (!org || org.kind !== 'personal' || org.status !== 'active') throw new PulseAuthorityError();
  const fresh = await resolveFreshCapabilitiesInTransaction(tx, ctx.tenantId, ctx.profileId);
  if (
    fresh.membershipRole !== 'owner' ||
    !fresh.capabilities.can('pulse', 'edit') ||
    !fresh.capabilities.can('pulse', 'view')
  )
    throw new PulseAuthorityError();
  const [module] = await tx.execute<{ enabled: boolean }>(
    sql`select enabled from app_modules where org_id=${ctx.tenantId} and module_id='pulse' for share`,
  );
  if (module?.enabled === false) throw new PulseAuthorityError();
  const [row] = await tx.execute<{
    agent_id: string;
    gateway_id: string;
    url: string;
    token_ciphertext: string;
    token_iv: string;
    lease_expires_at: Date | string;
  }>(sql`
    select p.agent_id,g.id::text as gateway_id,g.url,g.token_ciphertext,g.token_iv,l.expires_at as lease_expires_at
    from personal_agents p join profiles profile on profile.id=p.profile_id and profile.personal_agent_id=p.agent_id
    join gateway g on g.id=p.gateway_id
    join user_gateway ug on ug.gateway_id=g.id and ug.profile_id=p.profile_id
    join gateway_lease l on l.gateway_id=g.id and l.org_id=g.org_id and l.channel=g.channel
    where p.profile_id=${ctx.profileId}::uuid and p.provisioning_status='active'
      and g.id=${config.gatewayId}::uuid and g.org_id=${ctx.tenantId}::uuid and g.channel=${config.channel}
      and l.expires_at>clock_timestamp() for share of p,profile,g,ug,l`);
  if (
    !row ||
    row.url !== config.endpoint ||
    !row.token_ciphertext ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.agent_id)
  )
    throw new PulseAuthorityError();
  try {
    assertPulseConfigCurrent(config);
  } catch {
    throw new PulseAuthorityError('qualification_unavailable');
  }
  const validUntil = Math.min(
    new Date(row.lease_expires_at).getTime(),
    Date.parse(config.expiresAt),
  );
  if (!Number.isFinite(validUntil) || validUntil <= Date.now()) throw new PulseAuthorityError();
  const credentialRevision = pulseHash([row.token_ciphertext, row.token_iv]);
  const target = {
    orgId: ctx.tenantId,
    profileId: ctx.profileId,
    gatewayId: row.gateway_id,
    channel: config.channel,
    agentId: row.agent_id,
    originSessionKey: `agent:${row.agent_id}:main`,
    endpoint: row.url,
    credentialRevision,
    qualificationRevision: pulseConfigFingerprint(config),
  };
  return {
    ...target,
    validUntil,
    authorityHash: pulseHash({ ...target, roles: [...fresh.roles].sort() }),
  };
}
export async function preparePulseAuthority(ctx: CoreCtx, signal?: AbortSignal) {
  const config = readPulseWorkerConfig();
  if (!config) throw new PulseAuthorityError('qualification_unavailable');
  const authority = await getOrgTransactionDb(ctx.db).transaction((tx) =>
    resolvePulseAuthorityTx(tx, ctx, config),
  );
  const connection = await prepareQualifiedGateway({
    ...authority,
    version: config.version,
    commit: config.commit,
    signal,
  });
  return { config, authority, connection };
}
