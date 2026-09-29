import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listEntries, listItems, listWarehouses } from '$server/services/stock.service';
import { getParty } from '$server/services/party.service';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';
import { listEntryLineSummaries } from '$server/services/stock-entries-read.service';
import { listTicketRefs } from '$server/services/pos.service';
import { getInvoiceLabelsByIds } from '$server/services/finance.service';
import { listPurchaseRefs } from '$server/services/purchases.service';
import { countAttachmentsByObjects } from '$server/services/attachments.service';
import { entryDocument, type EntryDocumentKind } from '$lib/components/stock/entry-document';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('stock:entries');

  const partyId = url.searchParams.get('party') ?? undefined;
  const [entries, items, warehouses] = await Promise.all([
    listEntries(ctx, { partyId }),
    listItems(ctx, { includeArchived: true }),
    listWarehouses(ctx),
  ]);
  // Light id→label map so an expanded entry can name its line items without a
  // per-line lookup (the org's item catalog is small).
  const itemsById: Record<string, { code: string; name: string }> = {};
  for (const it of items) itemsById[it.id] = { code: it.code, name: it.name };
  const warehousesById: Record<string, string> = {};
  for (const w of warehouses) warehousesById[w.id] = w.name;

  // Small org-scale roster — resolving each distinct party by id is simpler
  // than a new joined query, and entry counts here are in the hundreds, not
  // thousands (ponytail: revisit with a batched lookup if that changes).
  const partyIds = [...new Set(entries.map((e) => e.partyId).filter((x): x is string => !!x))];
  const parties = await Promise.all(partyIds.map((id) => getParty(ctx, id)));
  const partyById = new Map(parties.filter((p) => p != null).map((p) => [p.id, p]));
  const customProperties = await loadCustomPropertyBundle(
    locals,
    ctx,
    'stock.entries',
    entries.map((entry) => entry.id),
  );

  // Provenance links (Document column): derive kind/id/href purely from
  // metadata, then batch-resolve a human label per kind (one query per kind,
  // not per row).
  const docs = entries.map((e) => entryDocument(e.type, e.metadata));
  const ticketIds = docs.filter((d) => d?.kind === 'ticket').map((d) => d!.id);
  const invoiceIds = docs.filter((d) => d?.kind === 'invoice').map((d) => d!.id);
  const purchaseIds = docs.filter((d) => d?.kind === 'purchase').map((d) => d!.id);
  const [ticketRefs, invoiceLabels, purchaseRefs, lineSummaries, attachmentCounts] =
    await Promise.all([
      listTicketRefs(ctx, ticketIds),
      getInvoiceLabelsByIds(ctx, invoiceIds),
      listPurchaseRefs(ctx, purchaseIds),
      listEntryLineSummaries(
        ctx,
        entries.map((e) => e.id),
      ),
      countAttachmentsByObjects(
        ctx,
        'stk_entry',
        entries.map((e) => e.id),
      ),
    ]);
  const ticketById = new Map(ticketRefs.map((t) => [t.id, t]));
  const purchaseById = new Map(purchaseRefs.map((p) => [p.id, p]));

  function resolveDocument(doc: ReturnType<typeof entryDocument>) {
    if (!doc) return null;
    const label =
      doc.kind === 'ticket'
        ? ticketById.get(doc.id)?.humanId
          ? `#${ticketById.get(doc.id)!.humanId}`
          : doc.labelFallback
        : doc.kind === 'invoice'
          ? (invoiceLabels.get(doc.id) ?? doc.labelFallback)
          : doc.kind === 'purchase'
            ? (purchaseById.get(doc.id)?.label ?? doc.labelFallback)
            : doc.labelFallback;
    return { kind: doc.kind as EntryDocumentKind, id: doc.id, href: doc.href, label };
  }

  return {
    customProperties,
    entries: entries.map((e) => {
      const summary = lineSummaries.get(e.id);
      return {
        ...e,
        partyName: e.partyId ? (partyById.get(e.partyId)?.name ?? e.partyId) : null,
        document: resolveDocument(entryDocument(e.type, e.metadata)),
        lineCount: summary?.lineCount ?? 0,
        firstFromWarehouseId: summary?.firstFromWarehouseId ?? null,
        firstToWarehouseId: summary?.firstToWarehouseId ?? null,
        attachmentCount: attachmentCounts.get(e.id) ?? 0,
      };
    }),
    partyFilter: partyId ?? null,
    itemsById,
    warehousesById,
    // Gates the Transfer action in the add-menu: one warehouse = nothing to
    // transfer to. Count only, the roster itself isn't needed here.
    warehouseCount: warehouses.length,
  };
};
