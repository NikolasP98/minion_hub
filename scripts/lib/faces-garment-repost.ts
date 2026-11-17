/**
 * Pure validator, strict manifest and canonical hashes for the single-ticket historical garment stock-only repost
 * (specs/122 contracts/repair.md). No service/schema imports: the owning service and the CLI share these.
 * DEVIATION (recorded in tasks.md): F3's `GarmentManifestV1`/garment engine is not built at the F3 base used here, so F1 defines
 * this closed manifest with the contract's fields and runs it over F3's cancel/create/submit primitives.
 */
import {
  ReconciliationError,
  canonicalSha256,
  cmpLedgerId,
  cmpStr,
  dArr,
  dDigest,
  dEnum,
  dLedgerId,
  dNfc,
  dNullable,
  dObj,
  dSha40,
  dUuid,
  dUtc,
  decodeQualifiedTarget,
  decodeStockEntrySource,
  parseDec,
  q4,
  type Digest,
  type UUID,
} from './faces-stock-reconciliation';
import type { QualifiedOperatorTarget } from './operator-principal';

const fail = (c: string): never => {
  throw new ReconciliationError(c);
};
export type StockValuationQualificationV1 = {
  schemaVersion: 1;
  kind: 'owner_attested_stock_currency';
  orgId: UUID;
  currency: string;
  attestedByProfileId: UUID;
  attestedAt: string;
  evidenceReference: string;
  evidenceSha256: Digest;
  keys: {
    itemId: UUID;
    warehouseId: UUID;
    latestLedgerId: string | null;
    latestLedgerRowSha256: Digest | null;
  }[];
};
type GBase = {
  schemaVersion: 1;
  kind: 'sale_stock_repost';
  target: QualifiedOperatorTarget;
  sourceCodeSha: string;
  operationKey: UUID;
  orgId: UUID;
  actorProfileId: UUID;
  ticketId: UUID;
  ticketLineId: UUID;
  productId: UUID;
  originalEntryId: UUID;
  fromItemId: UUID;
  toItemId: UUID;
  warehouseId: UUID;
  qty: string;
  sourceFingerprintSha256: Digest;
  /** Receipt id of the applied S2a mapping correction (forward only); null for a compensation. */
  mappingCorrectionId: UUID | null;
  trueUpCoverage: 'not_covered';
  valuation: StockValuationQualificationV1;
  postedAt: string;
  reason: string;
  ownerApprovalReference: string;
};
export type GarmentRepostManifestV1 =
  (GBase & { action: 'correct' }) | (GBase & { action: 'compensate'; inverseOfOperationId: UUID });
export type GarmentRepostCommand = {
  manifest: GarmentRepostManifestV1;
  approvedPlanSha256: Digest;
  previewHash: Digest;
};

const dFixed4 = (v: unknown): string =>
  typeof v === 'string' && /^\d{1,9}\.\d{4}$/.test(v) && q4(parseDec(v)) > 0n
    ? v
    : fail('fixed4_invalid');
const dMs: (v: unknown) => string = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
    ? dUtc(v)
    : fail('instant_invalid');
const dValuation = dObj<StockValuationQualificationV1>({
  schemaVersion: (v) => (v === 1 ? 1 : fail('schema_version')),
  kind: dEnum<'owner_attested_stock_currency'>('owner_attested_stock_currency'),
  orgId: dUuid,
  currency: (v) => (typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : fail('currency_invalid')),
  attestedByProfileId: dUuid,
  attestedAt: dMs,
  evidenceReference: dNfc(1, 1000),
  evidenceSha256: dDigest,
  keys: dArr(
    dObj({
      itemId: dUuid,
      warehouseId: dUuid,
      latestLedgerId: dNullable(dLedgerId),
      latestLedgerRowSha256: dNullable(dDigest),
    }),
    1000,
  ),
});
const shape = {
  schemaVersion: (v: unknown) => (v === 1 ? (1 as const) : fail('schema_version')),
  kind: dEnum<'sale_stock_repost'>('sale_stock_repost'),
  target: decodeQualifiedTarget,
  sourceCodeSha: dSha40,
  operationKey: dUuid,
  orgId: dUuid,
  actorProfileId: dUuid,
  ticketId: dUuid,
  ticketLineId: dUuid,
  productId: dUuid,
  originalEntryId: dUuid,
  fromItemId: dUuid,
  toItemId: dUuid,
  warehouseId: dUuid,
  qty: dFixed4,
  sourceFingerprintSha256: dDigest,
  mappingCorrectionId: dNullable(dUuid),
  trueUpCoverage: dEnum<'not_covered'>('not_covered'),
  valuation: dValuation,
  postedAt: dMs,
  reason: dNfc(1, 1000),
  ownerApprovalReference: dNfc(1, 1000),
};
export function decodeGarmentRepostManifestV1(value: unknown): GarmentRepostManifestV1 {
  const action = (value as { action?: unknown } | null)?.action;
  const m =
    action === 'compensate'
      ? dObj<GarmentRepostManifestV1>({
          ...shape,
          action: dEnum<'compensate'>('compensate'),
          inverseOfOperationId: dUuid,
        } as never)(value)
      : dObj<GarmentRepostManifestV1>({ ...shape, action: dEnum<'correct'>('correct') } as never)(
          value,
        );
  if (m.fromItemId === m.toItemId) return fail('items_identical');
  if (m.action === 'correct' && m.mappingCorrectionId === null)
    return fail('mapping_receipt_required');
  if (m.valuation.orgId !== m.orgId || m.valuation.attestedByProfileId !== m.actorProfileId)
    return fail('valuation_actor_mismatch');
  if (Date.parse(m.valuation.attestedAt) > Date.parse(m.postedAt))
    return fail('valuation_after_posting');
  m.valuation.keys = [...m.valuation.keys].sort((a, b) =>
    cmpStr(`${a.itemId}/${a.warehouseId}`, `${b.itemId}/${b.warehouseId}`),
  );
  const wanted = new Set([`${m.fromItemId}/${m.warehouseId}`, `${m.toItemId}/${m.warehouseId}`]);
  if (
    m.valuation.keys.length !== 2 ||
    !m.valuation.keys.every((k) => wanted.has(`${k.itemId}/${k.warehouseId}`))
  )
    return fail('valuation_keys_mismatch');
  return m;
}
export const garmentManifestSha256 = (m: GarmentRepostManifestV1): Digest => canonicalSha256(m);

