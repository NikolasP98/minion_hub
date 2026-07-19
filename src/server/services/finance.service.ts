// src/server/services/finance.service.ts
import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  finInvoices,
  finInvoiceItems,
  finPayments,
  finClients,
  finSources,
  finProducts,
  finSettings,
} from '$server/db/pg-finance-schema';
import { docAuditLog } from '$server/db/pg-activity-schema';
import type { CanonicalInvoice } from '$server/finance/connector';
import { cached, keys, invalidateTags, tags } from '@minion-stack/cache';
import type { Period } from '$lib/finance/period';
import { emitHubEvent } from '$server/events/emit';

const numStr = (n: number | null) => (n == null ? null : String(n));

export function financeCacheTags(orgId: string) {
  return tags.tenantDomain(orgId, 'finances');
}
export function bustFinanceCache(ctx: CoreCtx) {
  return invalidateTags([...financeCacheTags(ctx.tenantId)]);
}

export function loadProductMap(ctx: CoreCtx): Promise<Map<string, string>> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select({ code: finProducts.code, id: finProducts.id })
      .from(finProducts)
      .where(eq(finProducts.orgId, ctx.tenantId));
    return new Map(rows.map((r) => [r.code, r.id]));
  });
}

/** Upsert a whole page of canonical invoices in ONE org-scoped transaction using
 *  set-based multi-row statements. ~100× fewer round-trips than per-invoice. */
