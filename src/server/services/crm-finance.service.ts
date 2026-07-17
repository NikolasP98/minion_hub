import { sql } from 'drizzle-orm';
import { cached, keys, tags } from '@minion-stack/cache';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { bothEnabled } from './modules.service';

// A line item is a "reservation deposit" (the 50-soles "Reserva de Consulta")
// rather than an actual procedure — the signal that splits "reservó pero no
// compró" from real buyers.
const IS_RESERVA = sql.raw(`ii.description ilike '%reserva%'`);
const IS_PROCEDURE = sql.raw(`(ii.description is not null and ii.description not ilike '%reserva%')`);

/**
 * Canonical contact↔invoice bridge via the PARTY SPINE (contact.party_id =
 * fin_client.party_id), replacing the legacy WhatsApp-phone bridge. The phone
 * bridge only attributed invoices to contacts who messaged on WhatsApp, leaving
 * ~60% of finance revenue unattributed; the party spine (keyed on DNI, then
 * phone) reaches every payer once `reconcileParties` has minted a contact for
 * each. `distinct on (party_id)` collapses duplicate contacts so a party with
 * >1 contact can't double-count its invoices. Splice into a `with` running
 * inside withOrgCore (org GUC set). See party.service.ts.
 */
export const CONTACT_PARTY = sql`contact_party as (
  select distinct on (c.party_id) c.party_id, c.id as contact_id
  from crm_contacts c
  where c.org_id = current_setting('app.current_org_id', true)
    and c.party_id is not null and c.deleted_at is null
  order by c.party_id, c.created_at asc
)`;

export interface ContactFinance {
  revenue: number;
  invoices: number;
  lastPurchaseAt: string | null;
  /** has ≥1 procedure (non-reservation) line item */
  purchased: boolean;
  /** has invoices but ALL are reservation deposits — the re-contact segment */
  reservedOnly: boolean;
  /** repeat procedure buyer (≥2 distinct procedure dates) */
  loyal: boolean;
}

export async function contactFinanceMap(ctx: CoreCtx): Promise<Record<string, ContactFinance>> {
  if (!(await bothEnabled(ctx, 'crm', 'finances'))) return {};
  return cached(
    keys.hub('crm-fin-map', { t: ctx.tenantId }),
    // crm×finances intersection: either domain's invalidation busts it.
    {
      ttl: '2m',
      swr: '30s',
      tags: [...tags.tenantDomain(ctx.tenantId, 'crm'), ...tags.tenantDomain(ctx.tenantId, 'finances')],
    },
    () => loadContactFinanceMap(ctx),
  );
}

