import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { credentialHealthSnapshots } from '@minion-stack/db/schema';
import { cached, keys, tags } from '@minion-stack/cache';
import { nowMs } from '$server/db/utils';
import { scopeData, type TenantContext } from './base';

export interface CredentialHealthInput {
  serverId: string;
  snapshotJson: string;
  capturedAt: number;
}

export async function insertCredentialHealthSnapshot(
  ctx: TenantContext,
  input: CredentialHealthInput,
) {
  const now = nowMs();
  await ctx.db.insert(credentialHealthSnapshots).values({
    tenantId: ctx.tenantId,
    serverId: input.serverId,
    snapshotJson: input.snapshotJson,
    capturedAt: input.capturedAt,
    createdAt: now,
  });
}

export async function listCredentialHealthSnapshots(
  ctx: TenantContext,
  filters: {
    serverId?: string;
    from?: number;
    to?: number;
    limit?: number;
  } = {},
) {
  return cached(
    keys.hub('credential-health', {
      t: ctx.tenantId,
      d: scopeData({ s: filters.serverId, f: filters.from, to: filters.to, l: filters.limit }),
    }),
    {
      ttl: '30s',
      tags: tags.tenantDomain(ctx.tenantId, 'reliability'),
    },
    async () => {
      const conditions = [eq(credentialHealthSnapshots.tenantId, ctx.tenantId)];

      if (filters.serverId)
        conditions.push(eq(credentialHealthSnapshots.serverId, filters.serverId));
      if (filters.from) conditions.push(gte(credentialHealthSnapshots.capturedAt, filters.from));
      if (filters.to) conditions.push(lte(credentialHealthSnapshots.capturedAt, filters.to));

      return ctx.db
        .select()
        .from(credentialHealthSnapshots)
        .where(and(...conditions))
        .orderBy(desc(credentialHealthSnapshots.capturedAt))
        .limit(filters.limit ?? 100);
    },
  );
}