export async function upsertInvoicesBatch(
  ctx: CoreCtx,
  invoices: CanonicalInvoice[],
  productMap: Map<string, string> = new Map(),
): Promise<void> {
  if (invoices.length === 0) return;
  // Dedupe invoices by providerRef (last-wins) to prevent ON CONFLICT DO UPDATE
  // from seeing the same conflict target twice in one statement (Postgres error).
  const invMap = new Map<string, CanonicalInvoice>();
  for (const inv of invoices) invMap.set(inv.providerRef, inv);
  const deduped = [...invMap.values()];
  await withOrgCore(ctx, async (tx) => {
    // 1. Clients (dedupe by providerRef within the page).
    const clients = new Map<string, CanonicalInvoice['client']>();
    for (const inv of deduped) if (inv.client) clients.set(inv.client.providerRef, inv.client);
    const clientIdByRef = new Map<string, string>();
    if (clients.size) {
      const rows = await tx
        .insert(finClients)
        .values(
          [...clients.values()].map((c) => ({
            orgId: ctx.tenantId,
            provider: c!.provider,
            providerRef: c!.providerRef,
            name: c!.name,
            docType: c!.docType,
            docNumber: c!.docNumber,
            email: c!.email,
            phone: c!.phone,
            metadata: c!.metadata,
          })),
        )
        .onConflictDoUpdate({
          target: [finClients.orgId, finClients.provider, finClients.providerRef],
          set: {
            name: sql`excluded.name`,
            docType: sql`excluded.doc_type`,
            // Never clobber a curated DNI with a source blank: the mapper nulls
            // SUSII's placeholder, so coalesce keeps the existing value when the
            // incoming doc is empty, and takes the source value when it's real.
            docNumber: sql`coalesce(excluded.doc_number, ${finClients.docNumber})`,
            email: sql`excluded.email`,
            phone: sql`excluded.phone`,
            metadata: sql`excluded.metadata`,
          },
        })
        .returning({ providerRef: finClients.providerRef, id: finClients.id });
      for (const r of rows) clientIdByRef.set(r.providerRef, r.id);
    }

    // 2. Invoices (resolve client_id from step 1).
    const invRows = await tx
      .insert(finInvoices)
      .values(
        deduped.map((inv) => ({
          orgId: ctx.tenantId,
          provider: inv.provider,
          providerRef: inv.providerRef,
          number: inv.number,
          documentId: inv.documentId,
          issuedAt: inv.issuedAt ? new Date(inv.issuedAt) : null,
          clientId: inv.client ? (clientIdByRef.get(inv.client.providerRef) ?? null) : null,
          clientName: inv.clientName,
          clientDocType: inv.clientDocType,
          clientDocNumber: inv.clientDocNumber,
          clientEmail: inv.clientEmail,
          currency: inv.currency,
          subtotal: numStr(inv.subtotal),
          tax: numStr(inv.tax),
          discount: numStr(inv.discount),
          total: numStr(inv.total),
          status: inv.status,
          seller: inv.seller,
          note: inv.note,
          metadata: inv.metadata,
          syncedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [finInvoices.orgId, finInvoices.provider, finInvoices.providerRef],
        set: {
          number: sql`excluded.number`,
          documentId: sql`excluded.document_id`,
          issuedAt: sql`excluded.issued_at`,
          clientId: sql`excluded.client_id`,
          clientName: sql`excluded.client_name`,
          clientDocType: sql`excluded.client_doc_type`,
          clientDocNumber: sql`excluded.client_doc_number`,
          clientEmail: sql`excluded.client_email`,
          currency: sql`excluded.currency`,
          subtotal: sql`excluded.subtotal`,
          tax: sql`excluded.tax`,
          discount: sql`excluded.discount`,
          total: sql`excluded.total`,
          status: sql`excluded.status`,
          seller: sql`excluded.seller`,
          note: sql`excluded.note`,
          metadata: sql`excluded.metadata`,
          syncedAt: sql`excluded.synced_at`,
        },
      })
      .returning({
        providerRef: finInvoices.providerRef,
        id: finInvoices.id,
        // ON CONFLICT DO UPDATE always RETURNING-s a row; xmax=0 is the standard
        // Postgres trick to tell "just inserted" (create) from "hit the conflict
        // and updated" (update) without a pre-image SELECT per row.
        inserted: sql<boolean>`(xmax = 0)`,
      });
    const invIdByRef = new Map(invRows.map((r) => [r.providerRef, r.id]));
    const invoiceIds = [...invIdByRef.values()];

    // Audit trail: one set-based insert for the whole page, no per-row
    // pre-image fetch (would defeat the batch optimization). `create` rows get
    // no diff; `update` rows get a trivial diff off the upserted data itself.
    await tx.insert(docAuditLog).values(
      invRows.map((r) => {
        const inv = invMap.get(r.providerRef);
        return {
          orgId: ctx.tenantId,
          refType: 'fin_invoice',
          refId: r.id,
          op: r.inserted ? 'create' : 'update',
          changes: r.inserted || !inv ? [] : [{ field: 'total', label: 'Total', old: null, new: inv.total }],
          actorId: null,
          actorName: `connector:${inv?.provider ?? 'connector'}`,
        };
      }),
    );

    // 3. Replace children for these invoices (set-based delete + multi-row insert).
    await tx.delete(finInvoiceItems).where(inArray(finInvoiceItems.invoiceId, invoiceIds));
    const itemRows = deduped.flatMap((inv) => {
      const invoiceId = invIdByRef.get(inv.providerRef);
      if (!invoiceId) return [];
      return inv.items.map((it) => ({
        orgId: ctx.tenantId,
        invoiceId,
        productId: it.code ? (productMap.get(it.code) ?? null) : null,
        code: it.code,
        description: it.description,
        category: it.category,
        quantity: numStr(it.quantity),
        unitPrice: numStr(it.unitPrice),
        discount: numStr(it.discount),
        tax: numStr(it.tax),
        total: numStr(it.total),
        metadata: it.metadata,
      }));
    });
    if (itemRows.length) await tx.insert(finInvoiceItems).values(itemRows);

    await tx.delete(finPayments).where(inArray(finPayments.invoiceId, invoiceIds));
    const payRows = deduped.flatMap((inv) => {
      const invoiceId = invIdByRef.get(inv.providerRef);
      if (!invoiceId) return [];
      return inv.payments.map((p) => ({
        orgId: ctx.tenantId,
        invoiceId,
        providerRef: p.providerRef,
        method: p.method,
        paidAt: p.paidAt ? new Date(p.paidAt) : null,
        amount: numStr(p.amount),
        status: p.status,
        metadata: p.metadata,
      }));
    });
    if (payRows.length) await tx.insert(finPayments).values(payRows);

    const created = invRows.filter((r) => r.inserted).length;
    await emitHubEvent(tx, {
      type: 'finance.invoices_upserted',
      orgId: ctx.tenantId,
      created,
      updated: invRows.length - created,
    });
  });
}

/** Single-invoice convenience (tests / any non-batch caller). */
export async function upsertInvoice(ctx: CoreCtx, inv: CanonicalInvoice): Promise<void> {
  await upsertInvoicesBatch(ctx, [inv]);
}

export interface PageOpts {
  limit?: number;
  offset?: number;
  /** Filter to one CRM contact's records via the shared party spine (Connections
   *  "count → filtered list"). Resolves contact → party → fin_clients. */
  contactId?: string;
}

export interface InvoiceListRow {
  id: string;
  number: string | null;
  documentId: string | null;
  issuedAt: Date | null;
  clientName: string | null;
  clientDocNumber: string | null;
  total: string | null;
  discount: string | null;
  status: string | null;
  /** CRM contact resolved via the party spine (client → party → contact), so the
   *  Client/DNI columns can deep-link to /crm/[id]. Null when unlinked. */
  crmContactId: string | null;
}

/**
 * Paged invoice list. Server-side limit/offset on the (org_id, issued_at) index;
 * projects only the columns the list table renders. Returns the page rows plus
 * the total row count so the UI can drive "load more" / pagination.
 */
export function listInvoices(
  ctx: CoreCtx,
  opts: PageOpts = {},
): Promise<{ rows: InvoiceListRow[]; total: number }> {
  // ponytail: 10k ceiling so the invoices view can client-side sort/filter the
  // whole set (like CRM customers). Re-introduce server paging past that.
  const limit = Math.min(opts.limit ?? 60, 10_000);
  const offset = Math.max(opts.offset ?? 0, 0);
  // Contact filter via the party spine: invoices whose client shares the
  // contact's party. Null when no contact requested.
  const contactCond = opts.contactId
    ? sql`${finInvoices.clientId} in (
        select fc.id from fin_clients fc
        join crm_contacts c on c.party_id = fc.party_id and c.party_id is not null
        where c.id = ${opts.contactId} and c.org_id = ${ctx.tenantId})`
    : undefined;
  const where = and(eq(finInvoices.orgId, ctx.tenantId), contactCond);
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: finInvoices.id,
        number: finInvoices.number,
        documentId: finInvoices.documentId,
        issuedAt: finInvoices.issuedAt,
        clientName: finInvoices.clientName,
        clientDocNumber: finInvoices.clientDocNumber,
        // Reconstruct Σitems + tax − discount when the stored total is null/0
        // (imported invoices leave it unpopulated). See effTotal() for the rationale.
        total: sql<string | null>`${effTotal()}`,
        discount: finInvoices.discount,
        status: finInvoices.status,
        // Correlated subquery (not a join) so an invoice stays one row even if a
        // party maps to >1 contact. Resolves client → party → CRM contact id.
        crmContactId: sql<string | null>`(
          select c.id from fin_clients fc
          join crm_contacts c on c.party_id = fc.party_id
            and c.party_id is not null and c.org_id = ${ctx.tenantId}
          where fc.id = ${finInvoices.clientId}
          limit 1)`,
      })
      .from(finInvoices)
      .where(where)
      .orderBy(desc(finInvoices.issuedAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(finInvoices)
      .where(where);
    return { rows, total };
  });
}

