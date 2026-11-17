/**
 * FACES receipt valuation (spec 123) — pure diagnostic wire + replay oracle (T003).
 * Imports only node:crypto and the import-free decimal.ts. No DB, env, CLI, alias, or US3 module.
 * Source stock math (computeLegValue/applyLedgerDelta/round4) is injected as `StockReplayMath` after
 * the qualified loader admits the real stockLogic namespace.
 */
import { createHash } from 'node:crypto';
import { decimalToMinor, divideDecimalToMinor, minorToDecimal } from '../../src/lib/money/decimal';

// ───────────────────────────── types (contracts/diagnostic-wire.md) ─────────────────────────────
export type UUID = string;
export type Digest = string;
export type CodeSha = string;
export type Raw = string;
export type Engine = string;
export type Seq = string;
export type UTC = string;
export type Rational = { numerator: string; denominator: string };
export type QualifiedOperatorTarget = Readonly<{
  databaseIdentity: string;
  authProject: string;
  authUrl: string;
}>;
export type UnitSource = {
  entryId: UUID;
  lineId: UUID;
  headerRowSha256: Digest;
  lineRowSha256: Digest;
  sourceKind: 'receipt' | 'pos_ticket' | 'booking';
  sourceId: UUID;
  writer:
    | 'receipt_stock_quantity'
    | 'pos_normalized_stock_quantity'
    | 'booking_normalized_stock_quantity';
  writerCodeSha: CodeSha;
  writerEvidenceSha256: Digest;
};
export type UnitQualification = {
  schemaVersion: 1;
  receiptEntryId: UUID;
  receiptLineId: UUID;
  itemId: UUID;
  itemRowSha256: Digest;
  documentSha256: Digest;
  documentLineReference: string;
  stockUom: string;
  documentUom: string;
  documentQuantity: string;
  stockUnitsPerDocumentUnit: string;
  historicalStockUomEvidenceSha256: Digest;
  conversionEvidenceSha256: Digest;
  verifiedByProfileId: UUID;
  verifiedAt: UTC;
  sources: UnitSource[];
};
export type AllocationEvidence = {
  policy: 'single_line' | 'owner_verified_allocation';
  net: string;
  tax: string;
  freight: string;
  discount: string;
  inventoryCost: string;
  evidenceSha256: Digest;
};
export type FxEvidence = {
  sourceCurrency: string;
  valuationCurrency: string;
  rate: string;
  effectiveAt: UTC;
  sourceInventoryCost: string;
  totalValuation: string;
  conversionResidual: string;
  historicalValuationCurrencyEvidenceSha256: Digest;
  evidenceSha256: Digest;
};
export type DocumentFacts = {
  reference: string;
  documentLineReference: string;
  sha256: Digest;
  purchaseId: UUID | null;
  providerRef: string | null;
  quantity: string;
  uom: string;
  allocation: AllocationEvidence;
  fx: FxEvidence;
};
export type DocumentInput =
  | { state: 'absent' }
  | {
      state: 'unverified';
      reference: string | null;
      sha256: Digest | null;
      facts: DocumentFacts | null;
    }
  | {
      state: 'owner_attested';
      facts: DocumentFacts;
      verifiedByProfileId: UUID;
      verifiedAt: UTC;
      approvalReference: string;
    };
export type DocumentBasis = {
  policy: 'verified_document_total';
  reference: string;
  sha256: Digest;
  valuationCurrency: string;
  stockQty: string;
  totalValuation: string;
  fxEvidenceSha256: Digest;
  taxFreightAllocationSha256: Digest;
  roundingResidual: string;
  residualAccepted: true;
  unitQualification: UnitQualification;
};
export type ReportedHypothesis = {
  stockQty: string;
  stockUom: string;
  valuationCurrency: string;
  totalValuation: string;
};
export type DiagnosticEvidenceManifestV1 = {
  schemaVersion: 1;
  kind: 'receipt_diagnostic';
  target: QualifiedOperatorTarget;
  sourceCodeSha: CodeSha;
  orgId: UUID;
  actorProfileId: UUID;
  receiptEntryId: UUID;
  receiptLineId: UUID;
  approvalReference: string;
  document: DocumentInput;
  unitQualification: UnitQualification | null;
  hypothesis: ReportedHypothesis | null;
  residualAccepted: boolean;
};

export type ScalarEvidence = { state: 'missing' | 'null' | 'value'; value: string | null };
export type EntryHeader = {
  id: UUID;
  humanId: string | null;
  type: string;
  status: string;
  postedAt: UTC | null;
  rowSha256: Digest;
  purchaseId: ScalarEvidence;
  providerRef: ScalarEvidence;
  currency: ScalarEvidence;
  fxRate: ScalarEvidence;
  fxUpdatedAt: ScalarEvidence;
};
export type EntryLine = {
  id: UUID;
  entryId: UUID;
  itemId: UUID;
  qty: Raw;
  uom: string | null;
  rate: Raw | null;
  fromWarehouseId: UUID | null;
  toWarehouseId: UUID | null;
  lineNo: number;
  rowSha256: Digest;
};
export type Movement = {
  id: Seq;
  entryId: UUID;
  itemId: UUID;
  warehouseId: UUID;
  postedAt: UTC;
  qtyDelta: Raw;
  valueDelta: Raw;
  qtyAfter: Raw;
  valuationRate: Raw;
  rowSha256: Digest;
  header: EntryHeader;
  lines: EntryLine[];
  source: { kind: 'receipt' | 'pos_ticket' | 'booking' | 'invoice' | 'unknown'; id: UUID | null };
  reversalOfLedgerId: Seq | null;
};
export type Consumer =
  | {
      kind: 'pos_ticket';
      id: UUID;
      rowSha256: Digest;
      entryId: UUID;
      financialFiscalSha256: Digest;
    }
  | {
      kind: 'stock_accrual';
      id: UUID;
      rowSha256: Digest;
      entryId: UUID;
      sourceType: string;
      sourceId: UUID;
      itemId: UUID;
      realizedQty: Raw | null;
      realizedValue: Raw | null;
      realizedAt: UTC | null;
      status: string;
    };
export type Opening =
  | {
      state: 'unknown';
      priorLedgerId: null;
      priorRowSha256: null;
      qty: null;
      rate: null;
      valueEngine: null;
    }
  | {
      state: 'empty_verified';
      priorLedgerId: null;
      priorRowSha256: null;
      qty: '0';
      rate: '0';
      valueEngine: '0';
    }
  | {
      state: 'verified';
      priorLedgerId: Seq;
      priorRowSha256: Digest;
      qty: Raw;
      rate: Raw;
      valueEngine: Engine;
    };
