/**
 * Pure derivation of a stock entry's provenance link from its `metadata` — no
 * DB. Mirrors the shapes `stock.service.ts` writes: `createSourcedIssue`
 * (source:'pos'), `createIssueFromInvoice` (source:'invoice'),
 * `createServiceIssue`/`realizeAccruals` (source:'service'|'booking'|…).
 * Dependency-free so it's unit-testable without mounting a component
 * (mirrors stock-ui.ts). The server batch-resolves the human label (ticket
 * humanId / invoice providerRef) — this only decides WHERE to link and a
 * fallback label for when that lookup comes back empty. Receipts link via
 * `metadata.purchaseId` (set by the entries/new receipt form's provider-invoice
 * picker — spec 2026-09-28 Bundle D) — a receipt with no purchase picked
 * still returns null, its supplier invoice living only in the attachments.
 */

export type EntryDocumentKind = 'ticket' | 'invoice' | 'booking' | 'purchase';

export interface EntryDocumentRef {
  kind: EntryDocumentKind;
  id: string;
  href: string;
  /** Used when the batched label lookup finds nothing (deleted/unknown record). */
  labelFallback: string;
}

const short = (id: string) => id.slice(0, 8);

/**
 * `type` is the entry's own type (issue/receipt/transfer/adjustment). Every
 * known provenance source today is written only onto `issue` entries — a
 * stray `source` key surviving on any other type is defensively ignored
 * rather than rendering a link nothing actually created.
 */
export function entryDocument(type: string, metadata: unknown): EntryDocumentRef | null {
  const md = (metadata ?? {}) as Record<string, unknown>;

  if (type === 'receipt') {
    const purchaseId = typeof md.purchaseId === 'string' ? md.purchaseId : null;
    if (!purchaseId) return null;
    const providerRef = typeof md.providerRef === 'string' ? md.providerRef : null;
    return {
      kind: 'purchase',
      id: purchaseId,
      href: `/finances/purchases/${purchaseId}`,
      labelFallback: providerRef ?? short(purchaseId),
    };
  }

  if (type !== 'issue') return null;
  const source = typeof md.source === 'string' ? md.source : null;

  if (source === 'pos') {
    const id =
      typeof md.ticketId === 'string'
        ? md.ticketId
        : typeof md.sourceId === 'string'
          ? md.sourceId
          : null;
    if (!id) return null;
    return { kind: 'ticket', id, href: `/pos/tickets/${id}`, labelFallback: `#${short(id)}` };
  }

  if (source === 'invoice') {
    const id = typeof md.invoiceId === 'string' ? md.invoiceId : null;
    if (!id) return null;
    const providerRef = typeof md.providerRef === 'string' ? md.providerRef : null;
    return {
      kind: 'invoice',
      id,
      href: `/finances/invoices/${id}`,
      labelFallback: providerRef ?? short(id),
    };
  }

  if (source === 'booking') {
    const id = typeof md.sourceId === 'string' ? md.sourceId : null;
    if (!id) return null;
    return {
      kind: 'booking',
      id,
      href: `/scheduling/bookings?booking=${id}`,
      labelFallback: short(id),
    };
  }

  // 'service' (plain service issues, no bookable source) and any other/unknown
  // source: nothing recorded to link to.
  return null;
}

/**
 * "A → B" for a transfer line, or whichever single side a receipt/issue used.
 * `namesById` is the caller's already-loaded warehouse roster (org scale is
 * small — no per-row lookup).
 */
export function warehouseSpan(
  fromId: string | null | undefined,
  toId: string | null | undefined,
  namesById: Record<string, string>,
): string {
  const name = (id: string | null | undefined) => (id ? (namesById[id] ?? short(id)) : null);
  const from = name(fromId);
  const to = name(toId);
  if (from && to) return `${from} → ${to}`;
  return from ?? to ?? '—';
}