export async function getInvoice(ctx: CoreCtx, id: string) {
  return withOrgCore(ctx, async (tx) => {
    const [invoice] = await tx
      .select()
      .from(finInvoices)
      .where(and(eq(finInvoices.id, id), eq(finInvoices.orgId, ctx.tenantId)))
      .limit(1);
    if (!invoice) return null;
    const items = await tx.select().from(finInvoiceItems).where(eq(finInvoiceItems.invoiceId, id));
    const payments = await tx.select().from(finPayments).where(eq(finPayments.invoiceId, id));
    // Resolve the CRM contact (client → party → contact) so the detail view can
    // deep-link the client name to /crm/[id]. Null when unlinked.
    const [link] = invoice.clientId
      ? ((await tx.execute(sql`
          select c.id from fin_clients fc
          join crm_contacts c on c.party_id = fc.party_id
            and c.party_id is not null and c.org_id = ${ctx.tenantId}
          where fc.id = ${invoice.clientId}
          limit 1`)) as unknown as Array<{ id: string }>)
      : [];
    return { invoice, items, payments, crmContactId: link?.id ?? null };
  });
}

// ---- org finance settings (currency / tax rate / exchange rate) ----

export interface FinSettings {
  currency: string;
  taxRate: number; // IGV as a fraction (0.18 = 18%)
  fxBase: string;
  fxQuote: string;
  fxMode: 'auto' | 'manual';
  fxManualRate: number | null;
  fxAutoRate: number | null;
  fxSource: string | null;
  fxUpdatedAt: string | null;
  /** effective rate = manual override when in manual mode, else the auto value */
  fxRate: number | null;
}

