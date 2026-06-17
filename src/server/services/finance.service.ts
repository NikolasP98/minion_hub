// src/server/services/finance.service.ts
import { and, eq, desc, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finInvoices, finInvoiceItems, finPayments, finClients, finSources } from '$server/db/pg-finance-schema';
import type { CanonicalInvoice } from '$server/finance/connector';

const numStr = (n: number | null) => (n == null ? null : String(n));

/** Upsert one canonical invoice + replace its children. Single org-scoped tx. */
export async function upsertInvoice(ctx: CoreCtx, inv: CanonicalInvoice): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    if (inv.client) {
      await tx.insert(finClients).values({
        orgId: ctx.tenantId, provider: inv.client.provider, providerRef: inv.client.providerRef,
        name: inv.client.name, docType: inv.client.docType, docNumber: inv.client.docNumber,
        email: inv.client.email, phone: inv.client.phone, metadata: inv.client.metadata,
      }).onConflictDoUpdate({
        target: [finClients.orgId, finClients.provider, finClients.providerRef],
        set: { name: inv.client.name, docType: inv.client.docType, docNumber: inv.client.docNumber,
               email: inv.client.email, phone: inv.client.phone, metadata: inv.client.metadata },
      });
    }
    const [row] = await tx.insert(finInvoices).values({
      orgId: ctx.tenantId, provider: inv.provider, providerRef: inv.providerRef, number: inv.number,
      documentId: inv.documentId, issuedAt: inv.issuedAt ? new Date(inv.issuedAt) : null,
      clientName: inv.clientName, clientDocType: inv.clientDocType, clientDocNumber: inv.clientDocNumber,
      clientEmail: inv.clientEmail, currency: inv.currency, subtotal: numStr(inv.subtotal), tax: numStr(inv.tax),
      discount: numStr(inv.discount), total: numStr(inv.total), status: inv.status, seller: inv.seller,
      note: inv.note, metadata: inv.metadata, syncedAt: new Date(),
    }).onConflictDoUpdate({
      target: [finInvoices.orgId, finInvoices.provider, finInvoices.providerRef],
      set: { number: inv.number, documentId: inv.documentId, issuedAt: inv.issuedAt ? new Date(inv.issuedAt) : null,
             clientName: inv.clientName, clientDocType: inv.clientDocType, clientDocNumber: inv.clientDocNumber,
             clientEmail: inv.clientEmail, currency: inv.currency, subtotal: numStr(inv.subtotal), tax: numStr(inv.tax),
             discount: numStr(inv.discount), total: numStr(inv.total), status: inv.status, seller: inv.seller,
             note: inv.note, metadata: inv.metadata, syncedAt: new Date() },
    }).returning({ id: finInvoices.id });
    const invoiceId = row.id;
    await tx.delete(finInvoiceItems).where(eq(finInvoiceItems.invoiceId, invoiceId));
    if (inv.items.length) {
      await tx.insert(finInvoiceItems).values(inv.items.map((it) => ({
        orgId: ctx.tenantId, invoiceId, code: it.code, description: it.description, category: it.category,
        quantity: numStr(it.quantity), unitPrice: numStr(it.unitPrice), discount: numStr(it.discount),
        tax: numStr(it.tax), total: numStr(it.total), metadata: it.metadata,
      })));
    }
    await tx.delete(finPayments).where(eq(finPayments.invoiceId, invoiceId));
    if (inv.payments.length) {
      await tx.insert(finPayments).values(inv.payments.map((p) => ({
        orgId: ctx.tenantId, invoiceId, providerRef: p.providerRef, method: p.method,
        paidAt: p.paidAt ? new Date(p.paidAt) : null, amount: numStr(p.amount), status: p.status, metadata: p.metadata,
      })));
    }
  });
}

export function listInvoices(ctx: CoreCtx, opts: { limit?: number } = {}) {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(finInvoices).where(eq(finInvoices.orgId, ctx.tenantId))
      .orderBy(desc(finInvoices.issuedAt)).limit(Math.min(opts.limit ?? 500, 5000)),
  );
}

export async function getInvoice(ctx: CoreCtx, id: string) {
  return withOrgCore(ctx, async (tx) => {
    const [invoice] = await tx.select().from(finInvoices)
      .where(and(eq(finInvoices.id, id), eq(finInvoices.orgId, ctx.tenantId))).limit(1);
    if (!invoice) return null;
    const items = await tx.select().from(finInvoiceItems).where(eq(finInvoiceItems.invoiceId, id));
    const payments = await tx.select().from(finPayments).where(eq(finPayments.invoiceId, id));
    return { invoice, items, payments };
  });
}

export function listPayments(ctx: CoreCtx, opts: { limit?: number } = {}) {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(finPayments).where(eq(finPayments.orgId, ctx.tenantId))
      .orderBy(desc(finPayments.paidAt)).limit(Math.min(opts.limit ?? 500, 5000)),
  );
}

export async function getSource(ctx: CoreCtx, provider: string) {
  return withOrgCore(ctx, async (tx) => {
    const [s] = await tx.select().from(finSources)
      .where(and(eq(finSources.orgId, ctx.tenantId), eq(finSources.provider, provider))).limit(1);
    return s ?? null;
  });
}

/** Returns true when the source row already has encrypted credentials stored. */
export function sourceHasCredentials(source: { secretRefs?: unknown } | null | undefined): boolean {
  const refs = source?.secretRefs as Record<string, unknown> | null | undefined;
  return !!(refs?.ciphertext && refs?.iv);
}

export async function upsertSource(
  ctx: CoreCtx, provider: string,
  data: { config: Record<string, unknown>; secretRefs: Record<string, unknown>; enabled: boolean },
) {
  await withOrgCore(ctx, (tx) =>
    tx.insert(finSources).values({ orgId: ctx.tenantId, provider, ...data, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [finSources.orgId, finSources.provider],
        set: { ...data, updatedAt: new Date() } }),
  );
}

export async function setSourceSync(ctx: CoreCtx, provider: string, s: { watermark: string; status: string }) {
  await withOrgCore(ctx, (tx) =>
    tx.update(finSources).set({ watermark: s.watermark, lastStatus: s.status, lastSyncAt: new Date(), updatedAt: new Date() })
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
    `)) as unknown as Array<{ client_doc_number: unknown; name: unknown; invoices: unknown; revenue: unknown; last: unknown }>;
    return rows.map((r) => ({
      docNumber: String(r.client_doc_number),
      name: r.name != null ? String(r.name) : null,
      invoices: Number(r.invoices),
      revenue: Number(r.revenue),
      last: r.last != null ? String(r.last) : null,
    }));
  });
}

/** Raw aggregate rows for the dashboard (revenue per month, etc.). */
export function dashboardRows(ctx: CoreCtx) {
  return withOrgCore(ctx, async (tx) => {
    const monthly = (await tx.execute(sql`
      select to_char(date_trunc('month', issued_at), 'YYYY-MM') as month,
             count(*)::int as invoices, coalesce(sum(total), 0)::float8 as revenue
      from fin_invoices where org_id = ${ctx.tenantId} and issued_at is not null
      group by 1 order by 1 desc limit 24
    `)) as unknown as Array<{ month: string; invoices: number; revenue: number }>;
    return { monthly: monthly.map((r) => ({ month: String(r.month), invoices: Number(r.invoices), revenue: Number(r.revenue) })) };
  });
}
