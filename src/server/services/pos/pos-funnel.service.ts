// src/server/services/pos/pos-funnel.service.ts
//
// Read-only SQL for /pos/funnel (spec 132). Every query runs through withOrgCore
// (RLS). A sale is one provider invoice or one non-voided PDV ticket, once.
import { sql, type SQL } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { CONVO_ACTION, type DateRange } from '$server/services/meta/meta-insights.service';
import { assignTiers, type CustomerRow } from '$lib/pos/funnel-logic';

/** `sales(party_id, amount, d)`; `d` is the org-local day. party_id may be null. */
function salesCte(orgId: string, tz: string): SQL {
  // TODO(handoff): provider filter — only 'susii' invoices count; tax-ledger (sunat-sire)
  // imports are excluded on purpose. If FACES invoices only via SUNAT, revenue undercounts.
  return sql`sales as (
    select c.party_id, i.total::float8 as amount, (i.issued_at at time zone ${tz})::date as d
    from fin_invoices i
    left join fin_clients c on c.id = i.client_id and c.org_id = i.org_id
    where i.org_id = ${orgId} and i.provider = 'susii' and i.issued_at is not null
      and not exists (
        select 1 from pos_tickets t
        where t.org_id = i.org_id and t.voided_at is null and t.invoice_provider_ref = i.provider_ref)
    union all
    select t.party_id, t.total::float8, (t.submitted_at at time zone ${tz})::date
    from pos_tickets t
    where t.org_id = ${orgId} and t.voided_at is null
  )`;
}

const identity = (channel: string) => sql`exists (
  select 1 from crm_contacts k
  join crm_contact_identities x on x.contact_id = k.id and x.org_id = k.org_id
  where k.org_id = p.org_id and k.party_id = p.id and k.deleted_at is null and x.channel = ${channel})`;

/** All-time paying customers with spend, count, last sale, reachability and tier. */
export function listTargetableCustomers(ctx: CoreCtx, tz: string): Promise<CustomerRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      with ${salesCte(ctx.tenantId, tz)}
      select p.id as party_id, p.name,
             sum(s.amount)::float8 as spend, count(*)::int as cnt, max(s.d)::text as last_at,
             coalesce(p.phone9, '') <> '' as phone, coalesce(p.email, '') <> '' as email,
             ${identity('whatsapp')} as whatsapp, ${identity('instagram')} as instagram
      from sales s
      join parties p on p.id = s.party_id and p.org_id = ${ctx.tenantId}
      group by p.id, p.name, p.phone9, p.email, p.org_id
    `)) as unknown as Array<{
      party_id: string;
      name: string | null;
      spend: number;
      cnt: number;
      last_at: string;
      phone: boolean;
      email: boolean;
      whatsapp: boolean;
      instagram: boolean;
    }>;
    return assignTiers(
      rows.map((r) => ({
        partyId: r.party_id,
        name: r.name ?? '',
        spend: Number(r.spend),
        count: Number(r.cnt),
        lastAt: r.last_at,
        phone: r.phone,
        email: r.email,
        whatsapp: r.whatsapp,
        instagram: r.instagram,
        tier: 1,
      })),
    );
  });
}

export interface FunnelData {
  spend: number;
  impressions: number;
  clicks: number;
  conversations: number;
  leads: number;
  firstTime: number;
  repeatInRange: number;
  customers: number;
  lifetimeTotal: number;
  repeatCustomers: number;
  revenue: number;
  sales: number;
  /** Newest day of ad data, any range; null when the org has none. */
  adLastDate: string | null;
}

/** Ad totals, lead count, and sales/customer counts for an INCLUSIVE range. */
export function funnelData(ctx: CoreCtx, range: DateRange, tz: string): Promise<FunnelData> {
  const { from, to } = range;
  const org = ctx.tenantId;
  return withOrgCore(ctx, async (tx) => {
    const [r] = (await tx.execute(sql`
      with ${salesCte(org, tz)},
      per as (
        select party_id, count(*) as cnt, min(d) as first_d from sales
        where party_id is not null group by party_id)
      select
        (select coalesce(sum(amount), 0)::float8 from sales where d >= ${from} and d <= ${to}) as revenue,
        (select count(*)::int from sales where d >= ${from} and d <= ${to}) as sales,
        (select count(*)::int from per) as customers,
        (select coalesce(sum(amount), 0)::float8 from sales where party_id is not null) as lifetime_total,
        (select count(*)::int from per where first_d >= ${from} and first_d <= ${to}) as first_time,
        (select count(*)::int from per where cnt >= 2) as repeat_customers,
        (select count(*)::int from per where cnt >= 2 and exists (
          select 1 from sales s where s.party_id = per.party_id and s.d >= ${from} and s.d <= ${to})) as repeat_in_range,
        (select count(*)::int from meta_lead_attribution
          where org_id = ${org} and (first_contact_at at time zone ${tz})::date >= ${from}
            and (first_contact_at at time zone ${tz})::date <= ${to}) as leads,
        (select coalesce(sum(spend), 0)::float8 from meta_ad_insights
          where org_id = ${org} and date >= ${from} and date <= ${to}) as spend,
        (select coalesce(sum(impressions), 0)::float8 from meta_ad_insights
          where org_id = ${org} and date >= ${from} and date <= ${to}) as impressions,
        (select coalesce(sum(clicks), 0)::float8 from meta_ad_insights
          where org_id = ${org} and date >= ${from} and date <= ${to}) as clicks,
        (select coalesce(sum((
            select sum((a->>'value')::numeric) from jsonb_array_elements(mai.actions) a
            where a->>'action_type' = ${CONVO_ACTION})), 0)::float8
          from meta_ad_insights mai
          where mai.org_id = ${org} and mai.date >= ${from} and mai.date <= ${to}) as conversations,
        (select max(date)::text from meta_ad_insights where org_id = ${org}) as ad_last_date
    `)) as unknown as Array<Record<string, number | string | null>>;
    const n = (k: string) => Number(r?.[k] ?? 0);
    return {
      spend: n('spend'),
      impressions: n('impressions'),
      clicks: n('clicks'),
      conversations: n('conversations'),
      leads: n('leads'),
      firstTime: n('first_time'),
      repeatInRange: n('repeat_in_range'),
      customers: n('customers'),
      lifetimeTotal: n('lifetime_total'),
      repeatCustomers: n('repeat_customers'),
      revenue: n('revenue'),
      sales: n('sales'),
      adLastDate: (r?.ad_last_date as string | null) ?? null,
    };
  });
}