export const DEFAULT_FIN_SETTINGS: Readonly<FinSettings> = Object.freeze({
  currency: 'PEN',
  taxRate: 0.18,
  fxBase: 'USD',
  fxQuote: 'PEN',
  fxMode: 'auto',
  fxManualRate: null,
  fxAutoRate: null,
  fxSource: null,
  fxUpdatedAt: null,
  fxRate: null,
});

function mapFinSettings(row: typeof finSettings.$inferSelect): FinSettings {
  const mode = row.fxMode === 'manual' ? 'manual' : 'auto';
  const manual = row.fxManualRate != null ? Number(row.fxManualRate) : null;
  const auto = row.fxAutoRate != null ? Number(row.fxAutoRate) : null;
  return {
    currency: row.currency,
    taxRate: Number(row.taxRate),
    fxBase: row.fxBase,
    fxQuote: row.fxQuote,
    fxMode: mode,
    fxManualRate: manual,
    fxAutoRate: auto,
    fxSource: row.fxSource,
    fxUpdatedAt: row.fxUpdatedAt ? row.fxUpdatedAt.toISOString() : null,
    fxRate: mode === 'manual' ? manual : auto,
  };
}

export async function getFinSettings(ctx: CoreCtx): Promise<FinSettings> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx.select().from(finSettings).where(eq(finSettings.orgId, ctx.tenantId)).limit(1),
  );
  return row ? mapFinSettings(row) : { ...DEFAULT_FIN_SETTINGS };
}

export async function updateFinSettings(ctx: CoreCtx, patch: Partial<FinSettings>): Promise<FinSettings> {
  // Validate the fields a user can set. taxRate is a fraction in [0, 1);
  // exchange rates must be positive when provided.
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.currency != null) set.currency = String(patch.currency).toUpperCase().slice(0, 8);
  if (patch.taxRate != null) {
    const t = Number(patch.taxRate);
    if (!Number.isFinite(t) || t < 0 || t >= 1) throw new Error('taxRate must be a fraction in [0, 1)');
    set.taxRate = String(t);
  }
  if (patch.fxMode != null) {
    if (patch.fxMode !== 'auto' && patch.fxMode !== 'manual') throw new Error('fxMode must be auto|manual');
    set.fxMode = patch.fxMode;
  }
  if (patch.fxManualRate !== undefined) {
    if (patch.fxManualRate === null) set.fxManualRate = null;
    else {
      const r = Number(patch.fxManualRate);
      if (!Number.isFinite(r) || r <= 0) throw new Error('fxManualRate must be a positive number');
      set.fxManualRate = String(r);
    }
  }
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(finSettings)
      .values({ orgId: ctx.tenantId, ...(set as Record<string, never>) })
      .onConflictDoUpdate({ target: finSettings.orgId, set })
      .returning(),
  );
  return mapFinSettings(row);
}