export type SourceEvidence = {
  receipt: EntryHeader | null;
  line: EntryLine | null;
  item: {
    id: UUID;
    rowSha256: Digest;
    stockUom: string;
    consumptionUom: string | null;
    unitsPerStockUom: Raw | null;
  } | null;
  warehouse: { id: UUID; rowSha256: Digest } | null;
  bin: { rowSha256: Digest; qty: Raw; rate: Raw } | null;
  opening: Opening;
  context: Movement[];
  affected: Movement[];
  boundary: Movement | null;
  consumers: Consumer[];
};
export type Coverage = {
  readsComplete: boolean;
  contextComplete: boolean;
  affectedComplete: boolean;
  consumersComplete: boolean;
  baselineComplete: boolean;
  hypotheticalComplete: boolean;
  contextCount: number | null;
  affectedCount: number | null;
  consumerCount: number | null;
  contextReadCount: number;
  affectedReadCount: number;
  consumerReadCount: number;
  lastReadLedgerId: Seq | null;
  latestSameKeyLedgerId: Seq | null;
  maxObservedLedgerId: Seq | null;
};
export const CHECK_FIELDS = [
  'document_identity',
  'quantity',
  'stock_unit',
  'currency',
  'fx',
  'allocation',
  'opening',
  'baseline',
  'quantity_preservation',
  'conservation',
  'latest_bin',
  'source_consumers',
] as const;
export type CheckField = (typeof CHECK_FIELDS)[number];
export type Check = {
  field: CheckField;
  state: 'matched' | 'mismatched' | 'unknown';
  expected: string | null;
  actual: string | null;
  evidenceSha256: Digest[];
};
export const CODES = [
  'document_absent',
  'document_unverified',
  'document_mismatched',
  'hypothesis_disagrees_with_document',
  'cost_basis_missing',
  'unit_unverified',
  'unit_mismatched',
  'fx_unverified',
  'fx_mismatched',
  'allocation_unverified',
  'allocation_mismatched',
  'residual_unaccepted',
  'source_unavailable',
  'schema_mismatch',
  'read_failed',
  'timeout',
  'resource_limit',
  'baseline_mismatch',
  'quantity_mismatch',
  'latest_bin_mismatch',
  'conservation_failed',
  'consumer_unresolved',
  'consumer_mismatch',
  'unsupported_source',
  'unsupported_multiline',
  'unsupported_multikey',
  'unsupported_second_receipt',
  'unsupported_transfer',
  'unsupported_reversal',
  'unsupported_adjustment',
  'unsupported_zero_quantity',
  'unsupported_negative_value',
  'unsupported_issue_cap',
  'outside_numeric_oracle',
] as const;
export type Code = (typeof CODES)[number];
const STAGES = ['input', 'read', 'document', 'baseline', 'support', 'replay', 'output'] as const;
export type DiagnosticError = {
  code: Code;
  stage: (typeof STAGES)[number];
  entryId: UUID | null;
  ledgerId: Seq | null;
  consumerId: UUID | null;
  limit: number | null;
};
export type DocumentAssessment = {
  state: 'absent' | 'unverified' | 'verified' | 'mismatched';
  documentSha256: Digest | null;
  unitState: 'unknown' | 'unverified' | 'verified' | 'mismatched';
  verifiedBasis: DocumentBasis | null;
  checks: Check[];
};
export type OracleCheck = {
  expected: Rational;
  engine: Engine;
  absoluteDifference: Rational;
  tolerance: '0.00000001' | '0.000000001';
  passed: boolean;
};
export type ReplayRow = {
  ledgerId: Seq;
  entryId: UUID;
  qtyDelta: Raw;
  original: { valueDelta: Raw; qtyAfter: Raw; valuationRate: Raw };
  intended: { valueDelta: Engine; qtyAfter: Engine; valuationRate: Engine };
  oracle: { valueDelta: OracleCheck; qtyAfter: OracleCheck; valuationRate: OracleCheck };
};
export type ConsumerEffect = {
  kind: 'pos_ticket' | 'stock_accrual';
  id: UUID;
  entryId: UUID;
  originalCost: Raw | null;
  intendedCost: Engine;
  costDelta: Engine;
  quantity: Raw;
  oracle: OracleCheck;
};
export type ReplayTotals = {
  originalReceiptValue: Raw;
  intendedReceiptValue: Engine;
  receiptValueDelta: Engine;
  originalConsumedValue: Engine;
  intendedConsumedValue: Engine;
  consumedValueDelta: Engine;
  originalRemainingValue: Engine;
  intendedRemainingValue: Engine;
  remainingValueDelta: Engine;
  terminalQty: Raw;
  intendedTerminalQty: Engine;
  conservationDifference: Engine;
  quantityDifference: Engine;
};
export type BasisChoice = {
  source: 'reported_hypothesis' | 'verified_document';
  stockQty: string;
  stockUom: string;
  valuationCurrency: string;
  qualifiedSourceValuationCurrency: string | null;
  comparison: 'verified_currency' | 'assumed_currency_numeric_only';
  totalValuation: string;
  receiptRate: string;
  receiptContribution: Rational;
  rateRoundingResidual: Rational;
  centDisplayTotal: string;
};
type Common = {
  schemaVersion: 1;
  orgId: UUID;
  receiptEntryId: UUID;
  receiptLineId: UUID;
  sourceCodeSha: CodeSha;
  target: QualifiedOperatorTarget;
  readOnly: true;
  eligible: false;
  diagnosticManifestSha256: Digest;
  source: SourceEvidence;
  coverage: Coverage;
  document: DocumentAssessment;
  errors: DiagnosticError[];
  blockers: Code[];
};
export type ReceiptDiscovery =
  | (Common & {
      mode: 'discovery';
      outcome: 'complete';
      complete: true;
      basisChoice: BasisChoice | null;
      readiness: 'unverified' | 'mismatched' | 'document_qualified';
    })
  | (Common & {
      mode: 'discovery';
      outcome: 'incomplete' | 'integrity' | 'unsupported';
      complete: false;
      basisChoice: null;
      readiness: 'blocked';
    });
export type ValuationReplayPlan =
  | (Common & {
      mode: 'hypothetical_replay';
      outcome: 'complete';
      complete: true;
      hypothetical: true;
      readiness: 'unverified' | 'mismatched' | 'document_qualified';
      basisChoice: BasisChoice;
      rows: ReplayRow[];
      consumerEffects: ConsumerEffect[];
      totals: ReplayTotals;
      checks: Check[];
    })
  | (Common & {
      mode: 'hypothetical_replay';
      outcome: 'incomplete' | 'integrity' | 'unsupported';
      complete: false;
      hypothetical: true;
      readiness: 'blocked';
      basisChoice: null;
      rows: [];
      consumerEffects: [];
      totals: null;
      checks: Check[];
    });
export type DiagnosticReport = {
  metadata: { runId: UUID; observedAt: UTC; snapshotId: string; outputReference: string | null };
  diagnosticManifestSha256: Digest;
  reportSha256: Digest;
  result: ReceiptDiscovery | ValuationReplayPlan;
};
export type StockReplayMath = {
  computeLegValue: (
    bin: { qty: number; rate: number },
    qtyDelta: number,
    rate: number | null,
  ) => { valueDelta: number; rateUsed: number };
  applyLedgerDelta: (
    bin: { qty: number; rate: number },
    qtyDelta: number,
    valueDelta: number,
  ) => { qty: number; rate: number };
  round4: (value: number) => number;
};

// ───────────────────────────── strict decoding combinators ─────────────────────────────
export class WireError extends Error {
  constructor(readonly path: string) {
    super(`invalid wire value at ${path}`);
    this.name = 'WireError';
  }
}
type V<T> = (x: unknown, p: string) => T;
const bad = (p: string): never => {
  throw new WireError(p);
};
const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const CONTROL = /[\u0000-\u001f\u007f]/;

const str =
  (min = 0, max = 1 << 20): V<string> =>
  (x, p) => {
    if (typeof x !== 'string' || x.length < min || x.length > max) bad(p);
    return x as string;
  };
const label =
  (min: number, max: number): V<string> =>
  (x, p) => {
    const s = str(min, max)(x, p);
    if (s !== s.normalize('NFC') || s !== s.trim() || CONTROL.test(s)) bad(p);
    return s;
  };
const re =
  (rx: RegExp): V<string> =>
  (x, p) => {
    if (typeof x !== 'string' || !rx.test(x)) bad(p);
    return x as string;
  };
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuid = re(UUID_RX);
const digest = re(/^[0-9a-f]{64}$/);
const codeSha = re(/^[0-9a-f]{40}$/);
const MAX_BIGINT = 9223372036854775807n;
const seq: V<string> = (x, p) => {
  if (typeof x !== 'string' || !/^[1-9][0-9]{0,18}$/.test(x) || BigInt(x) > MAX_BIGINT) bad(p);
  return x as string;
};
const utc: V<string> = (x, p) => {
  if (
    typeof x !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x) ||
    Number.isNaN(Date.parse(x)) ||
    new Date(x).toISOString() !== x
  )
    bad(p);
  return x as string;
};
/** Raw PostgreSQL numeric text: plain signed decimal, no plus/exponent/-0. */
const RAW_RX = /^-?(0|[1-9][0-9]*|[0-9]+)(\.[0-9]+)?$/;
const raw: V<string> = (x, p) => {
  if (typeof x !== 'string' || bytes(x) > 128 || !RAW_RX.test(x) || /^-0(\.0+)?$/.test(x)) bad(p);
  return x as string;
};
const POS_DEC = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const posDec: V<string> = (x, p) => {
  if (typeof x !== 'string' || bytes(x) > 128 || !POS_DEC.test(x) || Number(x) === 0) bad(p);
  return x as string;
};
const ENGINE_RX = /^-?(\d+(\.\d+)?)(e[+-]?\d+)?$/;
const engine: V<string> = (x, p) => {
  if (
    typeof x !== 'string' ||
    bytes(x) > 128 ||
    !ENGINE_RX.test(x) ||
    !Number.isFinite(Number(x)) ||
    Object.is(Number(x), -0)
  )
    bad(p);
  return x as string;
};
const currency = re(/^[A-Z]{3}$/);
const bool: V<boolean> = (x, p) => (typeof x === 'boolean' ? x : bad(p));
const int =
  (min: number, max: number): V<number> =>
  (x, p) =>
    typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max ? x : bad(p);
const lit =
  <T extends string | number | boolean>(...vals: T[]): V<T> =>
  (x, p) =>
    (vals as unknown[]).includes(x) ? (x as T) : bad(p);
const nul =
  <T>(v: V<T>): V<T | null> =>
  (x, p) =>
    x === null ? null : v(x, p);
const arr =
  <T>(v: V<T>, max: number): V<T[]> =>
  (x, p) => {
    if (!Array.isArray(x) || x.length > max) bad(p);
    return (x as unknown[]).map((e, i) => v(e, `${p}[${i}]`));
  };
const obj =
  <T extends Record<string, unknown>>(shape: { [K in keyof T]: V<T[K]> }): V<T> =>
  (x, p) => {
    if (!isObj(x)) bad(p);
    const o = x as Record<string, unknown>;
    const keys = Object.keys(shape);
    for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`${p}.${k}`);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (!(k in o) || o[k] === undefined) bad(`${p}.${k}`);
      out[k] = (shape as Record<string, V<unknown>>)[k](o[k], `${p}.${k}`);
    }
    return out as T;
  };
