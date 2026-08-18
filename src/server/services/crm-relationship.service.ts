import { and, eq, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmContacts } from '$server/db/pg-crm-schema';
import { relationshipSchema, type Relationship, type RelationshipCategory } from '$lib/components/crm/crm-relationship';
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
 * Manual override — 'user' IS the pin (spec R2, no separate flag). `label:
 * null` means the user explicitly cleared it; AI must never refill while
 * source stays 'user'. User edits never fabricate a confidence value.
 *
 * `ownerId` (record-level, if-owner scope — spec F2): folded into the same
 * atomic UPDATE's WHERE, not a prior read. An owner-scoped caller writing to
 * a contact they don't own gets `applied:false` — the route 404s rather than
 * leaking existence.
 */
export async function setUserRelationship(
  ctx: CoreCtx,
  contactId: string,
  data: { label: string | null; category: RelationshipCategory },
  ownerId?: string,
): Promise<{ applied: boolean }> {
  const value = relationshipSchema.parse({
    label: data.label,
    category: data.category,
    source: 'user',
    updatedAt: new Date().toISOString(),
  });
  const guard = ownerId ? sql`${crmContacts.ownerId} = ${ownerId}` : undefined;
  const applied = await atomicSetRelationship(ctx, contactId, value, guard);
  if (applied) await bustCrmList(ctx.tenantId);
  return { applied };
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

/**
 * Clears a user pin (deletes the `_relationship` key entirely) so a future
 * AI inference run may populate it again. `ownerId` (record-level scope,
 * spec F2) folded into the WHERE — 0 rows matched (not found OR not owned)
 * → `applied:false`, and the route 404s (no existence leak).
 */
export async function resumeAiSuggestions(
  ctx: CoreCtx,
  contactId: string,
  ownerId?: string,
): Promise<{ applied: boolean }> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .update(crmContacts)
      .set({
        customFields: sql`coalesce(${crmContacts.customFields}, '{}'::jsonb) - '_relationship'`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(crmContacts.id, contactId),
          eq(crmContacts.orgId, ctx.tenantId),
          ...(ownerId ? [eq(crmContacts.ownerId, ownerId)] : []),
        ),
      )
      .returning({ id: crmContacts.id }),
  );
  const applied = rows.length > 0;
  if (applied) await bustCrmList(ctx.tenantId);
  return { applied };
}
