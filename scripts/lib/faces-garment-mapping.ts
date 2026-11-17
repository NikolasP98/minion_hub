/**
 * Pure strict types, decoders, canonical hashes and plan for the Faja M mapping correction
 * (specs/122 contracts/mapping-envelope.md, mapping-correction.md, unchanged-facts.md).
 * No runtime application alias, service or schema import and no CLI side effect: the owning service
 * (src/server/services/faces-garment-mapping.service.ts) re-imports these validators.
 */
import {
  ReconciliationError,
  UUID_RE,
  canonicalSha256,
  cmpLedgerId,
  cmpStr,
  dArr,
  dBool,
  dDigest,
  dEnum,
  dLedgerId,
  dNfc,
  dNullable,
  dObj,
  dSha40,
  dUuid,
  decodeQualifiedTarget,
  parseDec,
  q4,
  fixed4,
  assertLedgerId,
  type Digest,
  type UUID,
} from './faces-stock-reconciliation';
import type { QualifiedOperatorTarget } from './operator-principal';

const fail = (code: string): never => {
  throw new ReconciliationError(code);
};

export type RowRef = {
  table: 'fin_products' | 'stk_items' | 'stk_consumption' | 'stk_item_components';
  key: [UUID];
  rowSha256: Digest;
};
export type MappingState = {
  productId: UUID;
  productRowSha256: Digest;
  directBridgeItemId: UUID | null;
  recipe: {
    rowId: UUID;
    itemId: UUID;
    qtyPerUnit: string;
    note: string | null;
    rowSha256: Digest;
  }[];
  ruleRows: RowRef[];
  preservedLProductId: UUID;
  preservedLMappingSha256: Digest;
};
export type CensusRow = {
  sourceType: 'pos_ticket' | 'booking' | 'invoice' | 'service';
  sourceId: UUID;
  entryId: UUID | null;
  accrualId: UUID | null;
  state: 'draft' | 'open' | 'submitted';
  rowSha256: Digest;
};
export type MappingCensus = {
  complete: true;
  pendingDrafts: CensusRow[];
  openAccruals: CensusRow[];
  submittedIssues: CensusRow[];
  ledgerHighWater: string | null;
  stateSha256: Digest;
};
export type MappingIntent = {
  rowId: UUID;
  productId: UUID;
  itemId: UUID;
  qtyPerUnit: string;
  stockUom: string;
  note: string | null;
};
type Base = {
  schemaVersion: 1;
  kind: 'product_mapping';
  target: QualifiedOperatorTarget;
  sourceCodeSha: string;
  operationKey: UUID;
  orgId: UUID;
  actorProfileId: UUID;
  before: MappingState;
  intended: MappingIntent;
  census: MappingCensus;
  unchangedStockPaymentSha256: Digest;
  rollout: {
    protocolVersion: 1;
    candidateSha: string;
    evidenceReference: string;
    evidenceSha256: Digest;
  };
  reason: string;
  ownerApprovalReference: string;
};
export type MappingManifestV1 =
  (Base & { action: 'correct' }) | (Base & { action: 'compensate'; inverseOfOperationId: UUID });
export type MappingCommand = {
  manifest: MappingManifestV1;
  approvedPlanSha256: Digest;
  previewHash: Digest;
};
export type MappingStatusInput = {
  target: QualifiedOperatorTarget;
  orgId: UUID;
  actorProfileId: UUID;
  operationKey: UUID;
  action: 'correct' | 'compensate';
  manifestSha256: Digest;
  expectedPayloadHash: Digest;
  manifest: MappingManifestV1;
};