/**
 * Fetch the live USD→PEN rate from a free, keyless source and store it as the
 * auto rate. Fixed URL (no user input → no SSRF surface); short timeout so a
 * slow upstream can't hang the request. Returns the refreshed settings.
 */
export async function refreshExchangeRate(ctx: CoreCtx): Promise<FinSettings> {
  const current = await getFinSettings(ctx);
  const base = current.fxBase || 'USD';
  const quote = current.fxQuote || 'PEN';
  const source = 'open.er-api.com';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let rate: number;
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`exchange source returned ${res.status}`);
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
    const r = data?.rates?.[quote];
    if (data?.result !== 'success' || typeof r !== 'number' || !Number.isFinite(r) || r <= 0) {
      throw new Error(`no ${quote} rate in exchange response`);
    }
    rate = r;
  } finally {
    clearTimeout(timer);
  }
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(finSettings)
      .values({ orgId: ctx.tenantId, fxAutoRate: String(rate), fxSource: source, fxUpdatedAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: finSettings.orgId,
        set: { fxAutoRate: String(rate), fxSource: source, fxUpdatedAt: new Date(), updatedAt: new Date() },
      })
      .returning(),
  );
  return mapFinSettings(row);
}

export async function getSource(ctx: CoreCtx, provider: string) {
  return withOrgCore(ctx, async (tx) => {
    const [s] = await tx
      .select()
      .from(finSources)
      .where(and(eq(finSources.orgId, ctx.tenantId), eq(finSources.provider, provider)))
      .limit(1);
    return s ?? null;
  });
}

/** Returns true when the source row already has encrypted credentials stored. */
export function sourceHasCredentials(source: { secretRefs?: unknown } | null | undefined): boolean {
  const refs = source?.secretRefs as Record<string, unknown> | null | undefined;
  return !!(refs?.ciphertext && refs?.iv);
}

export async function upsertSource(
  ctx: CoreCtx,
  provider: string,
  data: { config: Record<string, unknown>; secretRefs: Record<string, unknown>; enabled: boolean },
) {
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(finSources)
      .values({ orgId: ctx.tenantId, provider, ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [finSources.orgId, finSources.provider],
        set: { ...data, updatedAt: new Date() },
      }),
  );
}

export async function setSourceSync(
  ctx: CoreCtx,
  provider: string,
  s: { watermark: string; status: string },
) {
  await withOrgCore(ctx, (tx) =>
    tx
      .update(finSources)
      .set({
        watermark: s.watermark,
        lastStatus: s.status,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(finSources.orgId, ctx.tenantId), eq(finSources.provider, provider))),
  );
}

/**
 * Effective invoice total: the stored `total` when real, else reconstructed as
 * Σ(line items) + tax − discount. Imported (SUSII) invoices leave `total` null/0
 * though items/tax/discount are present — verified to match recorded payments for
 * 100% of the null-total rows. Keep in sync with listInvoices + the detail view.
 * ponytail: correlated subquery; swap for a grouped item-sum CTE if a dashboard
 * query gets slow (all these are Valkey-cached, so unlikely to matter).
 */
// Outer refs are qualified (default `fin_invoices.`) so the correlated `invoice_id`
// resolves to the outer invoice, not the subquery's own `fin_invoice_items.id`.
function effTotal(alias = 'fin_invoices') {
  const a = `${alias}.`;
  // round(…, 2): line items are stored as repeating decimals (e.g. 1525.4237…), so
  // the reconstructed sum carries float noise — snap it to money precision.
  return sql`round(coalesce(nullif(${sql.raw(a)}total::numeric, 0),
    (select sum(it.total::numeric) from fin_invoice_items it where it.invoice_id = ${sql.raw(a)}id)
      + coalesce(${sql.raw(a)}tax::numeric, 0) - coalesce(${sql.raw(a)}discount::numeric, 0)), 2)`;
}

