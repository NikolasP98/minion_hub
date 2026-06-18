import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { bothEnabled } from './modules.service';

// last-9-digit phone match (Peru), normalized in SQL on both sides.
const PHONE9 = (col: string) => sql.raw(`right(regexp_replace(coalesce(${col},''),'\\D','','g'), 9)`);

export async function contactFinanceMap(ctx: CoreCtx): Promise<Record<string, { revenue: number; invoices: number; lastPurchaseAt: string | null }>> {
  if (!(await bothEnabled(ctx, 'crm', 'finances'))) return {};
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      with phones as (
        select ci.contact_id, ${PHONE9('ci.external_id')} as p9
        from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.channel = 'whatsapp'
          and length(${PHONE9('ci.external_id')}) >= 8
      )
      select ph.contact_id,
             coalesce(sum(fi.total),0)::float8 revenue, count(fi.id)::int invoices, max(fi.issued_at) last
      from phones ph
      join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} = ph.p9
      join fin_invoices fi on fi.client_id = fc.id
      group by ph.contact_id
    `)) as unknown as Array<{ contact_id: string; revenue: number; invoices: number; last: string | null }>;
    const out: Record<string, { revenue: number; invoices: number; lastPurchaseAt: string | null }> = {};
    for (const r of rows) out[String(r.contact_id)] = { revenue: Number(r.revenue), invoices: Number(r.invoices), lastPurchaseAt: r.last != null ? String(r.last) : null };
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
): Promise<{ revenue: number; invoices: number; buyers: number; avgTicket: number } | null> {
  if (!(await bothEnabled(ctx, 'crm', 'finances'))) return null;
  return withOrgCore(ctx, async (tx) => {
    const [agg] = (await tx.execute(sql`
      with phones as (
        select distinct ci.contact_id, ${PHONE9('ci.external_id')} as p9
        from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.channel = 'whatsapp'
          and length(${PHONE9('ci.external_id')}) >= 8
      ),
      linked as (
        select ph.contact_id, fi.id as invoice_id, coalesce(fi.total,0)::float8 as total
        from phones ph
        join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} = ph.p9
        join fin_invoices fi on fi.client_id = fc.id
      )
      select coalesce(sum(total),0)::float8 revenue,
             count(invoice_id)::int invoices,
             count(distinct contact_id)::int buyers
      from linked
    `)) as unknown as Array<{ revenue: number; invoices: number; buyers: number }>;
    const revenue = Number(agg?.revenue ?? 0);
    const invoices = Number(agg?.invoices ?? 0);
    const buyers = Number(agg?.buyers ?? 0);
    return { revenue, invoices, buyers, avgTicket: invoices ? revenue / invoices : 0 };
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