async function loadContactFinanceMap(ctx: CoreCtx): Promise<Record<string, ContactFinance>> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      with ${CONTACT_PARTY},
      inv as (
        select cp.contact_id, fi.id invoice_id, coalesce(fi.total,0)::float8 total, fi.issued_at,
               bool_or(${IS_RESERVA}) has_reserva, bool_or(${IS_PROCEDURE}) has_proc
        from contact_party cp
        join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = cp.party_id
        join fin_invoices fi on fi.client_id = fc.id
        left join fin_invoice_items ii on ii.invoice_id = fi.id
        group by cp.contact_id, fi.id, fi.total, fi.issued_at
      )
      select contact_id,
             coalesce(sum(total),0)::float8 revenue, count(*)::int invoices, max(issued_at) last,
             bool_or(has_proc) purchased, bool_or(has_reserva) has_reserva,
             count(distinct case when has_proc then issued_at::date end)::int proc_dates
      from inv group by contact_id
    `)) as unknown as Array<{ contact_id: string; revenue: number; invoices: number; last: string | null; purchased: boolean; has_reserva: boolean; proc_dates: number }>;
    const out: Record<string, ContactFinance> = {};
    for (const r of rows) {
      const purchased = Boolean(r.purchased);
      out[String(r.contact_id)] = {
        revenue: Number(r.revenue),
        invoices: Number(r.invoices),
        lastPurchaseAt: r.last != null ? String(r.last) : null,
        purchased,
        reservedOnly: !purchased && Boolean(r.has_reserva),
        loyal: Number(r.proc_dates) >= 2,
      };
    }
    return out;
  });
}

/**
 * Org-wide revenue rollup for CRM-linked contacts — the addressable revenue
 * sitting inside the CRM (invoices joined to a contact through the WhatsApp
 * phone bridge). Powers the dashboard's Revenue summary widget. Returns null
 * when either module is disabled so the widget stays hidden.
 */
export async function crmRevenueSummary(
  ctx: CoreCtx,
): Promise<{ revenue: number; invoices: number; buyers: number; avgTicket: number; customers: number; reserved: number; loyal: number } | null> {
  if (!(await bothEnabled(ctx, 'crm', 'finances'))) return null;
  // Pure aggregation over the (cached) per-contact map — it used to re-run the
  // exact same CONTACT_PARTY/inv CTE as contactFinanceMap in a second query.
  const map = await contactFinanceMap(ctx);
  let revenue = 0;
  let invoices = 0;
  let buyers = 0;
  let customers = 0;
  let reserved = 0;
  let loyal = 0;
  for (const f of Object.values(map)) {
    revenue += f.revenue;
    invoices += f.invoices;
    buyers += 1;
    if (f.purchased) customers += 1;
    if (f.reservedOnly) reserved += 1;
    if (f.loyal) loyal += 1;
  }
  return {
    revenue,
    invoices,
    buyers,
    avgTicket: invoices ? revenue / invoices : 0,
    customers,
    reserved,
    loyal,
  };
}

export async function contactFinanceSummary(ctx: CoreCtx, contactId: string) {
  if (!(await bothEnabled(ctx, 'crm', 'finances'))) return null;
  return withOrgCore(ctx, async (tx) => {
    const invoices = (await tx.execute(sql`
      with cparty as (
        select party_id from crm_contacts
        where id = ${contactId} and org_id = current_setting('app.current_org_id', true) and party_id is not null
      )
      select fi.id, fi.document_id, fi.issued_at, coalesce(fi.total,0)::float8 total, fi.status,
             -- the "what was done": a representative line, procedures first (reserva last), priciest first.
             (select ii.description from fin_invoice_items ii where ii.invoice_id = fi.id and ii.description is not null
                order by (ii.description ilike '%reserva%') asc, ii.total desc nulls last limit 1) as item
      from fin_invoices fi
      join fin_clients fc on fc.id = fi.client_id
      where fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = (select party_id from cparty)
      order by fi.issued_at desc nulls last limit 10
    `)) as unknown as Array<Record<string, unknown>>;
    if (invoices.length === 0) return null;
    const all = invoices.map((r) => ({ id: String(r.id), documentId: r.document_id != null ? String(r.document_id) : null,
      issuedAt: r.issued_at != null ? String(r.issued_at) : null, total: Number(r.total), status: r.status != null ? String(r.status) : null,
      item: r.item != null ? String(r.item) : null }));
    const [agg] = (await tx.execute(sql`
      with cparty as (select party_id from crm_contacts
        where id = ${contactId} and org_id = current_setting('app.current_org_id', true) and party_id is not null),
      inv as (
        select fi.id, coalesce(fi.total,0)::float8 total, fi.issued_at,
               bool_or(${IS_RESERVA}) has_reserva, bool_or(${IS_PROCEDURE}) has_proc
        from fin_invoices fi join fin_clients fc on fc.id = fi.client_id
        left join fin_invoice_items ii on ii.invoice_id = fi.id
        where fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = (select party_id from cparty)
        group by fi.id, fi.total, fi.issued_at
      )
      select coalesce(sum(total),0)::float8 revenue, count(*)::int invoices, max(issued_at) last,
             bool_or(has_proc) purchased, bool_or(has_reserva) has_reserva,
             count(distinct case when has_proc then issued_at::date end)::int proc_dates
      from inv
    `)) as unknown as Array<{ revenue: number; invoices: number; last: string | null; purchased: boolean; has_reserva: boolean; proc_dates: number }>;
    const purchased = Boolean(agg?.purchased);
    return {
      revenue: Number(agg?.revenue ?? 0),
      invoices: Number(agg?.invoices ?? 0),
      lastPurchaseAt: agg?.last != null ? String(agg.last) : null,
      purchased,
      reservedOnly: !purchased && Boolean(agg?.has_reserva),
      loyal: Number(agg?.proc_dates ?? 0) >= 2,
      recentInvoices: all,
    };
  });
}

export interface TopCustomer {
  contactId: string;
  name: string | null;
  revenue: number;
  invoices: number;
  /** Best-selling procedure for this customer (excludes reservation deposits). */
  topProduct: string | null;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
}

/** What to rank customers by. `revenue` = biggest spenders; `recency` = who
 *  bought most recently (by last invoice date). */
export type CustomerRankBy = 'revenue' | 'recency';

/**
 * Customers ranked by attributed revenue OR purchase recency (party-spine
 * bridge, same CTE as the rollups). Powers the assistant's analytical answers
 * ("who has the highest ticket?" → revenue; "most recent buyers?" → recency).
 * Each row carries the figures + top procedure + activity window so the agent
 * can phrase a full answer with evidence links. Returns [] when either module
 * is off. NOTE recency ranks ALL buyers, not just top-revenue ones.
 */
export async function rankCustomers(
  ctx: CoreCtx,
  by: CustomerRankBy = 'revenue',
  limit = 5,
): Promise<TopCustomer[]> {
  if (!(await bothEnabled(ctx, 'crm', 'finances'))) return [];
  const lim = Math.min(20, Math.max(1, Math.floor(limit)));
  // `by` is a controlled enum (never raw user input), so these column choices
  // are safe to inline.
  const aggOrder = by === 'recency' ? sql`last_at` : sql`revenue`;
  const finalOrder = by === 'recency' ? sql`a.last_at` : sql`a.revenue`;
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      with ${CONTACT_PARTY},
      pinv as (
        select cp.contact_id, cp.party_id, coalesce(fi.total,0)::float8 total, fi.issued_at
        from contact_party cp
        join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = cp.party_id
        join fin_invoices fi on fi.client_id = fc.id
      ),
      agg as (
        select contact_id, party_id, sum(total)::float8 revenue, count(*)::int invoices,
               min(issued_at) first_at, max(issued_at) last_at
        from pinv group by contact_id, party_id
        order by ${aggOrder} desc nulls last
        limit ${sql.raw(String(lim))}
      )
      select a.contact_id, c.display_name as name, a.revenue, a.invoices, a.first_at, a.last_at,
             (select ii.description
                from fin_invoice_items ii
                join fin_invoices fi on fi.id = ii.invoice_id
                join fin_clients fc on fc.id = fi.client_id and fc.party_id = a.party_id
                where fc.org_id = current_setting('app.current_org_id', true)
                  and ii.description is not null and ii.description not ilike '%reserva%'
                group by ii.description order by sum(coalesce(ii.total,0)) desc nulls last limit 1) as top_product
      from agg a
      left join crm_contacts c on c.id = a.contact_id
      order by ${finalOrder} desc nulls last
    `)) as unknown as Array<{
      contact_id: string;
      name: string | null;
      revenue: number;
      invoices: number;
      first_at: string | null;
      last_at: string | null;
      top_product: string | null;
    }>;
    return rows.map((r) => ({
      contactId: String(r.contact_id),
      name: r.name != null ? String(r.name) : null,
      revenue: Number(r.revenue),
      invoices: Number(r.invoices),
      topProduct: r.top_product != null ? String(r.top_product) : null,
      firstPurchaseAt: r.first_at != null ? String(r.first_at) : null,
      lastPurchaseAt: r.last_at != null ? String(r.last_at) : null,
    }));
  });
}