const union =
  <T>(disc: string, variants: Record<string, V<T>>): V<T> =>
  (x, p) => {
    if (!isObj(x) || typeof x[disc] !== 'string' || !Object.hasOwn(variants, x[disc] as string))
      return bad(`${p}.${disc}`);
    return variants[x[disc] as string](x, p);
  };
const anyOf =
  <T>(...vs: V<T>[]): V<T> =>
  (x, p) => {
    for (const v of vs) {
      try {
        return v(x, p);
      } catch (e) {
        if (!(e instanceof WireError)) throw e;
      }
    }
    return bad(p);
  };
const uniq =
  <T>(v: V<T[]>, key: (t: T) => string): V<T[]> =>
  (x, p) => {
    const out = v(x, p);
    if (new Set(out.map(key)).size !== out.length) bad(p);
    return out;
  };

const targetV = obj<QualifiedOperatorTarget>({
  databaseIdentity: digest,
  authProject: str(1, 256),
  authUrl: str(1, 2048),
});
const unitSourceV = obj<UnitSource>({
  entryId: uuid,
  lineId: uuid,
  headerRowSha256: digest,
  lineRowSha256: digest,
  sourceKind: lit('receipt', 'pos_ticket', 'booking'),
  sourceId: uuid,
  writer: lit(
    'receipt_stock_quantity',
    'pos_normalized_stock_quantity',
    'booking_normalized_stock_quantity',
  ),
  writerCodeSha: codeSha,
  writerEvidenceSha256: digest,
});
const unitQualificationV = obj<UnitQualification>({
  schemaVersion: lit(1),
  receiptEntryId: uuid,
  receiptLineId: uuid,
  itemId: uuid,
  itemRowSha256: digest,
  documentSha256: digest,
  documentLineReference: label(1, 256),
  stockUom: label(1, 80),
  documentUom: label(1, 80),
  documentQuantity: posDec,
  stockUnitsPerDocumentUnit: posDec,
  historicalStockUomEvidenceSha256: digest,
  conversionEvidenceSha256: digest,
  verifiedByProfileId: uuid,
  verifiedAt: utc,
  sources: arr(unitSourceV, 129),
});
const money: V<string> = (x, p) => {
  if (typeof x !== 'string' || bytes(x) > 128 || !RAW_RX.test(x) || /^-0(\.0+)?$/.test(x)) bad(p);
  return x as string;
};
const allocationV = obj<AllocationEvidence>({
  policy: lit('single_line', 'owner_verified_allocation'),
  net: money,
  tax: money,
  freight: money,
  discount: money,
  inventoryCost: money,
  evidenceSha256: digest,
});
const fxV = obj<FxEvidence>({
  sourceCurrency: currency,
  valuationCurrency: currency,
  rate: posDec,
  effectiveAt: utc,
  sourceInventoryCost: money,
  totalValuation: money,
  conversionResidual: money,
  historicalValuationCurrencyEvidenceSha256: digest,
  evidenceSha256: digest,
});
const factsV = obj<DocumentFacts>({
  reference: label(1, 256),
  documentLineReference: label(1, 256),
  sha256: digest,
  purchaseId: nul(uuid),
  providerRef: nul(label(1, 256)),
  quantity: posDec,
  uom: label(1, 80),
  allocation: allocationV,
  fx: fxV,
});
const documentInputV = union<DocumentInput>('state', {
  absent: obj({ state: lit('absent') }) as V<DocumentInput>,
  unverified: obj({
    state: lit('unverified'),
    reference: nul(label(1, 256)),
    sha256: nul(digest),
    facts: nul(factsV),
  }) as V<DocumentInput>,
  owner_attested: obj({
    state: lit('owner_attested'),
    facts: factsV,
    verifiedByProfileId: uuid,
    verifiedAt: utc,
    approvalReference: label(1, 1000),
  }) as V<DocumentInput>,
});
const hypothesisV = obj<ReportedHypothesis>({
  stockQty: posDec,
  stockUom: label(1, 80),
  valuationCurrency: currency,
  totalValuation: posDec,
});
const documentBasisV = obj<DocumentBasis>({
  policy: lit('verified_document_total'),
  reference: label(1, 256),
  sha256: digest,
  valuationCurrency: currency,
  stockQty: posDec,
  totalValuation: posDec,
  fxEvidenceSha256: digest,
  taxFreightAllocationSha256: digest,
  roundingResidual: money,
  residualAccepted: lit(true),
  unitQualification: unitQualificationV,
});
const diagnosticManifestV = obj<DiagnosticEvidenceManifestV1>({
  schemaVersion: lit(1),
  kind: lit('receipt_diagnostic'),
  target: targetV,
  sourceCodeSha: codeSha,
  orgId: uuid,
  actorProfileId: uuid,
  receiptEntryId: uuid,
  receiptLineId: uuid,
  approvalReference: label(1, 1000),
  document: documentInputV,
  unitQualification: nul(unitQualificationV),
  hypothesis: nul(hypothesisV),
  residualAccepted: bool,
});

export const decodeUnitQualification = (x: unknown): UnitQualification =>
  unitQualificationV(x, '$');
export const decodeDocumentBasis = (x: unknown): DocumentBasis => documentBasisV(x, '$');
export const decodeDiagnosticEvidenceManifestV1 = (x: unknown): DiagnosticEvidenceManifestV1 => {
  const m = diagnosticManifestV(x, '$');
  // cross-field: unverified document with facts must repeat reference/sha256 exactly
  if (m.document.state === 'unverified' && m.document.facts) {
    if (
      m.document.reference !== m.document.facts.reference ||
      m.document.sha256 !== m.document.facts.sha256
    )
      bad('$.document');
  }
  return m;
};

