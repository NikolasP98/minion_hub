import { and, eq, inArray } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import { posTickets } from '$server/db/pg-pos-schema';
import { PosError } from './errors';
import { requirePosCurrency } from './money';
import { lockGrantSources } from './lock-key';

/** Grants inherit money denomination from their immutable source ticket.
 * Use the same transaction and organization fence as the grant operation;
 * current settings cannot relabel a historical grant. Lists use one batch read.
 */
export async function requireGrantSourceCurrencies(
  tx: CoreTx,
  orgId: string,
  sourceTicketIds: readonly string[],
  options: { lock?: boolean } = {},
): Promise<Map<string, string>> {
  if (!sourceTicketIds.length) return new Map();
  if (sourceTicketIds.length > 10_000)
    throw new PosError('Too many grant sources to validate.', 'invalid_stored_amount');
  const ids = [...new Set(sourceTicketIds)];
  if (options.lock) await lockGrantSources(tx, orgId, ids);
  const sources = await tx
    .select({ id: posTickets.id, currency: posTickets.currency })
    .from(posTickets)
    .where(and(eq(posTickets.orgId, orgId), inArray(posTickets.id, ids)));
  const found = new Set(sources.map((source) => source.id));
  if (ids.some((id) => !found.has(id)))
    throw new PosError('Package monetary provenance is unavailable.', 'invalid_stored_amount');
  return new Map(sources.map((source) => [source.id, requirePosCurrency(source.currency)]));
}