/** Facts the service reads under one snapshot (or under the gate pair at apply). */
export interface GarmentFacts {
  ticket: { id: string; status: string; stockEntryId: string | null };
  line: { id: string; ticketId: string; finProductId: string | null; qty: string };
  entry: { id: string; type: string; status: string; metadata: unknown; metadataSha256?: string };
  entryLines: { itemId: string; qty: string; warehouseId: string | null }[];
  /** Item currently mapped to the product (single recipe row) or null when the recipe is not a single row. */
  currentMappedItemId: string | null;
  mappingReceiptValid: boolean;
  toBinQty: string | null;
  fingerprintSha256: Digest;
}
export type GarmentBlock =
  | 'stale_fingerprint'
  | 'source_not_pos'
  | 'not_single_line'
  | 'quantity_mismatch'
  | 'ticket_not_stamped'
  | 'ticket_void'
  | 'not_physical_m_line'
  | 'mapping_not_corrected'
  | 'mapping_receipt_missing'
  | 'negative_stock'
  | 'entry_not_submitted';
export type GarmentPlan =
  | { eligible: true; effects: { itemId: UUID; warehouseId: UUID; qtyDelta: string }[] }
  | { eligible: false; code: GarmentBlock };

const fx4 = (q: bigint) =>
  `${q < 0n ? '-' : ''}${(q < 0n ? -q : q)
    .toString()
    .padStart(5, '0')
    .replace(/(\d{4})$/, '.$1')}`;

/** Exact Q4 equality of the frozen L line and the replacement M quantity, independent of planRepost's 0.0001 tolerance. */
export function planGarmentRepost(m: GarmentRepostManifestV1, f: GarmentFacts): GarmentPlan {
  const no = (code: GarmentBlock): GarmentPlan => ({ eligible: false, code });
  if (f.fingerprintSha256 !== m.sourceFingerprintSha256) return no('stale_fingerprint');
  if (f.ticket.status === 'void') return no('ticket_void');
  if (f.ticket.stockEntryId !== m.originalEntryId) return no('ticket_not_stamped');
  if (
    f.entry.id !== m.originalEntryId ||
    f.entry.type !== 'issue' ||
    f.entry.status !== 'submitted'
  )
    return no('entry_not_submitted');
  const src = decodeStockEntrySource(f.entry.type, f.entry.metadata, f.entry.metadataSha256);
  if (src.kind !== 'pos' || src.id !== m.ticketId) return no('source_not_pos');
  if (
    f.entryLines.length !== 1 ||
    f.entryLines[0].itemId !== m.fromItemId ||
    (f.entryLines[0].warehouseId ?? m.warehouseId) !== m.warehouseId
  )
    return no('not_single_line');
  const frozen = q4(parseDec(f.entryLines[0].qty));
  if (frozen !== q4(parseDec(m.qty)) || frozen !== q4(parseDec(f.line.qty)))
    return no('quantity_mismatch');
  if (
    f.line.id !== m.ticketLineId ||
    f.line.ticketId !== m.ticketId ||
    f.line.finProductId !== m.productId
  )
    return no('not_physical_m_line');
  if (m.action === 'correct') {
    if (!f.mappingReceiptValid) return no('mapping_receipt_missing');
    if (f.currentMappedItemId !== m.toItemId) return no('mapping_not_corrected');
  }
  if (f.toBinQty === null || q4(parseDec(f.toBinQty)) < frozen) return no('negative_stock');
  return {
    eligible: true,
    effects: [
      { itemId: m.fromItemId, warehouseId: m.warehouseId, qtyDelta: fx4(frozen) },
      { itemId: m.toItemId, warehouseId: m.warehouseId, qtyDelta: fx4(-frozen) },
    ],
  };
}
export const sortLedgerRefs = <T extends { id: string }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => cmpLedgerId(a.id, b.id));

/** A compensation must exactly reverse the forward manifest: swapped items, same qty, warehouse, ticket line. */
export function isInverseOf(
  f: GarmentRepostManifestV1 | undefined,
  m: GarmentRepostManifestV1,
): boolean {
  return (
    !!f &&
    m.toItemId === f.fromItemId &&
    m.fromItemId === f.toItemId &&
    m.qty === f.qty &&
    m.warehouseId === f.warehouseId &&
    m.ticketLineId === f.ticketLineId
  );
}