// result decoders
const scalarV = obj<ScalarEvidence>({
  state: lit('missing', 'null', 'value'),
  value: nul(str(0, 4096)),
});
const scalarChecked: V<ScalarEvidence> = (x, p) => {
  const s = scalarV(x, p);
  if ((s.state === 'value') !== (s.value !== null)) bad(p);
  return s;
};
const headerV = obj<EntryHeader>({
  id: uuid,
  humanId: nul(label(1, 80)),
  type: label(1, 40),
  status: label(1, 40),
  postedAt: nul(utc),
  rowSha256: digest,
  purchaseId: scalarChecked,
  providerRef: scalarChecked,
  currency: scalarChecked,
  fxRate: scalarChecked,
  fxUpdatedAt: scalarChecked,
});
const lineV = obj<EntryLine>({
  id: uuid,
  entryId: uuid,
  itemId: uuid,
  qty: raw,
  uom: nul(str(0, 80)),
  rate: nul(raw),
  fromWarehouseId: nul(uuid),
  toWarehouseId: nul(uuid),
  lineNo: int(0, 1 << 20),
  rowSha256: digest,
});
const movementV = obj<Movement>({
  id: seq,
  entryId: uuid,
  itemId: uuid,
  warehouseId: uuid,
  postedAt: utc,
  qtyDelta: raw,
  valueDelta: raw,
  qtyAfter: raw,
  valuationRate: raw,
  rowSha256: digest,
  header: headerV,
  lines: arr(lineV, 64),
  source: obj({
    kind: lit('receipt', 'pos_ticket', 'booking', 'invoice', 'unknown'),
    id: nul(uuid),
  }) as V<Movement['source']>,
  reversalOfLedgerId: nul(seq),
});
const consumerV = union<Consumer>('kind', {
  pos_ticket: obj({
    kind: lit('pos_ticket'),
    id: uuid,
    rowSha256: digest,
    entryId: uuid,
    financialFiscalSha256: digest,
  }) as V<Consumer>,
  stock_accrual: obj({
    kind: lit('stock_accrual'),
    id: uuid,
    rowSha256: digest,
    entryId: uuid,
    sourceType: label(1, 40),
    sourceId: uuid,
    itemId: uuid,
    realizedQty: nul(raw),
    realizedValue: nul(raw),
    realizedAt: nul(utc),
    status: label(1, 40),
  }) as V<Consumer>,
});
const openingV: V<Opening> = anyOf<Opening>(
  obj({
    state: lit('unknown'),
    priorLedgerId: lit(null as never),
    priorRowSha256: lit(null as never),
    qty: lit(null as never),
    rate: lit(null as never),
    valueEngine: lit(null as never),
  }) as unknown as V<Opening>,
  obj({
    state: lit('empty_verified'),
    priorLedgerId: lit(null as never),
    priorRowSha256: lit(null as never),
    qty: lit('0'),
    rate: lit('0'),
    valueEngine: lit('0'),
  }) as unknown as V<Opening>,
  obj({
    state: lit('verified'),
    priorLedgerId: seq,
    priorRowSha256: digest,
    qty: raw,
    rate: raw,
    valueEngine: engine,
  }) as unknown as V<Opening>,
);
const sourceEvidenceV = obj<SourceEvidence>({
  receipt: nul(headerV),
  line: nul(lineV),
  item: nul(
    obj({
      id: uuid,
      rowSha256: digest,
      stockUom: label(1, 80),
      consumptionUom: nul(label(1, 80)),
      unitsPerStockUom: nul(raw),
    }),
  ) as V<SourceEvidence['item']>,
  warehouse: nul(obj({ id: uuid, rowSha256: digest })) as V<SourceEvidence['warehouse']>,
  bin: nul(obj({ rowSha256: digest, qty: raw, rate: raw })) as V<SourceEvidence['bin']>,
  opening: openingV,
  context: arr(movementV, 10000),
  affected: arr(movementV, 129),
  boundary: nul(movementV),
  consumers: arr(consumerV, 256),
});
const cnt = nul(int(0, 1 << 30));
const coverageV = obj<Coverage>({
  readsComplete: bool,
  contextComplete: bool,
  affectedComplete: bool,
  consumersComplete: bool,
  baselineComplete: bool,
  hypotheticalComplete: bool,
  contextCount: cnt,
  affectedCount: cnt,
  consumerCount: cnt,
  contextReadCount: int(0, 1 << 30),
  affectedReadCount: int(0, 1 << 30),
  consumerReadCount: int(0, 1 << 30),
  lastReadLedgerId: nul(seq),
  latestSameKeyLedgerId: nul(seq),
  maxObservedLedgerId: nul(seq),
});
const checkV = obj<Check>({
  field: lit(...CHECK_FIELDS),
  state: lit('matched', 'mismatched', 'unknown'),
  expected: nul(str(0, 1024)),
  actual: nul(str(0, 1024)),
  evidenceSha256: arr(digest, 64),
});
const codeV = lit(...CODES);
const errorV = obj<DiagnosticError>({
  code: codeV,
  stage: lit(...STAGES),
  entryId: nul(uuid),
  ledgerId: nul(seq),
  consumerId: nul(uuid),
  limit: nul(int(0, 1 << 30)),
});
const documentAssessmentV = obj<DocumentAssessment>({
  state: lit('absent', 'unverified', 'verified', 'mismatched'),
  documentSha256: nul(digest),
  unitState: lit('unknown', 'unverified', 'verified', 'mismatched'),
  verifiedBasis: nul(documentBasisV),
  checks: arr(checkV, 64),
});
const ratV = obj<Rational>({
  numerator: re(/^-?(0|[1-9][0-9]*)$/),
  denominator: re(/^[1-9][0-9]*$/),
});
const oracleV = obj<OracleCheck>({
  expected: ratV,
  engine,
  absoluteDifference: ratV,
  tolerance: lit('0.00000001', '0.000000001'),
  passed: bool,
});
const replayRowV = obj<ReplayRow>({
  ledgerId: seq,
  entryId: uuid,
  qtyDelta: raw,
  original: obj({ valueDelta: raw, qtyAfter: raw, valuationRate: raw }) as V<ReplayRow['original']>,
  intended: obj({ valueDelta: engine, qtyAfter: engine, valuationRate: engine }) as V<
    ReplayRow['intended']
  >,
  oracle: obj({ valueDelta: oracleV, qtyAfter: oracleV, valuationRate: oracleV }) as V<
    ReplayRow['oracle']
  >,
});
const consumerEffectV = obj<ConsumerEffect>({
  kind: lit('pos_ticket', 'stock_accrual'),
  id: uuid,
  entryId: uuid,
  originalCost: nul(raw),
  intendedCost: engine,
  costDelta: engine,
  quantity: raw,
  oracle: oracleV,
});
const totalsV = obj<ReplayTotals>({
  originalReceiptValue: raw,
  intendedReceiptValue: engine,
  receiptValueDelta: engine,
  originalConsumedValue: engine,
  intendedConsumedValue: engine,
  consumedValueDelta: engine,
  originalRemainingValue: engine,
  intendedRemainingValue: engine,
  remainingValueDelta: engine,
  terminalQty: raw,
  intendedTerminalQty: engine,
  conservationDifference: engine,
  quantityDifference: engine,
});
const basisChoiceV = obj<BasisChoice>({
  source: lit('reported_hypothesis', 'verified_document'),
  stockQty: posDec,
  stockUom: label(1, 80),
  valuationCurrency: currency,
  qualifiedSourceValuationCurrency: nul(currency),
  comparison: lit('verified_currency', 'assumed_currency_numeric_only'),
  totalValuation: posDec,
  receiptRate: posDec,
  receiptContribution: ratV,
  rateRoundingResidual: ratV,
  centDisplayTotal: money,
});
const commonShape = {
  schemaVersion: lit(1 as const),
  orgId: uuid,
  receiptEntryId: uuid,
  receiptLineId: uuid,
  sourceCodeSha: codeSha,
  target: targetV,
  readOnly: lit(true as const),
  eligible: lit(false as const),
  diagnosticManifestSha256: digest,
  source: sourceEvidenceV,
  coverage: coverageV,
  document: documentAssessmentV,
  errors: arr(errorV, 4096),
  blockers: arr(codeV, 64),
};
const emptyArr =
  <T>(): V<T[]> =>
  (x, p) =>
    Array.isArray(x) && x.length === 0 ? ([] as T[]) : bad(p);
const mode = (m: string) => ({ mode: lit(m) });
const completeFlag = (c: boolean) => ({ complete: lit(c) });
const incompleteOutcome = lit('incomplete', 'integrity', 'unsupported');
const readiness = lit('unverified', 'mismatched', 'document_qualified');
const discoveryV: V<ReceiptDiscovery> = anyOf<ReceiptDiscovery>(
  obj({
    ...commonShape,
    ...mode('discovery'),
    outcome: lit('complete'),
    ...completeFlag(true),
    basisChoice: nul(basisChoiceV),
    readiness,
  }) as unknown as V<ReceiptDiscovery>,
  obj({
    ...commonShape,
    ...mode('discovery'),
    outcome: incompleteOutcome,
    ...completeFlag(false),
    basisChoice: lit(null as never),
    readiness: lit('blocked'),
  }) as unknown as V<ReceiptDiscovery>,
);
const replayV: V<ValuationReplayPlan> = anyOf<ValuationReplayPlan>(
  obj({
    ...commonShape,
    ...mode('hypothetical_replay'),
    outcome: lit('complete'),
    ...completeFlag(true),
    hypothetical: lit(true),
    readiness,
    basisChoice: basisChoiceV,
    rows: arr(replayRowV, 129),
    consumerEffects: arr(consumerEffectV, 256),
    totals: totalsV,
    checks: arr(checkV, 64),
  }) as unknown as V<ValuationReplayPlan>,
  obj({
    ...commonShape,
    ...mode('hypothetical_replay'),
    outcome: incompleteOutcome,
    ...completeFlag(false),
    hypothetical: lit(true),
    readiness: lit('blocked'),
    basisChoice: lit(null as never),
    rows: emptyArr(),
    consumerEffects: emptyArr(),
    totals: lit(null as never),
    checks: arr(checkV, 64),
  }) as unknown as V<ValuationReplayPlan>,
);
export const decodeReceiptDiscovery = (x: unknown): ReceiptDiscovery => discoveryV(x, '$');
export const decodeValuationReplayPlan = (x: unknown): ValuationReplayPlan => replayV(x, '$');
const resultV: V<ReceiptDiscovery | ValuationReplayPlan> = (x, p) => {
  if (isObj(x) && x.mode === 'hypothetical_replay') return replayV(x, p);
  return discoveryV(x, p);
};
export const decodeDiagnosticReport = (x: unknown): DiagnosticReport =>
  obj<DiagnosticReport>({
    metadata: obj({
      runId: uuid,
      observedAt: utc,
      snapshotId: str(1, 256),
      outputReference: nul(str(1, 1024)),
    }) as V<DiagnosticReport['metadata']>,
    diagnosticManifestSha256: digest,
    reportSha256: digest,
    result: resultV,
  })(x, '$');

// ───────────────────────────── strict JSON parse (duplicate keys) ─────────────────────────────
export const MAX_MANIFEST_BYTES = 1048576;
/** Bounded recursive-descent JSON reader: rejects duplicate keys, >64 nesting depth and oversize input. */
export function parseStrictJson(text: string): unknown {
  if (bytes(text) > MAX_MANIFEST_BYTES) bad('$');
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const token = (): unknown => {
    const start = i;
    if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
      try {
        return JSON.parse(text.slice(start, i));
      } catch {
        return bad('$');
      }
    }
    while (i < text.length && !',]} \t\n\r'.includes(text[i])) i++;
    try {
      return JSON.parse(text.slice(start, i));
    } catch {
      return bad('$');
    }
  };
  const value = (depth: number): unknown => {
    ws();
    const c = text[i];
    if (c === '{' || c === '[') {
      if (depth >= 64) bad('$');
      i++;
      ws();
      if (c === '[') {
        const out: unknown[] = [];
        if (text[i] === ']') return (i++, out);
        for (;;) {
          out.push(value(depth + 1));
          ws();
          if (text[i] === ',') i++;
          else if (text[i] === ']') return (i++, out);
          else bad('$');
        }
      }
      const out: Record<string, unknown> = Object.create(null);
      if (text[i] === '}') return (i++, out);
      for (;;) {
        ws();
        if (text[i] !== '"') bad('$');
        const key = token() as string;
        if (Object.hasOwn(out, key)) bad(`$.${key}`);
        ws();
        if (text[i++] !== ':') bad('$');
        out[key] = value(depth + 1);
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === '}') return (i++, out);
        else bad('$');
      }
    }
    return token();
  };
  const v = value(0);
  ws();
  if (i !== text.length) bad('$');
  return v;
}
export const parseDiagnosticManifestJson = (text: string): DiagnosticEvidenceManifestV1 =>
  decodeDiagnosticEvidenceManifestV1(parseStrictJson(text));

