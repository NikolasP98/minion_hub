import { sql } from 'drizzle-orm';
import { cached, keys, tags } from '@minion-stack/cache';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { bothEnabled } from './modules.service';
import {
  depositMatchSql,
  depositSortKeySql,
  depositRuleFingerprint,
  notDepositMatchSql,
  type DepositRule,
} from './crm-deposit-rule';
import { resolveDepositRule } from './crm-settings.service';
import { scopeData } from './base';

// A line item may be a booking deposit rather than an actual procedure — the
// signal that splits "reservó pero no compró" from real buyers. Which words
// count as a deposit is org-configurable (crm-deposit-rule.ts), resolved
// per-org by crm-settings.service.ts's resolveDepositRule. Every
// predicate below is built call-time from a rule resolved once per public
// function invocation — never frozen at module load.
function isDepositSql(rule: DepositRule) {
  return depositMatchSql('ii.description', rule);
}
function isProcedureSql(rule: DepositRule) {
  return sql`(ii.description is not null and ${notDepositMatchSql('ii.description', rule)})`;
}

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

/**
 * Per-invoice classification rows for every CRM-linked contact — one row per
 * (contact, invoice) carrying whether that invoice contains a booking deposit
 * line and/or a real procedure line. Splice into a `with` that already declares
 * CONTACT_PARTY, inside withOrgCore (org GUC set).
 *
 * Shared so the deposit-vs-procedure split has exactly ONE definition: this file
 * aggregates it into ContactFinance, and crm-contacts.service.ts aggregates the
 * same rows into the SQL funnel floor (financeFloorStage's server twin). A second
 * hand-written copy would drift the moment the deposit rule becomes per-org.
 */
export function contactInvoiceClassSql(rule: DepositRule) {
  return sql`contact_invoice_class as (
  select cp.contact_id, fi.id invoice_id, coalesce(fi.total,0)::float8 total, fi.issued_at,
         bool_or(${isDepositSql(rule)}) has_deposit, bool_or(${isProcedureSql(rule)}) has_proc
  from contact_party cp
  join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = cp.party_id
  join fin_invoices fi on fi.client_id = fc.id
  left join fin_invoice_items ii on ii.invoice_id = fi.id
  group by cp.contact_id, fi.id, fi.total, fi.issued_at
)`;
}

/** Aggregates over CONTACT_INVOICE_CLASS rows grouped by contact — the SQL twin
 *  of the ContactFinance purchased/reservedOnly/loyal fields below. `coalesce`
 *  mirrors the TS `Boolean(...)` coercion: an invoice with no line items yields
 *  a NULL bool_or, which is false, not unknown. */
export const FIN_PURCHASED = sql`coalesce(bool_or(has_proc), false)`;
export const FIN_RESERVED_ONLY = sql`(not coalesce(bool_or(has_proc), false) and coalesce(bool_or(has_deposit), false))`;
export const FIN_LOYAL = sql`(count(distinct case when has_proc then issued_at::date end) >= 2)`;

export interface ContactFinance {
  revenue: number;
  invoices: number;
  lastPurchaseAt: string | null;
  /** has ≥1 procedure (non-deposit) line item */
  purchased: boolean;
  /** has invoices but ALL are booking deposits — the re-contact segment */
  reservedOnly: boolean;
  /** repeat procedure buyer (≥2 distinct procedure dates) */
  loyal: boolean;
}

export async function contactFinanceMap(ctx: CoreCtx): Promise<Record<string, ContactFinance>> {
  if (!(await bothEnabled(ctx, 'crm', 'finances'))) return {};
  const rule = await resolveDepositRule(ctx);
  return cached(
    keys.hub('crm-fin-map', {
      t: ctx.tenantId,
      d: scopeData({ rule: depositRuleFingerprint(rule) }),
    }),
    // crm×finances intersection: either domain's invalidation busts it.
    {
      ttl: '2m',
      swr: '30s',
      tags: [
        ...tags.tenantDomain(ctx.tenantId, 'crm'),
        ...tags.tenantDomain(ctx.tenantId, 'finances'),
      ],
    },
    () => loadContactFinanceMap(ctx, rule),
  );
}