const MAX_ROWS = 1000;
const MAX_BYTES = 262_144;
const dFixed4Pos = (v: unknown): string => {
  if (typeof v !== 'string' || !/^\d{1,9}\.\d{4}$/.test(v) || q4(parseDec(v)) <= 0n)
    return fail('fixed4_invalid');
  return v;
};
const dText = dNfc(1, 1000);
const dRowRef: (v: unknown) => RowRef = dObj<RowRef>({
  table: dEnum('fin_products', 'stk_items', 'stk_consumption', 'stk_item_components'),
  key: (v) =>
    Array.isArray(v) && v.length === 1 && UUID_RE.test(String(v[0]))
      ? ([String(v[0])] as [UUID])
      : fail('key_invalid'),
  rowSha256: dDigest,
});
const dCensusRow = dObj<CensusRow>({
  sourceType: dEnum('pos_ticket', 'booking', 'invoice', 'service'),
  sourceId: dUuid,
  entryId: dNullable(dUuid),
  accrualId: dNullable(dUuid),
  state: dEnum('draft', 'open', 'submitted'),
  rowSha256: dDigest,
});
const dCensus = dObj<MappingCensus>({
  complete: (v) => (v === true ? true : fail('census_incomplete')),
  pendingDrafts: dArr(dCensusRow, MAX_ROWS),
  openAccruals: dArr(dCensusRow, MAX_ROWS),
  submittedIssues: dArr(dCensusRow, MAX_ROWS),
  ledgerHighWater: dNullable(dLedgerId),
  stateSha256: dDigest,
});
const dState = dObj<MappingState>({
  productId: dUuid,
  productRowSha256: dDigest,
  directBridgeItemId: dNullable(dUuid),
  recipe: dArr(
    dObj({
      rowId: dUuid,
      itemId: dUuid,
      qtyPerUnit: (v) => (typeof v === 'string' ? (parseDec(v), v) : fail('numeric_invalid')),
      note: dNullable(dNfc(0, 1000)),
      rowSha256: dDigest,
    }),
    MAX_ROWS,
  ),
  ruleRows: dArr(dRowRef, MAX_ROWS),
  preservedLProductId: dUuid,
  preservedLMappingSha256: dDigest,
});
const dIntent = dObj<MappingIntent>({
  rowId: dUuid,
  productId: dUuid,
  itemId: dUuid,
  qtyPerUnit: dFixed4Pos,
  stockUom: dNfc(1, 80),
  note: dNullable(dNfc(0, 1000)),
});
const baseShape = {
  schemaVersion: (v: unknown) => (v === 1 ? (1 as const) : fail('schema_version')),
  kind: dEnum<'product_mapping'>('product_mapping'),
  target: decodeQualifiedTarget,
  sourceCodeSha: dSha40,
  operationKey: dUuid,
  orgId: dUuid,
  actorProfileId: dUuid,
  before: dState,
  intended: dIntent,
  census: dCensus,
  unchangedStockPaymentSha256: dDigest,
  rollout: dObj({
    protocolVersion: (v: unknown) => (v === 1 ? (1 as const) : fail('protocol_version')),
    candidateSha: dSha40,
    evidenceReference: dText,
    evidenceSha256: dDigest,
  }),
  reason: dText,
  ownerApprovalReference: dText,
};

const sortRows = <T>(rows: T[], key: (r: T) => string): T[] =>
  [...rows].sort((a, b) => cmpStr(key(a), key(b)));
const distinct = (xs: string[]) => new Set(xs).size === xs.length;
const censusKey = (r: CensusRow) =>
  `${r.sourceType}/${r.sourceId}/${r.entryId ?? ''}/${r.accrualId ?? ''}`;