// ───────────────────────────── canonical JSON + digests ─────────────────────────────
export function canonical(x: unknown): string {
  if (x === null) return 'null';
  if (typeof x === 'string' || typeof x === 'boolean') return JSON.stringify(x);
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new WireError('canonical');
    return JSON.stringify(x);
  }
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (isObj(x)) {
    const keys = Object.keys(x)
      .filter((k) => x[k] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  }
  throw new WireError('canonical');
}
export const sha256 = (s: string): Digest => createHash('sha256').update(s, 'utf8').digest('hex');
const stripAttestation = (u: UnitQualification | null) => {
  if (!u) return null;
  const { verifiedByProfileId: _a, verifiedAt: _b, ...rest } = u;
  return rest;
};
export function diagnosticManifestSha256(m: DiagnosticEvidenceManifestV1): Digest {
  const document =
    m.document.state === 'owner_attested'
      ? { state: m.document.state, facts: m.document.facts }
      : m.document;
  return sha256(
    canonical({
      schemaVersion: m.schemaVersion,
      kind: m.kind,
      target: m.target,
      sourceCodeSha: m.sourceCodeSha,
      orgId: m.orgId,
      receiptEntryId: m.receiptEntryId,
      receiptLineId: m.receiptLineId,
      document,
      unitQualification: stripAttestation(m.unitQualification),
      hypothesis: m.hypothesis,
      residualAccepted: m.residualAccepted,
    }),
  );
}
export function diagnosticReportSha256(
  manifestSha: Digest,
  result: ReceiptDiscovery | ValuationReplayPlan,
): Digest {
  const { diagnosticManifestSha256: _d, ...rest } = result as Record<string, unknown> &
    typeof result;
  const r = { ...rest } as Record<string, unknown>;
  const doc = r.document as DocumentAssessment;
  if (doc.verifiedBasis) {
    r.document = {
      ...doc,
      verifiedBasis: {
        ...doc.verifiedBasis,
        unitQualification: stripAttestation(doc.verifiedBasis.unitQualification),
      },
    };
  }
  return sha256(
    canonical({
      schemaVersion: 1,
      domain: 'receipt_diagnostic',
      diagnosticManifestSha256: manifestSha,
      result: r,
    }),
  );
}

// ───────────────────────────── exact rational arithmetic (oracle) ─────────────────────────────
type Rat = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
export const rat = (n: bigint, d = 1n): Rat => {
  if (d === 0n) throw new WireError('rational');
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const add = (a: Rat, b: Rat) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rat, b: Rat) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rat, b: Rat) => rat(a.n * b.n, a.d * b.d);
const div = (a: Rat, b: Rat) => rat(a.n * b.d, a.d * b.n);
const absR = (a: Rat): Rat => ({ n: a.n < 0n ? -a.n : a.n, d: a.d });
const cmp = (a: Rat, b: Rat) => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};
/** Plain decimal or exponent spelling (String(Number)) to an exact rational. */
export function parseRat(text: string): Rat {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (!m) throw new WireError('decimal');
  const frac = m[3] ?? '';
  let n = BigInt(m[2] + frac);
  let d = 10n ** BigInt(frac.length);
  const e = Number(m[4] ?? 0);
  if (Math.abs(e) > 400) throw new WireError('decimal');
  if (e >= 0) n *= 10n ** BigInt(e);
  else d *= 10n ** BigInt(-e);
  return rat(m[1] ? -n : n, d);
}
const toWire = (r: Rat): Rational => ({ numerator: r.n.toString(), denominator: r.d.toString() });
const TOL = { value: '0.00000001', qty: '0.000000001' } as const;
function oracle(expected: Rat, engineText: string, tol: keyof typeof TOL): OracleCheck {
  const diff = absR(sub(expected, parseRat(engineText)));
  return {
    expected: toWire(expected),
    engine: engineText,
    absoluteDifference: toWire(diff),
    tolerance: TOL[tol],
    passed: cmp(diff, parseRat(TOL[tol])) <= 0,
  };
}
const eng = (n: number): string => {
  if (!Number.isFinite(n) || Object.is(n, -0)) throw new WireError('engine');
  const s = String(n);
  if (bytes(s) > 128) throw new WireError('engine');
  return s;
};
/** Plain decimal rendering of an exact terminating rational (used for contributions). */
function ratToDecimal(r: Rat, maxScale = 12): string | null {
  let d = r.d;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) ((d /= 2n), twos++);
  while (d % 5n === 0n) ((d /= 5n), fives++);
  if (d !== 1n) return null;
  const scale = Math.max(twos, fives);
  if (scale > maxScale) return null;
  const minor = (r.n * 10n ** BigInt(scale)) / r.d;
  const neg = minor < 0n;
  const digits = (neg ? -minor : minor).toString().padStart(scale + 1, '0');
  const s = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return neg ? `-${s}` : s;
}

// ───────────────────────────── receipt rate / basis ─────────────────────────────
/** Exact four-decimal receipt rate boundary: divideDecimalToMinor then minorToDecimal (half away from zero). */
export function receiptRateBasis(totalValuation: string, stockQty: string) {
  const receiptRate = minorToDecimal(divideDecimalToMinor(totalValuation, stockQty, 4), 4);
  const contribution = mul(parseRat(stockQty), parseRat(receiptRate));
  const residual = sub(parseRat(totalValuation), contribution);
  const exact = ratToDecimal(contribution);
  if (exact === null) throw new WireError('contribution');
  return {
    receiptRate,
    receiptContribution: toWire(contribution),
    rateRoundingResidual: toWire(residual),
    centDisplayTotal: minorToDecimal(decimalToMinor(exact, 2), 2),
  };
}

// ───────────────────────────── diagnostic build ─────────────────────────────
const ISSUE_CAP = 128;
const MAX_INT = 9;
const MAX_FRAC = 4;
const qtyAdmissible = (q: string) => {
  const [i, f = ''] = q.replace('-', '').split('.');
  return i.replace(/^0+(?=\d)/, '').length <= MAX_INT && f.replace(/0+$/, '').length <= MAX_FRAC;
};
const checkOf = (
  field: CheckField,
  state: Check['state'],
  expected: string | null,
  actual: string | null,
  ev: Digest[] = [],
): Check => ({ field, state, expected, actual, evidenceSha256: [...new Set(ev)].sort() });

const WRITER_FOR: Record<UnitSource['sourceKind'], UnitSource['writer']> = {
  receipt: 'receipt_stock_quantity',
  pos_ticket: 'pos_normalized_stock_quantity',
  booking: 'booking_normalized_stock_quantity',
};

