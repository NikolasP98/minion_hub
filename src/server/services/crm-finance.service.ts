import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { bothEnabled } from './modules.service';

// last-9-digit phone match (Peru), normalized in SQL on both sides.
const PHONE9 = (col: string) => sql.raw(`right(regexp_replace(coalesce(${col},''),'\\D','','g'), 9)`);

// A line item is a "reservation deposit" (the 50-soles "Reserva de Consulta")
// rather than an actual procedure — the signal that splits "reservó pero no
// compró" from real buyers.
const IS_RESERVA = sql.raw(`ii.description ilike '%reserva%'`);
const IS_PROCEDURE = sql.raw(`(ii.description is not null and ii.description not ilike '%reserva%')`);

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
      with phones as (
        select ci.contact_id, ${PHONE9('ci.external_id')} as p9
        from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.channel = 'whatsapp'
          and length(${PHONE9('ci.external_id')}) >= 8
      ),
      inv as (
        select ph.contact_id, fi.id invoice_id, coalesce(fi.total,0)::float8 total, fi.issued_at,
               bool_or(${IS_RESERVA}) has_reserva, bool_or(${IS_PROCEDURE}) has_proc
        from phones ph
        join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} = ph.p9
        join fin_invoices fi on fi.client_id = fc.id
        left join fin_invoice_items ii on ii.invoice_id = fi.id
        group by ph.contact_id, fi.id, fi.total, fi.issued_at
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
      with phones as (
        select ci.contact_id, ${PHONE9('ci.external_id')} as p9
        from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.channel = 'whatsapp'
          and length(${PHONE9('ci.external_id')}) >= 8
      ),
      inv as (
        select ph.contact_id, fi.id invoice_id, coalesce(fi.total,0)::float8 total, fi.issued_at,
               bool_or(${IS_RESERVA}) has_reserva, bool_or(${IS_PROCEDURE}) has_proc
        from phones ph
        join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} = ph.p9
        join fin_invoices fi on fi.client_id = fc.id
        left join fin_invoice_items ii on ii.invoice_id = fi.id
        group by ph.contact_id, fi.id, fi.total, fi.issued_at
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
      with phones as (
        select ${PHONE9('ci.external_id')} p9 from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.contact_id = ${contactId} and ci.channel='whatsapp'
      )
      select fi.id, fi.document_id, fi.issued_at, coalesce(fi.total,0)::float8 total, fi.status
      from fin_invoices fi
      join fin_clients fc on fc.id = fi.client_id
      where fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} in (select p9 from phones)
      order by fi.issued_at desc nulls last limit 10
    `)) as unknown as Array<Record<string, unknown>>;
    if (invoices.length === 0) return null;
    const all = invoices.map((r) => ({ id: String(r.id), documentId: r.document_id != null ? String(r.document_id) : null,
      issuedAt: r.issued_at != null ? String(r.issued_at) : null, total: Number(r.total), status: r.status != null ? String(r.status) : null }));
    const [agg] = (await tx.execute(sql`
      with phones as (select ${PHONE9('ci.external_id')} p9 from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.contact_id = ${contactId} and ci.channel='whatsapp')
      select coalesce(sum(fi.total),0)::float8 revenue, count(fi.id)::int invoices, max(fi.issued_at) last
      from fin_invoices fi join fin_clients fc on fc.id = fi.client_id
      where fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} in (select p9 from phones)
    `)) as unknown as Array<{ revenue: number; invoices: number; last: string | null }>;
    return { revenue: Number(agg.revenue), invoices: Number(agg.invoices), lastPurchaseAt: agg.last != null ? String(agg.last) : null, recentInvoices: all };
  });
}
