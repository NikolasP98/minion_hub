import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { crmContacts } from '$server/db/pg-crm-schema';
import { parties } from '$server/db/pg-party-schema';
import { PosError } from './errors';
import { lockPosIdentityShared, lockPosWalletExclusive } from './lock-key';
import { requirePosCurrency } from './money';

export interface WalletClientRef {
  partyId?: string | null;
  crmContactId?: string | null;
}

export interface CanonicalWalletIdentity {
  partyId: string | null;
  crmContactId: string | null;
  clientKey: string;
  identityStatus: 'active';
}

export interface PersistedWalletLockOwner {
  clientKey: string;
}

export interface WalletOwnedColumns {
  partyId: PgColumn;
  crmContactId: PgColumn;
}

function requireFacet(ref: WalletClientRef): void {
  if (!ref.partyId && !ref.crmContactId)
    throw new PosError('partyId or crmContactId is required', 'client_required');
}

const walletClientKeySchema = z
  .string()
  .regex(/^(party|contact):/)
  .transform((value, context) => {
    const separator = value.indexOf(':');
    const kind = value.slice(0, separator) as 'party' | 'contact';
    const id = z
      .string()
      .uuid()
      .safeParse(value.slice(separator + 1));
    if (!id.success) {
      context.addIssue({ code: 'custom', message: 'invalid wallet client key' });
      return z.NEVER;
    }
    return `${kind}:${id.data.toLowerCase()}`;
  });

export function canonicalWalletClientKey(value: unknown): string {
  const parsed = walletClientKeySchema.safeParse(value);
  if (!parsed.success)
    throw new PosError('Canonical wallet identity is required.', 'wallet_identity_required');
  return parsed.data;
}

/** Resolve a mutation identity under the transaction's shared identity-map lock. */
export async function resolveWalletIdentity(
  tx: CoreTx,
  orgId: string,
  supplied: WalletClientRef,
  options: { lock?: boolean } = {},
): Promise<CanonicalWalletIdentity> {
  requireFacet(supplied);
  if (options.lock !== false) await lockPosIdentityShared(tx, orgId);

  const suppliedPartyId = supplied.partyId?.toLowerCase() ?? null;
  const suppliedContactId = supplied.crmContactId?.toLowerCase() ?? null;

  const [party, contact] = await Promise.all([
    suppliedPartyId
      ? tx
          .select({ id: parties.id })
          .from(parties)
          .where(and(eq(parties.orgId, orgId), eq(parties.id, suppliedPartyId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    suppliedContactId
      ? tx
          .select({ id: crmContacts.id, partyId: crmContacts.partyId })
          .from(crmContacts)
          .where(
            and(
              eq(crmContacts.orgId, orgId),
              eq(crmContacts.id, suppliedContactId),
              isNull(crmContacts.deletedAt),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  if (suppliedPartyId && !party)
    throw new PosError('Wallet identity is unavailable.', 'wallet_identity_unavailable');
  if (suppliedContactId && !contact)
    throw new PosError('Wallet identity is unavailable.', 'wallet_identity_unavailable');
  if (suppliedPartyId && suppliedContactId && contact?.partyId?.toLowerCase() !== suppliedPartyId)
    throw new PosError('Wallet identity changed.', 'wallet_identity_changed');

  const canonicalPartyId = suppliedPartyId ?? contact?.partyId?.toLowerCase() ?? null;
  if (canonicalPartyId && !party) {
    const [linkedParty] = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.orgId, orgId), eq(parties.id, canonicalPartyId)))
      .limit(1);
    if (!linkedParty)
      throw new PosError('Wallet identity is unavailable.', 'wallet_identity_unavailable');
  }

  return {
    partyId: canonicalPartyId,
    crmContactId: contact?.id?.toLowerCase() ?? null,
    clientKey: canonicalPartyId ? `party:${canonicalPartyId}` : `contact:${contact!.id}`,
    identityStatus: 'active',
  };
}

/**
 * Resolve only the serialization key for an already-persisted money row.
 *
 * A stamped party remains authoritative even if its contact is later relinked
 * or either identity row disappears. Contact-only history follows the current
 * active contact bridge, matching the account aggregation predicate; a missing
 * or deleted contact falls back to its persisted contact key so a compensating
 * refund can still complete. Callers must keep the shared identity lock until
 * every derived wallet lock has been acquired.
 */
export async function resolvePersistedWalletLockOwner(
  tx: CoreTx,
  orgId: string,
  persisted: WalletClientRef,
  options: { lock?: boolean } = {},
): Promise<PersistedWalletLockOwner> {
  requireFacet(persisted);
  if (options.lock !== false) await lockPosIdentityShared(tx, orgId);

  const partyId = persisted.partyId?.toLowerCase() ?? null;
  if (partyId) return { clientKey: `party:${partyId}` };

  const contactId = persisted.crmContactId!.toLowerCase();
  const [contact] = await tx
    .select({ partyId: crmContacts.partyId, deletedAt: crmContacts.deletedAt })
    .from(crmContacts)
    .where(and(eq(crmContacts.orgId, orgId), eq(crmContacts.id, contactId)))
    .limit(1);
  const activePartyId = contact?.deletedAt ? null : (contact?.partyId?.toLowerCase() ?? null);
  return { clientKey: activePartyId ? `party:${activePartyId}` : `contact:${contactId}` };
}

/** Authenticated plan preflight: lock and return the exact facets durable admission must freeze. */
export function resolveWalletIdentityForAdmission(
  ctx: CoreCtx,
  supplied: WalletClientRef,
): Promise<CanonicalWalletIdentity> {
  return withOrgCore(ctx, (tx) => resolveWalletIdentity(tx, ctx.tenantId, supplied));
}

/**
 * Persisted party is authoritative. Contact-only history follows the current
 * active bridge and therefore belongs to the party only through that bridge.
 */
export function walletOwnedPredicate(
  orgId: string,
  identity: Pick<CanonicalWalletIdentity, 'partyId' | 'crmContactId'>,
  columns: WalletOwnedColumns,
): SQL {
  if (identity.partyId) {
    return or(
      eq(columns.partyId, identity.partyId),
      and(
        isNull(columns.partyId),
        sql`${columns.crmContactId} in (
          select ${crmContacts.id} from ${crmContacts}
          where ${crmContacts.orgId} = ${orgId}
            and ${crmContacts.partyId} = ${identity.partyId}::uuid
            and ${crmContacts.deletedAt} is null
        )`,
      ),
    ) as SQL;
  }
  return and(isNull(columns.partyId), eq(columns.crmContactId, identity.crmContactId!)) as SQL;
}

export async function lockCanonicalWallet(
  tx: CoreTx,
  orgId: string,
  identity: Pick<CanonicalWalletIdentity, 'clientKey'>,
  rawCurrency: string,
): Promise<string> {
  const currency = requirePosCurrency(rawCurrency);
  await lockPosWalletExclusive(tx, orgId, identity.clientKey, currency);
  return currency;
}