/** Document/unit assessment against actual source evidence. Never upgrades an unverified claim. */
export function assessDocument(
  m: DiagnosticEvidenceManifestV1,
  s: SourceEvidence,
): DocumentAssessment {
  const uq = m.unitQualification;
  const checks: Check[] = [];
  const doc = m.document;
  const receiptQty = s.line ? parseRat(s.line.qty) : null;
  // unit qualification
  let unitState: DocumentAssessment['unitState'] = uq ? 'unverified' : 'unknown';
  if (uq) {
    const refs: Digest[] = [uq.historicalStockUomEvidenceSha256, uq.conversionEvidenceSha256];
    const bindOk =
      !!s.line &&
      !!s.item &&
      uq.receiptEntryId === m.receiptEntryId &&
      uq.receiptLineId === m.receiptLineId &&
      uq.itemId === s.item.id &&
      uq.itemRowSha256 === s.item.rowSha256;
    const srcOk =
      s.affected.length > 0 &&
      uq.sources.length === s.affected.length &&
      uq.sources.every((u, i) => {
        const mv = s.affected[i];
        const ln = mv.lines[0];
        return (
          !!ln &&
          u.entryId === mv.entryId &&
          u.lineId === ln.id &&
          u.headerRowSha256 === mv.header.rowSha256 &&
          u.lineRowSha256 === ln.rowSha256 &&
          u.sourceKind === (mv.source.kind as string) &&
          u.sourceId === mv.source.id &&
          u.writer === WRITER_FOR[u.sourceKind]
        );
      });
    const labelsOk = s.affected.every(
      (mv) => mv.lines[0]?.uom === null || mv.lines[0]?.uom === uq.stockUom,
    );
    const convOk =
      !!receiptQty &&
      cmp(
        mul(parseRat(uq.documentQuantity), parseRat(uq.stockUnitsPerDocumentUnit)),
        receiptQty,
      ) === 0;
    if (!bindOk || !srcOk || !labelsOk || !convOk) {
      unitState = s.affected.length === 0 || !s.item ? 'unverified' : 'mismatched';
      checks.push(
        checkOf(
          'stock_unit',
          unitState === 'mismatched' ? 'mismatched' : 'unknown',
          uq.stockUom,
          s.item?.stockUom ?? null,
          refs,
        ),
      );
    } else {
      unitState = 'verified';
      checks.push(checkOf('stock_unit', 'matched', uq.stockUom, uq.stockUom, refs));
    }
  }
  if (doc.state === 'absent') {
    return {
      state: 'absent',
      documentSha256: null,
      unitState,
      verifiedBasis: null,
      checks: sortChecks(checks),
    };
  }
  const facts = doc.facts;
  if (!facts) {
    return {
      state: 'unverified',
      documentSha256: doc.state === 'unverified' ? doc.sha256 : null,
      unitState,
      verifiedBasis: null,
      checks: sortChecks(checks),
    };
  }
  let mismatched = false;
  let unknown = doc.state !== 'owner_attested';
  const note = (c: Check) => {
    checks.push(c);
    if (c.state === 'mismatched') mismatched = true;
    if (c.state === 'unknown') unknown = true;
  };
  // document identity vs actual same-org source metadata
  const hdr = s.receipt;
  const idMis =
    (facts.purchaseId !== null &&
      hdr?.purchaseId.state === 'value' &&
      hdr.purchaseId.value !== facts.purchaseId) ||
    (facts.providerRef !== null &&
      hdr?.providerRef.state === 'value' &&
      hdr.providerRef.value !== facts.providerRef);
  note(
    checkOf(
      'document_identity',
      idMis ? 'mismatched' : 'matched',
      facts.reference,
      hdr?.purchaseId.value ?? null,
      [facts.sha256],
    ),
  );
  // quantity
  const qtyOk =
    !!receiptQty &&
    cmp(
      mul(parseRat(facts.quantity), uq ? parseRat(uq.stockUnitsPerDocumentUnit) : rat(1n)),
      receiptQty,
    ) === 0 &&
    (uq
      ? uq.documentSha256 === facts.sha256 &&
        uq.documentQuantity === facts.quantity &&
        uq.documentUom === facts.uom
      : false);
  note(
    checkOf(
      'quantity',
      !uq ? 'unknown' : qtyOk ? 'matched' : 'mismatched',
      s.line?.qty ?? null,
      facts.quantity,
      [facts.sha256],
    ),
  );
  // currency
  const hc = hdr?.currency;
  const curMis = hc?.state === 'value' && hc.value !== facts.fx.sourceCurrency;
  note(
    checkOf(
      'currency',
      curMis ? 'mismatched' : 'matched',
      facts.fx.sourceCurrency,
      hc?.value ?? null,
      [facts.fx.historicalValuationCurrencyEvidenceSha256],
    ),
  );
  // allocation: inventoryCost = net+tax+freight-discount (exact)
  const a = facts.allocation;
  const invCost = sub(
    add(add(parseRat(a.net), parseRat(a.tax)), parseRat(a.freight)),
    parseRat(a.discount),
  );
  note(
    checkOf(
      'allocation',
      cmp(invCost, parseRat(a.inventoryCost)) === 0 ? 'matched' : 'mismatched',
      a.inventoryCost,
      ratToDecimal(invCost),
      [a.evidenceSha256],
    ),
  );
  // fx: totalValuation = sourceInventoryCost*rate + residual; sourceInventoryCost = inventoryCost
  const f = facts.fx;
  const fxOk =
    cmp(parseRat(f.sourceInventoryCost), parseRat(a.inventoryCost)) === 0 &&
    cmp(
      add(mul(parseRat(f.sourceInventoryCost), parseRat(f.rate)), parseRat(f.conversionResidual)),
      parseRat(f.totalValuation),
    ) === 0 &&
    (f.sourceCurrency !== f.valuationCurrency ||
      (f.rate === '1' && cmp(parseRat(f.conversionResidual), rat(0n)) === 0));
  note(checkOf('fx', fxOk ? 'matched' : 'mismatched', f.totalValuation, null, [f.evidenceSha256]));
  const state: DocumentAssessment['state'] = mismatched
    ? 'mismatched'
    : unknown || unitState !== 'verified' || !m.residualAccepted || doc.state !== 'owner_attested'
      ? 'unverified'
      : 'verified';
  let verifiedBasis: DocumentBasis | null = null;
  if (state === 'verified' && uq && s.line) {
    const rb = receiptRateBasis(f.totalValuation, s.line.qty);
    verifiedBasis = {
      policy: 'verified_document_total',
      reference: facts.reference,
      sha256: facts.sha256,
      valuationCurrency: f.valuationCurrency,
      stockQty: s.line.qty,
      totalValuation: f.totalValuation,
      fxEvidenceSha256: f.evidenceSha256,
      taxFreightAllocationSha256: a.evidenceSha256,
      roundingResidual:
        ratToDecimal(
          rat(
            BigInt(rb.rateRoundingResidual.numerator),
            BigInt(rb.rateRoundingResidual.denominator),
          ),
        ) ?? '0',
      residualAccepted: true,
      unitQualification: uq,
    };
  }
  return {
    state,
    documentSha256: facts.sha256,
    unitState,
    verifiedBasis,
    checks: sortChecks(checks),
  };
}
const sortChecks = (c: Check[]) =>
  [...c].sort((a, b) => CHECK_FIELDS.indexOf(a.field) - CHECK_FIELDS.indexOf(b.field));

const errCmp = (a: DiagnosticError, b: DiagnosticError) => {
  const s = STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage);
  if (s) return s;
  const la =
    a.ledgerId === null
      ? Infinity
      : Number(
          BigInt(a.ledgerId) > BigInt(Number.MAX_SAFE_INTEGER)
            ? Number.MAX_SAFE_INTEGER
            : a.ledgerId,
        );
  const lb =
    b.ledgerId === null
      ? Infinity
      : Number(
          BigInt(b.ledgerId) > BigInt(Number.MAX_SAFE_INTEGER)
            ? Number.MAX_SAFE_INTEGER
            : b.ledgerId,
        );
  if (la !== lb) return la < lb ? -1 : 1;
  return (
    (a.entryId ?? '~').localeCompare(b.entryId ?? '~') ||
    (a.consumerId ?? '~').localeCompare(b.consumerId ?? '~') ||
    a.code.localeCompare(b.code)
  );
};
const E = (
  code: Code,
  stage: DiagnosticError['stage'],
  extra: Partial<DiagnosticError> = {},
): DiagnosticError => ({
  code,
  stage,
  entryId: null,
  ledgerId: null,
  consumerId: null,
  limit: null,
  ...extra,
});

function common(
  m: DiagnosticEvidenceManifestV1,
  s: SourceEvidence,
  c: Coverage,
  doc: DocumentAssessment,
  errors: DiagnosticError[],
) {
  const sorted = [...errors].sort(errCmp);
  const blockers = [...new Set(sorted.map((e) => e.code))].sort() as Code[];
  return {
    schemaVersion: 1 as const,
    orgId: m.orgId,
    receiptEntryId: m.receiptEntryId,
    receiptLineId: m.receiptLineId,
    sourceCodeSha: m.sourceCodeSha,
    target: m.target,
    readOnly: true as const,
    eligible: false as const,
    diagnosticManifestSha256: diagnosticManifestSha256(m),
    source: s,
    coverage: c,
    document: doc,
    errors: sorted,
    blockers,
  };
}

function usableBasis(
  m: DiagnosticEvidenceManifestV1,
  s: SourceEvidence,
  doc: DocumentAssessment,
): { basis: BasisChoice | null; errors: DiagnosticError[] } {
  const errors: DiagnosticError[] = [];
  const stockUom = s.item?.stockUom ?? '';
  const mk = (
    source: BasisChoice['source'],
    qty: string,
    uom: string,
    cur: string,
    total: string,
    qualified: string | null,
  ): BasisChoice => ({
    source,
    stockQty: qty,
    stockUom: uom,
    valuationCurrency: cur,
    qualifiedSourceValuationCurrency: qualified,
    comparison: qualified ? 'verified_currency' : 'assumed_currency_numeric_only',
    totalValuation: total,
    ...receiptRateBasis(total, qty),
  });
  if (doc.verifiedBasis) {
    const vb = doc.verifiedBasis;
    const choice = mk(
      'verified_document',
      vb.stockQty,
      vb.unitQualification.stockUom,
      vb.valuationCurrency,
      vb.totalValuation,
      vb.valuationCurrency,
    );
    if (
      m.hypothesis &&
      (m.hypothesis.totalValuation !== vb.totalValuation ||
        m.hypothesis.stockQty !== vb.stockQty ||
        m.hypothesis.valuationCurrency !== vb.valuationCurrency)
    ) {
      errors.push(E('hypothesis_disagrees_with_document', 'document'));
    }
    return { basis: choice, errors };
  }
  const h = m.hypothesis;
  if (!h || !s.line) return { basis: null, errors };
  if (cmp(parseRat(h.stockQty), parseRat(s.line.qty)) !== 0) {
    errors.push(E('quantity_mismatch', 'document', { entryId: s.line.entryId }));
    return { basis: null, errors };
  }
  const hc = s.receipt?.currency;
  if (hc?.state === 'value' && hc.value !== h.valuationCurrency) {
    errors.push(E('fx_mismatched', 'document'));
    return { basis: null, errors };
  }
  void stockUom;
  return {
    basis: mk(
      'reported_hypothesis',
      h.stockQty,
      h.stockUom,
      h.valuationCurrency,
      h.totalValuation,
      null,
    ),
    errors,
  };
}

