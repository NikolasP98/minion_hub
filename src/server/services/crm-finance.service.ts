import { sql } from 'drizzle-orm';
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
  return withOrgCore(ctx, async (tx) => {
    const [agg] = (await tx.execute(sql`
      with ${CONTACT_PARTY},
      inv as (
        select cp.contact_id, fi.id invoice_id, coalesce(fi.total,0)::float8 total, fi.issued_at,
               bool_or(${IS_RESERVA}) has_reserva, bool_or(${IS_PROCEDURE}) has_proc
        from contact_party cp
        join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = cp.party_id
        join fin_invoices fi on fi.client_id = fc.id
        left join fin_invoice_items ii on ii.invoice_id = fi.id
        group by cp.contact_id, fi.id, fi.total, fi.issued_at
      ),
      cls as (
        select contact_id, sum(total)::float8 revenue, count(*)::int invoices,
               bool_or(has_proc) purchased, bool_or(has_reserva) has_reserva,
               count(distinct case when has_proc then issued_at::date end)::int proc_dates
        from inv group by contact_id
      )
      select coalesce(sum(revenue),0)::float8 revenue,
             coalesce(sum(invoices),0)::int invoices,
             count(*)::int buyers,
             count(*) filter (where purchased)::int customers,
             count(*) filter (where not purchased and has_reserva)::int reserved,
             count(*) filter (where proc_dates >= 2)::int loyal
      from cls
    `)) as unknown as Array<{ revenue: number; invoices: number; buyers: number; customers: number; reserved: number; loyal: number }>;
    const revenue = Number(agg?.revenue ?? 0);
    const invoices = Number(agg?.invoices ?? 0);
    return {
      revenue,
      invoices,
      buyers: Number(agg?.buyers ?? 0),
      avgTicket: invoices ? revenue / invoices : 0,
      customers: Number(agg?.customers ?? 0),
      reserved: Number(agg?.reserved ?? 0),
      loyal: Number(agg?.loyal ?? 0),
    };
  });
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
