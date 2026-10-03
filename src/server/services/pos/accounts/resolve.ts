import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { lockPosIdentityShared, lockPosSettingsShared } from '../lock-key';
import { requirePosCurrency } from '../money';
import { nullableString } from './decoders';
import { parseClientKey } from './identity-key';
import type { ClientAccountSummary } from './types';

/** Resolve a deep-linked identity even when the bounded list has no movement row. */
export async function resolveClientAccount(
  ctx: CoreCtx,
  clientKey: string,
): Promise<ClientAccountSummary | null> {
  const client = parseClientKey(clientKey);
  return withOrgCore(ctx, async (tx) => {
    await lockPosSettingsShared(tx, ctx.tenantId);
    await lockPosIdentityShared(tx, ctx.tenantId);
    const rows = (await tx.execute(sql`
      with input as (
        select ${client.partyId ?? null}::uuid as requested_party_id,
               ${client.crmContactId ?? null}::uuid as requested_contact_id
      ), resolved as (
        select i.*,
          p.id as party_found, p.name as party_name,
          c.id as contact_found, c.party_id as contact_party_id,
          c.display_name as contact_name, c.deleted_at as contact_deleted_at,
          linked.id as linked_party_found, linked.name as linked_party_name
        from input i
        left join public.parties p on p.org_id = ${ctx.tenantId}
          and p.id = i.requested_party_id
        left join public.crm_contacts c on c.org_id = ${ctx.tenantId}
          and c.id = i.requested_contact_id
        left join public.parties linked on linked.org_id = ${ctx.tenantId}
          and linked.id = c.party_id
      )
      select
        case
          when requested_party_id is not null and party_found is not null then 'party'
          when contact_found is not null and contact_deleted_at is null
            and contact_party_id is not null and linked_party_found is not null then 'party'
          when contact_found is not null and contact_deleted_at is null
            and contact_party_id is null then 'contact'
        end as canonical_kind,
        case
          when requested_party_id is not null and party_found is not null then party_found
          when contact_found is not null and contact_deleted_at is null
            and contact_party_id is not null and linked_party_found is not null then linked_party_found
          when contact_found is not null and contact_deleted_at is null
            and contact_party_id is null then contact_found
        end as canonical_id,
        case
          when requested_party_id is not null and party_found is not null then party_found
          when contact_found is not null and contact_deleted_at is null
            and linked_party_found is not null then linked_party_found
        end as party_id,
        case when contact_found is not null and contact_deleted_at is null
          then contact_found end as contact_id,
        case
          when requested_party_id is not null and party_found is not null then party_name
          when contact_found is not null and contact_deleted_at is null then
            coalesce(contact_name, linked_party_name)
        end as display_name,
        coalesce((select currency from public.pos_settings where org_id = ${ctx.tenantId}), 'PEN')
          as pos_currency
      from resolved
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row?.canonical_kind || !row.canonical_id) return null;
    const canonicalKind = String(row.canonical_kind);
    const canonicalId = String(row.canonical_id);
    return {
      requestedClientKey: clientKey,
      clientKey: `${canonicalKind}:${canonicalId}`,
      partyId: nullableString(row.party_id),
      crmContactId: nullableString(row.contact_id),
      displayName: nullableString(row.display_name),
      identityStatus: 'active',
      balancesByCurrency: [],
      openPlansByCurrency: [],
      balance: 0,
      balanceCurrency: requirePosCurrency(row.pos_currency),
      activeGrants: 0,
      openPlans: 0,
      totalOpenPlans: 0,
      openPlanTotal: 0,
      pendingScheduling: 0,
      pendingTicketId: null,
    };
  });
}