/**
 * Customer grouping key: the real DNI, else fall back to client_id. Treats the
 * placeholder DNI '00000000' (walk-ins / no-DNI boletas) as "no doc" so those
 * invoices group per-client instead of collapsing 200+ distinct people into one
 * mega-client. Keep in sync across every client aggregate below.
 */
function clientKey(alias = 'fin_invoices') {
  const a = `${alias}.`;
  return sql`coalesce(nullif(${sql.raw(a)}client_doc_number, '00000000'), ${sql.raw(a)}client_id::text)`;
}

/** Per-client revenue aggregate (for the Clients list page). */
export async function clientRevenueRows(ctx: CoreCtx) {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select ${clientKey()} as client_doc_number, max(client_name) as name, count(*)::int as invoices,
             coalesce(sum(${effTotal()}), 0)::float8 as revenue, max(issued_at) as last
      from fin_invoices
      where org_id = ${ctx.tenantId} and (client_doc_number is not null or client_id is not null)
      group by ${clientKey()} order by revenue desc limit 500
    `)) as unknown as Array<{
      client_doc_number: unknown;
      name: unknown;
      invoices: unknown;
      revenue: unknown;
      last: unknown;
    }>;
    return rows.map((r) => ({
      docNumber: String(r.client_doc_number),
      name: r.name != null ? String(r.name) : null,
      invoices: Number(r.invoices),
      revenue: Number(r.revenue),
      last: r.last != null ? String(r.last) : null,
    }));
  });
}

// ── Period-scoped, Valkey-cached dashboard aggregates ──────────────────────

function periodWhere(p: Period, alias = '') {
  const c = alias ? `${alias}.` : '';
  const conds = [sql`${sql.raw(c)}org_id = current_setting('app.current_org_id', true)`];
  if (p.from) conds.push(sql`${sql.raw(c)}issued_at >= ${p.from}`);
  // INCLUSIVE of the whole `to` day: `p.to` is normalized to that day's midnight,
  // so a plain `< to` drops same-day records (from=to=Jun-1 returned zero despite
  // Jun-1 sales). Half-open interval to the NEXT day's midnight covers the full day.
  if (p.to) conds.push(sql`${sql.raw(c)}issued_at < (${p.to}::timestamptz + interval '1 day')`);
  return sql.join(conds, sql` and `);
}

const ck = (org: string, name: string, p: Period) =>
  keys.hub(`fin-${name}`, { t: org, d: { f: p.from ?? '', e: p.to ?? '', b: p.bucket } });

const ctags = (org: string) => [...financeCacheTags(org)];

export function financeSummary(ctx: CoreCtx, p: Period) {
  return cached(
    ck(ctx.tenantId, 'summary', p),
    { ttl: '2m', swr: '30s', tags: ctags(ctx.tenantId) },
    () =>
      withOrgCore(ctx, async (tx) => {
        const [r] = (await tx.execute(sql`
        select coalesce(sum(${effTotal()}),0)::float8 net, coalesce(sum(subtotal),0)::float8 gross,
               coalesce(sum(discount),0)::float8 discount, count(*)::int invoices,
               coalesce(sum(tax::numeric) filter (where status is distinct from 'void'),0)::float8 tax,
               count(distinct coalesce(client_id::text, client_doc_number))::int clients,
               count(*) filter (where status='void')::int voids,
               mode() within group (order by currency) currency
        from fin_invoices where ${periodWhere(p)}
      `)) as unknown as Array<Record<string, unknown>>;
        // COGS = value of inventory consumed (issue-type ledger), same source as the
        // revenue chart's op-cost band, scoped to the period by posted_at.
        const [cg] = (await tx.execute(sql`
        select coalesce(-sum(l.value_delta::numeric),0)::float8 cogs
        from stk_ledger l join stk_entries e on e.id = l.entry_id
        where e.type = 'issue' and l.org_id = current_setting('app.current_org_id', true)
          ${p.from ? sql`and l.posted_at >= ${p.from}` : sql``}
          ${p.to ? sql`and l.posted_at < ${p.to}` : sql``}
      `)) as unknown as Array<{ cogs: number }>;
        const net = Number(r.net),
          gross = Number(r.gross),
          discount = Number(r.discount),
          invoices = Number(r.invoices),
          voids = Number(r.voids),
          tax = Number(r.tax),
          cogs = Number(cg.cogs);
        // Some sources don't populate subtotal (gross); fall back to net + discount
        // so the discount rate has a real denominator instead of dividing by zero.
        const grossEff = gross > 0 ? gross : net + discount;
        // Net revenue after realized deductions (taxes remitted + COGS) = the money
        // the business actually keeps. Margin rate = that as a share of billed revenue.
        const netAfter = Math.max(0, net - tax - cogs);
        const [nc] = (await tx.execute(sql`
        select count(*)::int n from (
          select ${clientKey()} as k, min(issued_at) first from fin_invoices
          where org_id = current_setting('app.current_org_id', true)
            and (client_doc_number is not null or client_id is not null) group by ${clientKey()}
        ) f where ${p.from ? sql`f.first >= ${p.from}` : sql`true`} and ${p.to ? sql`f.first < ${p.to}` : sql`true`}
      `)) as unknown as Array<{ n: number }>;
        return {
          totalNet: net,
          totalGross: grossEff,
          totalDiscount: discount,
          discountRate: grossEff > 0 ? discount / grossEff : 0,
          totalTax: tax,
          taxRate: net > 0 ? tax / net : 0,
          totalCogs: cogs,
          netRevenue: netAfter,
          marginRate: net > 0 ? netAfter / net : 0,
          invoiceCount: invoices,
          avgTicket: invoices > 0 ? net / invoices : 0,
          uniqueClients: Number(r.clients),
          newClients: Number(nc.n),
          voidCount: voids,
          voidRate: invoices > 0 ? voids / invoices : 0,
          currency: r.currency != null ? String(r.currency) : 'PEN',
          // Field-level: set true by maskFinanceSummary when cost/margin redacted.
          sensitiveMasked: false,
        };
      }),
  );
}

export type FinanceSummary = Awaited<ReturnType<typeof financeSummary>>;

/**
 * Field-level (Phase 4) redaction of the finance summary: null the cost/margin
 * figures (discount, discount rate, gross) for callers below the finance
 * sensitive field level. Revenue/ticket/client counts stay visible. Applied
 * post-cache so the cache key stays role-agnostic.
 */
export function maskFinanceSummary(s: FinanceSummary): FinanceSummary {
  return {
    ...s,
    totalGross: 0,
    totalDiscount: 0,
    discountRate: 0,
    // COGS + margin are cost data; tax stays visible (remittance, not margin).
    totalCogs: 0,
    netRevenue: 0,
    marginRate: 0,
    sensitiveMasked: true,
  };
}

export function revenueSeries(ctx: CoreCtx, p: Period) {
  return cached(
    ck(ctx.tenantId, 'series', p),
    { ttl: '2m', swr: '30s', tags: ctags(ctx.tenantId) },
    () =>
      withOrgCore(ctx, async (tx) => {
        // Two independent aggregates joined by bucket: invoices (by issued_at) and
        // inventory consumption cost (issue-type ledger value, by posted_at). FULL
        // JOIN so a bucket with only one of the two still appears. op_cost: issue
        // value_delta is stored negative (stock leaving) → negate to a positive cost.
        const rows = (await tx.execute(sql`
        with inv as (
          select date_trunc(${p.bucket}, issued_at) b,
                 count(*)::int invoices,
                 coalesce(sum(${effTotal()}) filter (where status is distinct from 'void'),0)::float8 revenue,
                 coalesce(sum(discount) filter (where status is distinct from 'void'),0)::float8 discount,
                 coalesce(sum(subtotal),0)::float8 gross,
                 coalesce(sum(${effTotal()}) filter (where status = 'void'),0)::float8 voided,
                 coalesce(sum(tax::numeric) filter (where status is distinct from 'void'),0)::float8 tax
          from fin_invoices where ${periodWhere(p)} and issued_at is not null
          group by 1
        ),
        cost as (
          select date_trunc(${p.bucket}, l.posted_at) b,
                 coalesce(-sum(l.value_delta::numeric),0)::float8 op_cost
          from stk_ledger l join stk_entries e on e.id = l.entry_id
          where e.type = 'issue'
            and l.org_id = current_setting('app.current_org_id', true)
            ${p.from ? sql`and l.posted_at >= ${p.from}` : sql``}
            ${p.to ? sql`and l.posted_at < ${p.to}` : sql``}
          group by 1
        )
        select to_char(coalesce(inv.b, cost.b), 'YYYY-MM-DD') bucket,
               coalesce(inv.invoices,0)::int invoices,
               coalesce(inv.revenue,0)::float8 revenue,
               coalesce(inv.discount,0)::float8 discount,
               coalesce(inv.gross,0)::float8 gross,
               coalesce(inv.voided,0)::float8 voided,
               coalesce(inv.tax,0)::float8 tax,
               coalesce(cost.op_cost,0)::float8 op_cost
        from inv full join cost on inv.b = cost.b
        where coalesce(inv.b, cost.b) is not null
        order by 1
      `)) as unknown as Array<Record<string, unknown>>;
        return rows.map((r) => ({
          bucket: String(r.bucket),
          invoices: Number(r.invoices),
          revenue: Number(r.revenue),
          discount: Number(r.discount),
          gross: Number(r.gross),
          voided: Number(r.voided),
          tax: Number(r.tax),
          opCost: Number(r.op_cost),
        }));
      }),
  );
}

export function topProducts(ctx: CoreCtx, p: Period, opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 15;
  return cached(
    ck(ctx.tenantId, `products-${limit}`, p),
    { ttl: '2m', swr: '30s', tags: ctags(ctx.tenantId) },
    () =>
      withOrgCore(ctx, async (tx) => {
        const rows = (await tx.execute(sql`
        select max(ii.product_id::text) product_id, max(ii.code) code,
               coalesce(max(p.name), max(ii.description)) name,
               coalesce(sum(ii.total::numeric), 0)::float8 revenue,
               coalesce(sum(ii.quantity::numeric), 0)::float8 qty,
               count(*)::int lines
        from fin_invoice_items ii
        join fin_invoices inv on inv.id = ii.invoice_id
        left join fin_products p on p.id = ii.product_id
        where ${periodWhere(p, 'inv')}
          and (ii.product_id is not null or ii.code is not null)
        group by coalesce(ii.product_id::text, ii.code)
        order by revenue desc
        limit ${limit}
      `)) as unknown as Array<Record<string, unknown>>;
        return rows.map((r) => ({
          productId: r.product_id != null ? String(r.product_id) : null,
          code: r.code != null ? String(r.code) : null,
          name: r.name != null ? String(r.name) : null,
          revenue: Number(r.revenue),
          qty: Number(r.qty),
          lines: Number(r.lines),
        }));
      }),
  );
}

export function topClients(ctx: CoreCtx, p: Period, opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 10;
  return cached(
    ck(ctx.tenantId, `clients-${limit}`, p),
    { ttl: '2m', swr: '30s', tags: ctags(ctx.tenantId) },
    () =>
      withOrgCore(ctx, async (tx) => {
        const rows = (await tx.execute(sql`
        select ${clientKey()} doc_number,
               max(client_name) name,
               count(*)::int invoices,
               coalesce(sum(${effTotal()}), 0)::float8 revenue,
               max(issued_at) last
        from fin_invoices
        where ${periodWhere(p)}
          and (client_doc_number is not null or client_id is not null)
        group by ${clientKey()}
        order by revenue desc
        limit ${limit}
      `)) as unknown as Array<Record<string, unknown>>;
        return rows.map((r) => ({
          docNumber: r.doc_number != null ? String(r.doc_number) : null,
          name: r.name != null ? String(r.name) : null,
          invoices: Number(r.invoices),
          revenue: Number(r.revenue),
          last: r.last != null ? String(r.last) : null,
        }));
      }),
  );
}
