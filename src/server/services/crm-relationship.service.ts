import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmContacts } from '$server/db/pg-crm-schema';
import { relationshipSchema, type Relationship } from '$lib/components/crm/crm-relationship';
import { bustCrmList, setContactCustomField } from './crm-contacts.service';

/**
 * `_relationship` lifecycle writes (spec v2 WP0). Every write is an ATOMIC
 * `jsonb_set`/`-` op via the shared `setContactCustomField` primitive, never
 * a read-modify-whole-object merge — the `_funnel` precedent
 * (crm-contacts.service.ts `setFunnelStage`) used to read the row then write
 * back the merged object, a lost-update race under concurrent writers;
 * `_relationship` must not repeat that (and `setFunnelStage` no longer does
 * either — see `setContactCustomField`).
 */

/** `guard` (if given) becomes an extra WHERE clause so a conditional write
 *  ("only if not user-pinned") is still ONE statement — no separate read. */
async function atomicSetRelationship(
  ctx: CoreCtx,
  contactId: string,
  value: Relationship,
  guard?: ReturnType<typeof sql>,
): Promise<boolean> {
  return withOrgCore(ctx, (tx) =>
    setContactCustomField(tx, ctx.tenantId, contactId, '_relationship', value, guard),
  );
}

/**
 * AI write — refused (applied:false, no-op) when the current value is
 * user-pinned, OR when `claimToken` no longer matches the row's
 * `_relationshipClaim` (the caller's lease expired/was superseded by a newer
 * claimant while the LLM call was in flight). Both checks live in the SAME
 * WHERE clause as one atomic statement — never a separate read + write.
 */
export async function setAiRelationship(
  ctx: CoreCtx,
  contactId: string,
  data: Omit<Relationship, 'source' | 'updatedAt'>,
  claimToken: string,
): Promise<{ applied: boolean }> {
  const value = relationshipSchema.parse({
    ...data,
    source: 'ai',
    updatedAt: new Date().toISOString(),
  });
  const guard = sql`coalesce(${crmContacts.customFields}->'_relationship'->>'source', '') <> 'user'
    and coalesce(${crmContacts.customFields}->'_relationshipClaim'->>'token', '') = ${claimToken}`;
  const applied = await atomicSetRelationship(ctx, contactId, value, guard);
  if (applied) await bustCrmList(ctx.tenantId);
  return { applied };
}
