import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { lockPosIdentityShared, lockPosSettingsShared } from '../lock-key';
import { requirePosCurrency } from '../money';
import { parseBalanceBuckets, parsePlanBuckets } from './decoders';
import type { ClientAccountSummary, WalletIdentityStatus } from './types';

/** Bounded canonical wallet list projection. */
export async function listClientAccounts(
  ctx: CoreCtx,
  opts: { limit?: number } = {},
): Promise<ClientAccountSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  return withOrgCore(ctx, async (tx) => {
    await lockPosSettingsShared(tx, ctx.tenantId);
    await lockPosIdentityShared(tx, ctx.tenantId);
    const rows = (await tx.execute(sql`
      with policy as (
        select
          coalesce((select currency from public.pos_settings where org_id = ${ctx.tenantId}), 'PEN') as pos_currency,
          coalesce((select timezone from public.fin_settings where org_id = ${ctx.tenantId}), 'America/Lima') as timezone
      ), contact_bridge as (
        select id, party_id, deleted_at
        from public.crm_contacts where org_id = ${ctx.tenantId}
      ), ledger_grouped as (
        select case
                 when l.party_id is not null then 'party:' || l.party_id::text
                 when c.party_id is not null and c.deleted_at is null then 'party:' || c.party_id::text
                 else 'contact:' || l.crm_contact_id::text
               end as client_key,
               l.currency, sum(l.amount) as balance
        from public.pos_client_ledger l
        left join contact_bridge c on c.id = l.crm_contact_id
        where l.org_id = ${ctx.tenantId}
        group by 1, l.currency
      ), ledger as (
        select client_key,
          jsonb_agg(jsonb_build_object('currency', currency, 'balance', balance)
                    order by currency collate "C") as balances
        from ledger_grouped group by client_key
      ), plans_grouped as (
        select case
                 when p.party_id is not null then 'party:' || p.party_id::text
                 when c.party_id is not null and c.deleted_at is null then 'party:' || c.party_id::text
                 else 'contact:' || p.crm_contact_id::text
               end as client_key,
               p.currency, count(*)::int as count, sum(p.total_amount) as total
        from public.pos_payment_plans p
        left join contact_bridge c on c.id = p.crm_contact_id
        where p.org_id = ${ctx.tenantId} and p.status = 'open'
        group by 1, p.currency
      ), plans as (
        select client_key,
          jsonb_agg(jsonb_build_object('currency', currency, 'count', count, 'total', total)
                    order by currency collate "C") as buckets,
          sum(count)::int as total_count
        from plans_grouped group by client_key
      ), grants as (
        select case
                 when g.party_id is not null then 'party:' || g.party_id::text
                 when c.party_id is not null and c.deleted_at is null then 'party:' || c.party_id::text
                 else 'contact:' || g.crm_contact_id::text
               end as client_key,
               count(*)::int as active_grants
        from public.pos_package_grants g
        left join contact_bridge c on c.id = g.crm_contact_id
        where g.org_id = ${ctx.tenantId}
          and g.status = 'active'
          and g.sessions_total > coalesce((
            select count(*) from public.pos_package_redemptions r
            where r.org_id = g.org_id and r.grant_id = g.id and r.reversed_at is null
          ), 0)
          and (g.expires_at is null or g.expires_at >=
            ((CURRENT_TIMESTAMP at time zone (select timezone from policy))::date))
        group by 1
      ), pending as (
        select case
                 when t.party_id is not null then 'party:' || t.party_id::text
                 when c.party_id is not null and c.deleted_at is null then 'party:' || c.party_id::text
                 else 'contact:' || t.crm_contact_id::text
               end as client_key,
               count(*)::int as pending_count,
               (array_agg(t.id::text order by t.submitted_at desc))[1] as pending_ticket_id
        from public.pos_ticket_lines tl
        join public.pos_tickets t on t.id = tl.ticket_id and t.org_id = tl.org_id
        left join contact_bridge c on c.id = t.crm_contact_id
        where tl.org_id = ${ctx.tenantId} and tl.kind = 'service'
          and tl.booking_id is null and tl.plan_id is null and t.status <> 'void'
          and (t.party_id is not null or t.crm_contact_id is not null)
        group by 1
      ), keys as (
        select client_key from ledger union select client_key from plans
        union select client_key from grants union select client_key from pending
      )
      select k.client_key, policy.pos_currency,
             case when k.client_key like 'party:%' then substring(k.client_key from 7)::uuid end as party_id,
             case when k.client_key like 'contact:%' then substring(k.client_key from 9)::uuid end as contact_id,
             coalesce(l.balances, '[]'::jsonb) as balances,
             coalesce(p.buckets, '[]'::jsonb) as plan_buckets,
             coalesce(p.total_count, 0) as total_open_plans,
             coalesce(g.active_grants, 0) as active_grants,
             coalesce(q.pending_count, 0) as pending_scheduling,
             q.pending_ticket_id,
             case
               when k.client_key like 'party:%' and pt.id is null then 'missing_party'
               when k.client_key like 'contact:%' and cc.id is null then 'missing_contact'
               when k.client_key like 'contact:%' and cc.deleted_at is not null then 'deleted_contact'
               else 'active'
             end as identity_status,
             coalesce(cc.display_name, pt.name) as display_name
      from keys k cross join policy
      left join ledger l using (client_key)
      left join plans p using (client_key)
      left join grants g using (client_key)
      left join pending q using (client_key)
      left join public.parties pt on pt.org_id = ${ctx.tenantId}
        and k.client_key = 'party:' || pt.id::text
      left join public.crm_contacts cc on cc.org_id = ${ctx.tenantId}
        and k.client_key = 'contact:' || cc.id::text
      order by coalesce(q.pending_count, 0) desc, k.client_key
      limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const posCurrency = requirePosCurrency(row.pos_currency);
      const balancesByCurrency = parseBalanceBuckets(row.balances);
      const openPlansByCurrency = parsePlanBuckets(row.plan_buckets);
      const currentBalance =
        balancesByCurrency.find((bucket) => bucket.currency === posCurrency)?.balance ?? 0;
      const currentPlans = openPlansByCurrency.find((bucket) => bucket.currency === posCurrency);
      return {
        clientKey: String(row.client_key),
        partyId: row.party_id == null ? null : String(row.party_id),
        crmContactId: row.contact_id == null ? null : String(row.contact_id),
        identityStatus: String(row.identity_status) as WalletIdentityStatus,
        balancesByCurrency,
        openPlansByCurrency,
        balance: currentBalance,
        balanceCurrency: posCurrency,
        activeGrants: Number(row.active_grants ?? 0),
        openPlans: currentPlans?.count ?? 0,
        totalOpenPlans: Number(row.total_open_plans ?? 0),
        openPlanTotal: currentPlans?.total ?? 0,
        displayName: row.display_name == null ? null : String(row.display_name),
        pendingScheduling: Number(row.pending_scheduling ?? 0),
        pendingTicketId: row.pending_ticket_id == null ? null : String(row.pending_ticket_id),
      };
    });
  });
}