export function decodeMappingManifestV1(value: unknown): MappingManifestV1 {
  if (Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') > MAX_BYTES)
    return fail('manifest_too_large');
  const action = (value as { action?: unknown } | null)?.action;
  const m =
    action === 'compensate'
      ? dObj<MappingManifestV1 & { action: 'compensate' }>({
          ...baseShape,
          action: dEnum<'compensate'>('compensate'),
          inverseOfOperationId: dUuid,
        } as never)(value)
      : dObj<MappingManifestV1 & { action: 'correct' }>({
          ...baseShape,
          action: dEnum<'correct'>('correct'),
        } as never)(value);
  // Canonical ordering and distinctness: arrays are complete sets, never excerpts.
  m.before.recipe = sortRows(m.before.recipe, (r) => `${r.itemId}/${r.rowId}`);
  m.before.ruleRows = sortRows(m.before.ruleRows, (r) => `${r.table}/${r.key[0]}`);
  for (const k of ['pendingDrafts', 'openAccruals', 'submittedIssues'] as const)
    m.census[k] = sortRows(m.census[k], censusKey);
  if (!distinct(m.before.ruleRows.map((r) => `${r.table}/${r.key[0]}`)))
    return fail('rule_rows_not_distinct');
  if (!distinct(m.before.recipe.map((r) => r.rowId))) return fail('recipe_not_distinct');
  if (m.intended.productId !== m.before.productId) return fail('intent_product_mismatch');
  if (m.rollout.candidateSha !== m.sourceCodeSha) return fail('rollout_candidate_mismatch');
  if (m.census.ledgerHighWater !== null) assertLedgerId(m.census.ledgerHighWater);
  return m;
}

/** F3-style recursively sorted-key canonical digest of every normalized manifest field. */
export const mappingManifestSha256 = (m: MappingManifestV1): Digest => canonicalSha256(m);

export function previewHashOf(parts: {
  manifestSha256: Digest;
  beforeStateSha256: Digest;
  censusStateSha256: Digest;
  policyStateSha256: Digest;
}): Digest {
  return canonicalSha256({ schemaVersion: 1, domain: 'product_mapping', ...parts });
}
export function payloadHashOf(parts: {
  orgId: UUID;
  actorProfileId: UUID;
  manifestSha256: Digest;
  previewHash: Digest;
}): Digest {
  return canonicalSha256({ schemaVersion: 1, domain: 'product_mapping', ...parts });
}

export function decodeMappingCommand(value: unknown): MappingCommand {
  const c = dObj<{ manifest: unknown; approvedPlanSha256: Digest; previewHash: Digest }>({
    manifest: (v) => v,
    approvedPlanSha256: dDigest,
    previewHash: dDigest,
  })(value);
  const manifest = decodeMappingManifestV1(c.manifest);
  if (c.approvedPlanSha256 !== mappingManifestSha256(manifest))
    return fail('approved_plan_mismatch');
  return { manifest, approvedPlanSha256: c.approvedPlanSha256, previewHash: c.previewHash };
}

export function decodeMappingStatusInput(value: unknown): MappingStatusInput {
  const s = dObj<Omit<MappingStatusInput, 'manifest'> & { manifest: unknown }>({
    target: decodeQualifiedTarget,
    orgId: dUuid,
    actorProfileId: dUuid,
    operationKey: dUuid,
    action: dEnum('correct', 'compensate'),
    manifestSha256: dDigest,
    expectedPayloadHash: dDigest,
    manifest: (v) => v,
  })(value);
  const manifest = decodeMappingManifestV1(s.manifest);
  if (
    manifest.action !== s.action ||
    manifest.operationKey !== s.operationKey ||
    manifest.orgId !== s.orgId ||
    manifest.target.databaseIdentity !== s.target.databaseIdentity ||
    manifest.target.authProject !== s.target.authProject ||
    mappingManifestSha256(manifest) !== s.manifestSha256
  )
    return fail('status_input_conflict');
  return { ...s, manifest };
}

// ---------------------------------------------------------------------------------------------
// Unit semantics (review F1-R6-codebase-details-01): a recipe qtyPerUnit is in the item's CONSUMPTION unit;
// the issued STOCK quantity is qtyPerUnit / unitsPerStockUom (identity when the item has no conversion).
// ---------------------------------------------------------------------------------------------
export type ItemUom = {
  uom: string;
  consumptionUom: string | null;
  unitsPerStockUom: string | null;
};
/** Exact Q4 stock quantity one product unit issues for `qtyPerUnit` of an item with this conversion; null when unsupported. */
export function issuedStockQtyPerUnit(qtyPerUnit: string, item: ItemUom): bigint | null {
  const qty = parseDec(qtyPerUnit);
  const factor = item.unitsPerStockUom === null ? null : parseDec(item.unitsPerStockUom);
  if (factor !== null && factor.c <= 0n) return null;
  if (factor === null) return q4(qty);
  // q4(qty/factor) = floor(10000*a*10^s2/(b*10^s1) + 1/2) with qty=a/10^s1, factor=b/10^s2, b>0.
  const num = 2n * qty.c * 10n ** BigInt(factor.s) * 10_000n + factor.c * 10n ** BigInt(qty.s);
  const den = 2n * factor.c * 10n ** BigInt(qty.s);
  const q = num / den;
  return num % den !== 0n && num < 0n ? q - 1n : q;
}
const ONE_Q4 = 10_000n;

export type MappingFacts = {
  /** Fresh current item rows for the old (L) and new (M) items and the stock UOM label they must share. */
  fromItem: ItemUom & { id: UUID };
  toItem: ItemUom & { id: UUID };
  /** stk_item_components rows whose parent is the from or to item: the sale path issues components instead of the item. */
  componentRows: number;
  /** The target item's is_stock_item flag. */
  toIsStockItem: boolean;
  /** Operator-attested deployed SHA (env FACES_DEPLOYED_SHA); the rollout is verified only when it equals rollout.candidateSha. */
  deployedSha: string | null;
};
export type PlanOutcome =
  | { eligible: true }
  | {
      eligible: false;
      code:
        | 'cutover_pending_sources'
        | 'unsupported_scope'
        | 'rollout_unverified'
        | 'incomplete_evidence';
    };

/**
 * Pure admission of one manifest against freshly read item facts. Order mirrors the contract: scope first, then
 * unit semantics, then cutover census. `correct` swaps the single approved L recipe for the M item;
 * `compensate` is the reverse with its own fresh manifest.
 */
export function planMapping(m: MappingManifestV1, facts: MappingFacts): PlanOutcome {
  const { before, intended } = m;
  if (before.directBridgeItemId !== null) return { eligible: false, code: 'unsupported_scope' };
  if (before.recipe.length !== 1) return { eligible: false, code: 'unsupported_scope' };
  const old = before.recipe[0];
  if (intended.note !== old.note) return { eligible: false, code: 'unsupported_scope' }; // the approved note is preserved
  if (old.itemId === intended.itemId || intended.rowId === old.rowId)
    return { eligible: false, code: 'unsupported_scope' };
  if (facts.fromItem.id !== old.itemId || facts.toItem.id !== intended.itemId)
    return { eligible: false, code: 'incomplete_evidence' };
  if (facts.componentRows > 0 || !facts.toIsStockItem)
    return { eligible: false, code: 'unsupported_scope' };
  if (facts.deployedSha === null || facts.deployedSha !== m.rollout.candidateSha)
    return { eligible: false, code: 'rollout_unverified' };
  if (intended.stockUom !== facts.toItem.uom || facts.toItem.uom !== facts.fromItem.uom)
    return { eligible: false, code: 'unsupported_scope' };
  // One product unit must issue exactly one M stock unit, and the L baseline must have meant one stock unit too.
  if (issuedStockQtyPerUnit(intended.qtyPerUnit, facts.toItem) !== ONE_Q4)
    return { eligible: false, code: 'unsupported_scope' };
  if (issuedStockQtyPerUnit(old.qtyPerUnit, facts.fromItem) !== ONE_Q4)
    return { eligible: false, code: 'unsupported_scope' };
  if (m.census.pendingDrafts.length > 0 || m.census.openAccruals.length > 0)
    return { eligible: false, code: 'cutover_pending_sources' };
  return { eligible: true };
}

// ---------------------------------------------------------------------------------------------
// Unchanged stock/payment facts digest (unchanged-facts.md "Hash preimage and comparison")
// ---------------------------------------------------------------------------------------------
export const UNCHANGED_TABLES = [
  'fin_products',
  'stk_items',
  'stk_bins',
  'stk_ledger',
  'stk_entries',
  'stk_entry_lines',
  'pos_tickets',
  'pos_ticket_lines',
  'pos_payments',
  'sched_bookings',
  'stk_accruals',
  'fin_invoices',
  'fin_invoice_items',
  'fin_payments',
  'pos_client_ledger',
] as const;
export type UnchangedTable = (typeof UNCHANGED_TABLES)[number];
export type UnchangedFacts = {
  orgId: UUID;
  scope: {
    productIds: UUID[];
    itemIds: UUID[];
    binKeys: [UUID, UUID][];
    entryIds: UUID[];
    ticketIds: UUID[];
    bookingIds: UUID[];
    invoiceIds: UUID[];
  };
  tables: { table: UnchangedTable; rows: { key: string[]; rowSha256: Digest }[] }[];
};
const keyCmp = (table: UnchangedTable) => (a: { key: string[] }, b: { key: string[] }) =>
  table === 'stk_ledger'
    ? cmpLedgerId(a.key[0], b.key[0])
    : cmpStr(a.key.join('/'), b.key.join('/'));

/** Canonicalize (sets sorted, rows deduplicated by table+key, ledger keys numeric) and hash. A contradiction throws. */
export function unchangedFactsDigest(facts: UnchangedFacts): Digest {
  const sortedUuids = (xs: string[]) => [...new Set(xs)].sort(cmpStr);
  const tables = UNCHANGED_TABLES.map((table) => {
    const seen = new Map<string, { key: string[]; rowSha256: Digest }>();
    for (const row of facts.tables.filter((t) => t.table === table).flatMap((t) => t.rows)) {
      if (table === 'stk_ledger') assertLedgerId(row.key[0]);
      const k = row.key.join('/');
      const prev = seen.get(k);
      if (prev && prev.rowSha256 !== row.rowSha256) return fail('unchanged_row_contradiction');
      seen.set(k, row);
    }
    return { table, rows: [...seen.values()].sort(keyCmp(table)) };
  });
  return canonicalSha256({
    schemaVersion: 1,
    orgId: facts.orgId,
    scope: {
      productIds: sortedUuids(facts.scope.productIds),
      itemIds: sortedUuids(facts.scope.itemIds),
      binKeys: [...new Map(facts.scope.binKeys.map((k) => [k.join('/'), k])).values()].sort(
        (a, b) => cmpStr(a.join('/'), b.join('/')),
      ),
      entryIds: sortedUuids(facts.scope.entryIds),
      ticketIds: sortedUuids(facts.scope.ticketIds),
      bookingIds: sortedUuids(facts.scope.bookingIds),
      invoiceIds: sortedUuids(facts.scope.invoiceIds),
    },
    tables,
  });
}

/** Census state hash: the rows only, no observation times. */
export function censusStateSha256(c: Omit<MappingCensus, 'stateSha256' | 'complete'>): Digest {
  return canonicalSha256({
    schemaVersion: 1,
    pendingDrafts: sortRows(c.pendingDrafts, censusKey),
    openAccruals: sortRows(c.openAccruals, censusKey),
    submittedIssues: sortRows(c.submittedIssues, censusKey),
    ledgerHighWater: c.ledgerHighWater,
  });
}
export const mappingStateSha256 = (s: MappingState): Digest => canonicalSha256(s);
void dBool;
void fixed4;