/**
 * Closed diagnostic result. Precedence: incomplete source/resource -> integrity baseline -> unsupported
 * support matrix -> complete documentary/hypothetical result. Never throws for source-shaped problems.
 */
export function buildDiagnosticResult(
  manifest: DiagnosticEvidenceManifestV1,
  source: SourceEvidence,
  coverage: Coverage,
  modeWanted: 'discovery' | 'hypothetical_replay',
  math: StockReplayMath,
): ReceiptDiscovery | ValuationReplayPlan {
  const doc = assessDocument(manifest, source);
  const docErrors: DiagnosticError[] = [];
  if (doc.state === 'absent') docErrors.push(E('document_absent', 'document'));
  if (doc.state === 'unverified') docErrors.push(E('document_unverified', 'document'));
  if (doc.state === 'mismatched') docErrors.push(E('document_mismatched', 'document'));
  if (doc.unitState === 'unknown' || doc.unitState === 'unverified')
    docErrors.push(E('unit_unverified', 'document'));
  if (doc.unitState === 'mismatched') docErrors.push(E('unit_mismatched', 'document'));
  if (doc.state === 'verified' || doc.state === 'unverified') {
    if (manifest.document.state !== 'absent' && !manifest.residualAccepted)
      docErrors.push(E('residual_unaccepted', 'document'));
  }

  const fail = (
    outcome: 'incomplete' | 'integrity' | 'unsupported',
    errors: DiagnosticError[],
    checks: Check[] = [],
  ) => {
    const cov = {
      ...coverage,
      hypotheticalComplete: false,
      baselineComplete:
        outcome === 'incomplete' ? false : coverage.baselineComplete && outcome === 'unsupported',
    };
    const c = common(manifest, source, cov, doc, [...errors, ...docErrors]);
    return modeWanted === 'discovery'
      ? ({
          ...c,
          mode: 'discovery',
          outcome,
          complete: false,
          basisChoice: null,
          readiness: 'blocked',
        } as ReceiptDiscovery)
      : ({
          ...c,
          mode: 'hypothetical_replay',
          outcome,
          complete: false,
          hypothetical: true,
          readiness: 'blocked',
          basisChoice: null,
          rows: [],
          consumerEffects: [],
          totals: null,
          checks: [...checks, ...doc.checks],
        } as ValuationReplayPlan);
  };

  // 1. incomplete source/resource
  const incomplete: DiagnosticError[] = [];
  if (!coverage.readsComplete) incomplete.push(E('read_failed', 'read'));
  if (!coverage.contextComplete) incomplete.push(E('resource_limit', 'read', { limit: 10000 }));
  if (!coverage.consumersComplete) incomplete.push(E('consumer_unresolved', 'read'));
  const capHit = !!source.boundary && !coverage.affectedComplete;
  if (!coverage.affectedComplete && !capHit) incomplete.push(E('read_failed', 'read'));
  if (!source.receipt || !source.line || !source.item || !source.bin)
    incomplete.push(E('source_unavailable', 'read'));
  if (source.opening.state === 'unknown') incomplete.push(E('source_unavailable', 'baseline'));
  if (incomplete.length) return fail('incomplete', incomplete);

  const rcv = source.affected[0];
  const line = source.line!;
  const base: DiagnosticError[] = [];
  // 2. support matrix over the affected segment (original facts only)
  const unsupported: DiagnosticError[] = [];
  if (capHit)
    unsupported.push(
      E('unsupported_issue_cap', 'support', {
        entryId: source.boundary!.entryId,
        ledgerId: source.boundary!.id,
        limit: ISSUE_CAP,
      }),
    );
  if (!rcv || rcv.entryId !== manifest.receiptEntryId || rcv.source.kind !== 'receipt') {
    unsupported.push(E('unsupported_source', 'support', { entryId: rcv?.entryId ?? null }));
  }
  for (const [i, mv] of source.affected.entries()) {
    const at = { entryId: mv.entryId, ledgerId: mv.id };
    const t = mv.header.type;
    if (mv.header.status !== 'submitted' || mv.reversalOfLedgerId !== null)
      unsupported.push(E('unsupported_reversal', 'support', at));
    if (mv.lines.length !== 1) unsupported.push(E('unsupported_multiline', 'support', at));
    else if (mv.lines[0].itemId !== mv.itemId || mv.itemId !== line.itemId)
      unsupported.push(E('unsupported_multikey', 'support', at));
    if (i > 0) {
      if (t === 'receipt') unsupported.push(E('unsupported_second_receipt', 'support', at));
      else if (t === 'transfer') unsupported.push(E('unsupported_transfer', 'support', at));
      else if (t === 'adjustment') unsupported.push(E('unsupported_adjustment', 'support', at));
      else if (t !== 'issue') unsupported.push(E('unsupported_source', 'support', at));
      if (t === 'issue' && mv.source.kind !== 'pos_ticket' && mv.source.kind !== 'booking')
        unsupported.push(E('unsupported_source', 'support', at));
    }
    for (const q of [mv.qtyDelta, mv.lines[0]?.qty ?? '1'])
      if (!qtyAdmissible(q)) unsupported.push(E('outside_numeric_oracle', 'support', at));
    if (Number(mv.qtyAfter) <= 0) unsupported.push(E('unsupported_zero_quantity', 'support', at));
    if (i > 0 ? Number(mv.valueDelta) > 0 : Number(mv.valueDelta) < 0)
      unsupported.push(E('unsupported_negative_value', 'support', at));
  }
  // 3. original baseline (integrity) — only meaningful when the history is a supported shape
  const integrity: DiagnosticError[] = [];
  const open = source.opening;
  let bin = { qty: Number(open.qty), rate: Number(open.rate) };
  const rows: { mv: Movement; bin: { qty: number; rate: number } }[] = [];
  if (!unsupported.length || unsupported.every((e) => e.code === 'unsupported_issue_cap')) {
    for (const mv of source.affected) {
      const qd = Number(mv.qtyDelta);
      const vd = Number(mv.valueDelta);
      const legRate = mv === rcv ? Number(line.rate) : null;
      const leg = math.computeLegValue(bin, qd, legRate);
      const at = { entryId: mv.entryId, ledgerId: mv.id };
      if (Math.abs(leg.valueDelta - vd) > 1e-8)
        integrity.push(E('baseline_mismatch', 'baseline', at));
      bin = math.applyLedgerDelta(bin, qd, vd);
      if (
        Math.abs(bin.qty - Number(mv.qtyAfter)) > 1e-9 ||
        Math.abs(bin.rate - Number(mv.valuationRate)) > 1e-8
      ) {
        integrity.push(E('baseline_mismatch', 'baseline', at));
      }
      rows.push({ mv, bin });
    }
    if (
      source.bin &&
      (Math.abs(bin.qty - Number(source.bin.qty)) > 1e-9 ||
        Math.abs(bin.rate - Number(source.bin.rate)) > 1e-8)
    ) {
      integrity.push(E('latest_bin_mismatch', 'baseline'));
    }
    const last = source.affected[source.affected.length - 1];
    if (
      last &&
      coverage.latestSameKeyLedgerId !== null &&
      coverage.latestSameKeyLedgerId !== last.id &&
      !capHit
    ) {
      integrity.push(E('latest_bin_mismatch', 'baseline', { ledgerId: last.id }));
    }
  }
  if (integrity.length)
    return fail('integrity', integrity, [checkOf('baseline', 'mismatched', null, null)]);
  if (unsupported.length) return fail('unsupported', unsupported);

  // consumers: each issue exactly one consumer of its source kind
  const consumerErr: DiagnosticError[] = [];
  const consumerFor = new Map<string, Consumer[]>();
  for (const c of source.consumers)
    consumerFor.set(c.entryId, [...(consumerFor.get(c.entryId) ?? []), c]);
  for (const mv of source.affected.slice(1)) {
    const cs = consumerFor.get(mv.entryId) ?? [];
    const want = mv.source.kind === 'pos_ticket' ? 'pos_ticket' : 'stock_accrual';
    if (cs.length !== 1 || cs[0].kind !== want)
      consumerErr.push(
        E('consumer_unresolved', 'support', { entryId: mv.entryId, ledgerId: mv.id }),
      );
    else if (
      cs[0].kind === 'stock_accrual' &&
      (cs[0].realizedValue === null || cs[0].realizedQty === null)
    ) {
      consumerErr.push(
        E('consumer_unresolved', 'support', { entryId: mv.entryId, consumerId: cs[0].id }),
      );
    } else if (
      cs[0].kind === 'stock_accrual' &&
      (cmp(parseRat(cs[0].realizedQty!), parseRat(mv.qtyDelta.replace('-', ''))) !== 0 ||
        cs[0].sourceId !== mv.source.id)
    ) {
      consumerErr.push(
        E('consumer_mismatch', 'support', { entryId: mv.entryId, consumerId: cs[0].id }),
      );
    }
  }
  const known = new Set(source.affected.map((a) => a.entryId));
  for (const c of source.consumers)
    if (!known.has(c.entryId))
      consumerErr.push(E('consumer_mismatch', 'support', { entryId: c.entryId, consumerId: c.id }));
  if (consumerErr.length) return fail('unsupported', consumerErr);

  // 4. complete result
  const { basis, errors: basisErrors } = usableBasis(manifest, source, doc);
  const readiness: 'unverified' | 'mismatched' | 'document_qualified' =
    doc.state === 'mismatched' ||
    basisErrors.some((e) => e.code === 'hypothesis_disagrees_with_document')
      ? 'mismatched'
      : doc.verifiedBasis
        ? 'document_qualified'
        : 'unverified';
  const all = [...docErrors, ...basisErrors];
  if (!basis) all.push(E('cost_basis_missing', 'document'));
  const cov: Coverage = {
    ...coverage,
    baselineComplete: true,
    hypotheticalComplete: modeWanted === 'hypothetical_replay' && !!basis,
  };
  if (modeWanted === 'discovery' || !basis) {
    const c = common(manifest, source, cov, doc, all);
    return {
      ...c,
      mode: 'discovery',
      outcome: 'complete',
      complete: true,
      basisChoice: modeWanted === 'discovery' ? basis : null,
      readiness,
    } as ReceiptDiscovery;
  }
  // hypothetical replay: source-compatible Number engine + independent BigInt oracle
  let b = { qty: Number(open.qty), rate: Number(open.rate) };
  let oq = parseRat(open.qty!);
  let ov = mul(oq, parseRat(open.rate!));
  const outRows: ReplayRow[] = [];
  const cons: ConsumerEffect[] = [];
  const checks: Check[] = [];
  const replayErr: DiagnosticError[] = [];
  let interCons = 0;
  let origCons = 0;
  let intendedReceiptValue = 0;
  let origReceiptValueNum = 0;
  let orig: { qty: number; rate: number } = { qty: 0, rate: 0 };
  let ratesAfter = rat(0n);
  for (const [i, mv] of source.affected.entries()) {
    const qd = Number(mv.qtyDelta);
    const leg = math.computeLegValue(b, qd, i === 0 ? Number(basis.receiptRate) : null);
    b = math.applyLedgerDelta(b, qd, leg.valueDelta);
    const qdR = parseRat(mv.qtyDelta);
    const rateR = i === 0 ? parseRat(basis.receiptRate) : oq.n === 0n ? rat(0n) : div(ov, oq);
    const dvR = mul(qdR, rateR);
    oq = add(oq, qdR);
    ov = add(ov, dvR);
    ratesAfter = oq.n === 0n ? rat(0n) : div(ov, oq);
    const row: ReplayRow = {
      ledgerId: mv.id,
      entryId: mv.entryId,
      qtyDelta: mv.qtyDelta,
      original: {
        valueDelta: mv.valueDelta,
        qtyAfter: mv.qtyAfter,
        valuationRate: mv.valuationRate,
      },
      intended: {
        valueDelta: eng(leg.valueDelta),
        qtyAfter: eng(b.qty),
        valuationRate: eng(b.rate),
      },
      oracle: {
        valueDelta: oracle(dvR, eng(leg.valueDelta), 'value'),
        qtyAfter: oracle(oq, eng(b.qty), 'qty'),
        valuationRate: oracle(ratesAfter, eng(b.rate), 'value'),
      },
    };
    outRows.push(row);
    if (!Object.values(row.oracle).every((o) => o.passed))
      replayErr.push(
        E('outside_numeric_oracle', 'replay', { entryId: mv.entryId, ledgerId: mv.id }),
      );
    if (i === 0) {
      intendedReceiptValue = leg.valueDelta;
      origReceiptValueNum = Number(mv.valueDelta);
    } else {
      interCons += -leg.valueDelta;
      origCons += -Number(mv.valueDelta);
      const c = (consumerFor.get(mv.entryId) ?? [])[0];
      const intended = -leg.valueDelta;
      const quantity = mv.qtyDelta.replace('-', '');
      const origCost = c.kind === 'stock_accrual' ? c.realizedValue : negateRaw(mv.valueDelta);
      const shown = c.kind === 'stock_accrual' ? math.round4(intended) : intended;
      cons.push({
        kind: c.kind,
        id: c.id,
        entryId: mv.entryId,
        originalCost: origCost,
        intendedCost: eng(shown),
        costDelta: eng(shown - Number(origCost)),
        quantity,
        oracle: oracle(mul(rat(-1n), dvR), eng(intended), 'value'),
      });
    }
    orig = { qty: Number(mv.qtyAfter), rate: Number(mv.valuationRate) };
  }
  if (replayErr.length) {
    const c = common(manifest, source, { ...cov, hypotheticalComplete: false }, doc, [
      ...all,
      ...replayErr,
    ]);
    return {
      ...c,
      mode: 'hypothetical_replay',
      outcome: 'integrity',
      complete: false,
      hypothetical: true,
      readiness: 'blocked',
      basisChoice: null,
      rows: [],
      consumerEffects: [],
      totals: null,
      checks: [...checks, ...doc.checks],
    } as ValuationReplayPlan;
  }
  const origRemaining = orig.qty * orig.rate;
  const intendedRemaining = b.qty * b.rate;
  const receiptDelta = intendedReceiptValue - origReceiptValueNum;
  const consumedDelta = interCons - origCons;
  const remainingDelta = intendedRemaining - origRemaining;
  const conservation = receiptDelta - (consumedDelta + remainingDelta);
  // per-row oracle tolerance accumulates linearly over the admitted rows
  const consTol = 1e-8 * Math.max(1, source.affected.length);
  const totals: ReplayTotals = {
    originalReceiptValue: rcv.valueDelta,
    intendedReceiptValue: eng(intendedReceiptValue),
    receiptValueDelta: eng(receiptDelta),
    originalConsumedValue: eng(origCons),
    intendedConsumedValue: eng(interCons),
    consumedValueDelta: eng(consumedDelta),
    originalRemainingValue: eng(origRemaining),
    intendedRemainingValue: eng(intendedRemaining),
    remainingValueDelta: eng(remainingDelta),
    terminalQty: source.affected[source.affected.length - 1].qtyAfter,
    intendedTerminalQty: eng(b.qty),
    conservationDifference: eng(Math.abs(conservation) === 0 ? 0 : conservation),
    quantityDifference: eng(Math.abs(b.qty - orig.qty) === 0 ? 0 : b.qty - orig.qty),
  };
  const qtyOk = Math.abs(b.qty - orig.qty) <= 1e-9;
  const consOk = Math.abs(conservation) <= consTol;
  checks.push(
    checkOf('baseline', 'matched', null, null),
    checkOf(
      'quantity_preservation',
      qtyOk ? 'matched' : 'mismatched',
      totals.terminalQty,
      totals.intendedTerminalQty,
    ),
    checkOf('conservation', consOk ? 'matched' : 'mismatched', '0', totals.conservationDifference),
    checkOf('latest_bin', 'matched', source.bin!.qty, totals.terminalQty),
    checkOf('source_consumers', 'matched', String(source.consumers.length), String(cons.length)),
  );
  if (!qtyOk || !consOk) {
    const c = common(manifest, source, { ...cov, hypotheticalComplete: false }, doc, [
      ...all,
      E(qtyOk ? 'conservation_failed' : 'quantity_mismatch', 'replay'),
    ]);
    return {
      ...c,
      mode: 'hypothetical_replay',
      outcome: 'integrity',
      complete: false,
      hypothetical: true,
      readiness: 'blocked',
      basisChoice: null,
      rows: [],
      consumerEffects: [],
      totals: null,
      checks: sortChecks(checks).concat(doc.checks),
    } as ValuationReplayPlan;
  }
  const c = common(manifest, source, cov, doc, all);
  return {
    ...c,
    mode: 'hypothetical_replay',
    outcome: 'complete',
    complete: true,
    hypothetical: true,
    readiness,
    basisChoice: basis,
    rows: outRows,
    consumerEffects: cons.sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id)),
    totals,
    checks: sortChecks([...checks, ...doc.checks]),
  } as ValuationReplayPlan;
}

function negateRaw(r: Raw): Raw {
  if (r.startsWith('-')) return r.slice(1);
  return /^0(\.0+)?$/.test(r) ? r : `-${r}`;
}

/** Strict-decoding combinators shared with the pure US3 logic module (no second schema vocabulary). */
export const wire = {
  str,
  label,
  re,
  uuid,
  digest,
  codeSha,
  seq,
  utc,
  raw,
  posDec,
  engine,
  currency,
  bool,
  int,
  lit,
  nul,
  arr,
  obj,
  union,
  target: targetV,
};
export { ratToDecimal as ratToDecimalString, eng as engineString };

/** Per-ticket financial digest shared by the diagnostic reader and the correction service (ticket row + its payments). */
export const ticketFinancialSha256 = (
  ticketRowText: string,
  paymentRowTexts: readonly string[],
): Digest =>
  sha256(canonical({ ticket: sha256(ticketRowText), payments: paymentRowTexts.map(sha256) }));