async function loadContactFinanceMap(
  ctx: CoreCtx,
  rule: DepositRule,
): Promise<Record<string, ContactFinance>> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      with ${CONTACT_PARTY}, ${contactInvoiceClassSql(rule)}
      select contact_id,
             coalesce(sum(total),0)::float8 revenue, count(*)::int invoices, max(issued_at) last,
             ${FIN_PURCHASED} purchased, ${FIN_RESERVED_ONLY} reserved_only, ${FIN_LOYAL} loyal
      from contact_invoice_class group by contact_id
    `)) as unknown as Array<{
      contact_id: string;
      revenue: number;
      invoices: number;
      last: string | null;
      purchased: boolean;
      reserved_only: boolean;
      loyal: boolean;
    }>;
    const out: Record<string, ContactFinance> = {};
    for (const r of rows) {
      out[String(r.contact_id)] = {
        revenue: Number(r.revenue),
        invoices: Number(r.invoices),
        lastPurchaseAt: r.last != null ? String(r.last) : null,
        purchased: Boolean(r.purchased),
        reservedOnly: Boolean(r.reserved_only),
        loyal: Boolean(r.loyal),
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
export async function crmRevenueSummary(ctx: CoreCtx): Promise<{
  revenue: number;
  invoices: number;
  buyers: number;
  avgTicket: number;
  customers: number;
  reserved: number;
  loyal: number;
} | null> {
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
  const rule = await resolveDepositRule(ctx);
  return withOrgCore(ctx, async (tx) => {
    const invoices = (await tx.execute(sql`
      with cparty as (
        select party_id from crm_contacts
        where id = ${contactId} and org_id = current_setting('app.current_org_id', true) and party_id is not null
      )
      select fi.id, fi.document_id, fi.issued_at, coalesce(fi.total,0)::float8 total, fi.status,
             -- the "what was done": a representative line, procedures first (deposit lines last), priciest first.
             (select ii.description from fin_invoice_items ii where ii.invoice_id = fi.id and ii.description is not null
                order by ${depositSortKeySql('ii.description', rule)} asc, ii.total desc nulls last limit 1) as item
      from fin_invoices fi
      join fin_clients fc on fc.id = fi.client_id
      where fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = (select party_id from cparty)
      order by fi.issued_at desc nulls last limit 10
    `)) as unknown as Array<Record<string, unknown>>;
    if (invoices.length === 0) return null;
    const all = invoices.map((r) => ({
      id: String(r.id),
      documentId: r.document_id != null ? String(r.document_id) : null,
      issuedAt: r.issued_at != null ? String(r.issued_at) : null,
      total: Number(r.total),
      status: r.status != null ? String(r.status) : null,
      item: r.item != null ? String(r.item) : null,
    }));
    const [agg] = (await tx.execute(sql`
      with cparty as (select party_id from crm_contacts
        where id = ${contactId} and org_id = current_setting('app.current_org_id', true) and party_id is not null),
      inv as (
        select fi.id, coalesce(fi.total,0)::float8 total, fi.issued_at,
               bool_or(${isDepositSql(rule)}) has_deposit, bool_or(${isProcedureSql(rule)}) has_proc
        from fin_invoices fi join fin_clients fc on fc.id = fi.client_id
        left join fin_invoice_items ii on ii.invoice_id = fi.id
        where fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = (select party_id from cparty)
        group by fi.id, fi.total, fi.issued_at
      )
      select coalesce(sum(total),0)::float8 revenue, count(*)::int invoices, max(issued_at) last,
             bool_or(has_proc) purchased, bool_or(has_deposit) has_deposit,
             count(distinct case when has_proc then issued_at::date end)::int proc_dates
      from inv
    `)) as unknown as Array<{
      revenue: number;
      invoices: number;
      last: string | null;
      purchased: boolean;
      has_deposit: boolean;
      proc_dates: number;
    }>;
    const purchased = Boolean(agg?.purchased);
    return {
      revenue: Number(agg?.revenue ?? 0),
      invoices: Number(agg?.invoices ?? 0),
      lastPurchaseAt: agg?.last != null ? String(agg.last) : null,
      purchased,
      reservedOnly: !purchased && Boolean(agg?.has_deposit),
      loyal: Number(agg?.proc_dates ?? 0) >= 2,
      recentInvoices: all,
    };
  });
}

export interface ContactCashflow {
  /** money-strings (numeric column cast to text) — route through formatMoney, never Number(). */
  inflow: string;
  outflow: string;
  net: string;
  transactions: number;
  lastTransactionAt: string | null;
}

/**
 * Personal-org cashflow summary for a contact, from `fin_transactions`
 * (bank-statement imports, WP4) joined on the party spine — the personal-org
 * counterpart to `contactFinanceSummary`'s business `ContactFinance`. Kept
 * fully separate: does NOT touch fin_invoices or the ContactFinance shape
 * above. Always returns a zero-valued object (never null) when the contact
 * has no party or no linked transactions, so the caller can render an empty
 * state without a null-check.
 */
export async function contactCashflow(
  ctx: CoreCtx,
  contactId: string,
): Promise<ContactCashflow | null> {
  if (!(await bothEnabled(ctx, 'crm', 'finances'))) return null;
  const ZERO: ContactCashflow = {
    inflow: '0',
    outflow: '0',
    net: '0',
    transactions: 0,
    lastTransactionAt: null,
  };
  return withOrgCore(ctx, async (tx) => {
    const [row] = (await tx.execute(sql`
      with cparty as (
        select party_id from crm_contacts
        where id = ${contactId} and org_id = current_setting('app.current_org_id', true) and party_id is not null
      )
      select
        coalesce(sum(case when ft.signed_amount > 0 then ft.signed_amount else 0 end), 0)::text as inflow,
        coalesce(sum(case when ft.signed_amount < 0 then -ft.signed_amount else 0 end), 0)::text as outflow,
        coalesce(sum(ft.signed_amount), 0)::text as net,
        count(*)::int as transactions,
        max(ft.posted_on) as last
      from fin_transactions ft
      where ft.org_id = current_setting('app.current_org_id', true)
        and ft.party_id = (select party_id from cparty)
    `)) as unknown as Array<{
      inflow: string;
      outflow: string;
      net: string;
      transactions: number;
      last: string | null;
    }>;
    if (!row || Number(row.transactions) === 0) return ZERO;
    return {
      inflow: row.inflow,
      outflow: row.outflow,
      net: row.net,
      transactions: Number(row.transactions),
      lastTransactionAt: row.last != null ? String(row.last) : null,
    };
  });
}

export interface TopCustomer {
  contactId: string;
  name: string | null;
  revenue: number;
  invoices: number;
  /** Best-selling procedure for this customer (excludes booking deposits). */
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
  const rule = await resolveDepositRule(ctx);
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
                  and ii.description is not null and ${notDepositMatchSql('ii.description', rule)}
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
