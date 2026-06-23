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
} from '$server/db/pg-finance-schema';
import type { CanonicalInvoice } from '$server/finance/connector';
import { cached, keys, invalidateTags, tags } from '@minion-stack/cache';
import type { Period } from '$lib/finance/period';

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
            docNumber: sql`excluded.doc_number`,
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
      .returning({ providerRef: finInvoices.providerRef, id: finInvoices.id });
    const invIdByRef = new Map(invRows.map((r) => [r.providerRef, r.id]));
    const invoiceIds = [...invIdByRef.values()];

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
  status: string | null;
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
  const limit = Math.min(opts.limit ?? 60, 500);
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
        total: finInvoices.total,
        status: finInvoices.status,
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
    return { invoice, items, payments };
  });
}

export interface PaymentListRow {
  id: string;
  paidAt: Date | null;
  method: string | null;
  amount: string | null;
  status: string | null;
}

/**
 * Paged payment list. Server-side limit/offset on the (org_id, paid_at) index;
 * projects only the columns the list table renders. Returns the page rows plus
 * the total row count so the UI can drive "load more" / pagination.
 */
export function listPayments(
  ctx: CoreCtx,
  opts: PageOpts = {},
): Promise<{ rows: PaymentListRow[]; total: number }> {
  const limit = Math.min(opts.limit ?? 60, 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  // Contact filter via the party spine: payments on invoices whose client shares
  // the contact's party.
  const contactCond = opts.contactId
    ? sql`${finPayments.invoiceId} in (
        select fi.id from fin_invoices fi
        join fin_clients fc on fc.id = fi.client_id
        join crm_contacts c on c.party_id = fc.party_id and c.party_id is not null
        where c.id = ${opts.contactId} and c.org_id = ${ctx.tenantId})`
    : undefined;
  const where = and(eq(finPayments.orgId, ctx.tenantId), contactCond);
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: finPayments.id,
        paidAt: finPayments.paidAt,
        method: finPayments.method,
        amount: finPayments.amount,
        status: finPayments.status,
      })
      .from(finPayments)
      .where(where)
      .orderBy(desc(finPayments.paidAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(finPayments)
      .where(where);
    return { rows, total };
  });
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

/** Per-client revenue aggregate (for the Clients list page). */
export async function clientRevenueRows(ctx: CoreCtx) {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select client_doc_number, max(client_name) as name, count(*)::int as invoices,
             coalesce(sum(total), 0)::float8 as revenue, max(issued_at) as last
      from fin_invoices
      where org_id = ${ctx.tenantId} and client_doc_number is not null
      group by client_doc_number order by revenue desc limit 500
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
  if (p.to) conds.push(sql`${sql.raw(c)}issued_at < ${p.to}`);
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
        select coalesce(sum(total),0)::float8 net, coalesce(sum(subtotal),0)::float8 gross,
               coalesce(sum(discount),0)::float8 discount, count(*)::int invoices,
               count(distinct coalesce(client_id::text, client_doc_number))::int clients,
               count(*) filter (where status='void')::int voids,
               mode() within group (order by currency) currency
        from fin_invoices where ${periodWhere(p)}
      `)) as unknown as Array<Record<string, unknown>>;
        const net = Number(r.net),
          gross = Number(r.gross),
          discount = Number(r.discount),
          invoices = Number(r.invoices),
          voids = Number(r.voids);
        const [nc] = (await tx.execute(sql`
        select count(*)::int n from (
          select client_doc_number, min(issued_at) first from fin_invoices
          where org_id = current_setting('app.current_org_id', true) and client_doc_number is not null group by client_doc_number
        ) f where ${p.from ? sql`f.first >= ${p.from}` : sql`true`} and ${p.to ? sql`f.first < ${p.to}` : sql`true`}
      `)) as unknown as Array<{ n: number }>;
        return {
          totalNet: net,
          totalGross: gross,
          totalDiscount: discount,
          discountRate: gross > 0 ? discount / gross : 0,
          invoiceCount: invoices,
          avgTicket: invoices > 0 ? net / invoices : 0,
          uniqueClients: Number(r.clients),
          newClients: Number(nc.n),
          voidCount: voids,
          voidRate: invoices > 0 ? voids / invoices : 0,
          currency: r.currency != null ? String(r.currency) : 'PEN',
        };
      }),
  );
}

export function revenueSeries(ctx: CoreCtx, p: Period) {
  return cached(
    ck(ctx.tenantId, 'series', p),
    { ttl: '2m', swr: '30s', tags: ctags(ctx.tenantId) },
    () =>
      withOrgCore(ctx, async (tx) => {
        const rows = (await tx.execute(sql`
        select to_char(date_trunc(${p.bucket}, issued_at), 'YYYY-MM-DD') bucket,
               count(*)::int invoices, coalesce(sum(total),0)::float8 revenue,
               coalesce(sum(discount),0)::float8 discount, coalesce(sum(subtotal),0)::float8 gross
        from fin_invoices where ${periodWhere(p)} and issued_at is not null
        group by 1 order by 1
      `)) as unknown as Array<Record<string, unknown>>;
        return rows.map((r) => ({
          bucket: String(r.bucket),
          invoices: Number(r.invoices),
          revenue: Number(r.revenue),
          discount: Number(r.discount),
          gross: Number(r.gross),
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
        select coalesce(client_doc_number, client_id::text) doc_number,
               max(client_name) name,
               count(*)::int invoices,
               coalesce(sum(total::numeric), 0)::float8 revenue,
               max(issued_at) last
        from fin_invoices
        where ${periodWhere(p)}
          and (client_doc_number is not null or client_id is not null)
        group by coalesce(client_doc_number, client_id::text)
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
