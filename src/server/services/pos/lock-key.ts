import { sql } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';

export type PosLockKind = 'settings' | 'identity' | 'wallet' | 'grant-source';

async function acquire(
  tx: CoreTx,
  mode: 'shared' | 'exclusive',
  kind: PosLockKind,
  orgId: string,
  subject = '',
  currency = '',
): Promise<void> {
  if (mode === 'shared') {
    await tx.execute(
      sql`select pg_catalog.pg_advisory_xact_lock_shared(public.pos_advisory_key_v1(${kind}, ${orgId}, ${subject}, ${currency}))`,
    );
  } else {
    await tx.execute(
      sql`select pg_catalog.pg_advisory_xact_lock(public.pos_advisory_key_v1(${kind}, ${orgId}, ${subject}, ${currency}))`,
    );
  }
}

export const lockPosSettingsShared = (tx: CoreTx, orgId: string) =>
  acquire(tx, 'shared', 'settings', orgId);
export const lockPosSettingsExclusive = (tx: CoreTx, orgId: string) =>
  acquire(tx, 'exclusive', 'settings', orgId);
export const lockPosIdentityShared = (tx: CoreTx, orgId: string) =>
  acquire(tx, 'shared', 'identity', orgId);
export const lockPosIdentityExclusive = (tx: CoreTx, orgId: string) =>
  acquire(tx, 'exclusive', 'identity', orgId);
export const lockPosWalletExclusive = (
  tx: CoreTx,
  orgId: string,
  canonicalClientKey: string,
  currency: string,
) => acquire(tx, 'exclusive', 'wallet', orgId, canonicalClientKey, currency);

export async function lockGrantSources(
  tx: CoreTx,
  orgId: string,
  sourceTicketIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(sourceTicketIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const id of ids) await acquire(tx, 'exclusive', 'grant-source', orgId, id);
}
