/**
 * FACES stock reconciliation: pure evidence, decoders, exact decimal policy and the ordered classifier
 * (specs/122-faces-stock-reconciliation, contracts/{diagnostic-wire,report,source-explanation}.md).
 * No database, no application alias, no side effects: server code and the executing CLIs both import it.
 */
import { createHash } from 'node:crypto';
import type { QualifiedOperatorTarget } from './operator-principal';

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------
export type UUID = string;
export type Digest = string;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const DIGEST_RE = /^[0-9a-f]{64}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const LEDGER_ID_RE = /^[1-9][0-9]*$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export class ReconciliationError extends Error {
  constructor(readonly code: string) {
    super(`faces stock reconciliation refused: ${code}`);
    this.name = 'ReconciliationError';
  }
}
const fail = (code: string): never => {
  throw new ReconciliationError(code);
};

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const sha256Hex = (s: string): Digest =>
  createHash('sha256').update(s, 'utf8').digest('hex');
export const canonicalSha256 = (v: unknown): Digest => sha256Hex(canonicalJson(v));

export const cmpBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);
export const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Ledger identities are positive bigint decimal strings, ordered as BigInt and never as Number. */
export const cmpLedgerId = (a: string, b: string): number => cmpBig(BigInt(a), BigInt(b));
export function assertLedgerId(id: unknown): string {
  if (typeof id !== 'string' || !LEDGER_ID_RE.test(id)) return fail('ledger_id_invalid');
  return id;
}

// ---------------------------------------------------------------------------------------------
// Exact decimal policy (data-model.md "Exact diagnostic numeric policy")
// ---------------------------------------------------------------------------------------------
export interface Dec {
  c: bigint;
  s: number;
}
const DEC_RE = /^([+-]?)(\d+)(?:\.(\d*))?$|^([+-]?)\.(\d+)$/;
export const NUMERIC_CEILING = 1_000_000_000n;

const pow10 = (n: number): bigint => 10n ** BigInt(n);
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/** Finite base-10 string only; NaN, Infinity, exponents and magnitude above 1e9 are unsupported. */
export function parseDec(raw: unknown): Dec {
  if (typeof raw !== 'string') return fail('numeric_unsupported');
  const m = DEC_RE.exec(raw);
  if (!m) return fail('numeric_unsupported');
  const sign = (m[1] ?? m[4]) === '-' ? -1n : 1n;
  const int = m[2] ?? '0';
  const frac = m[3] ?? m[5] ?? '';
  const dec: Dec = { c: sign * BigInt(int + frac), s: frac.length };
  const abs = dec.c < 0n ? -dec.c : dec.c;
  if (abs > NUMERIC_CEILING * pow10(dec.s)) return fail('numeric_unsupported');
  return dec;
}
export const tryParseDec = (raw: unknown): Dec | null => {
  try {
    return parseDec(raw);
  } catch {
    return null;
  }
};
function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [a.c * pow10(s - a.s), b.c * pow10(s - b.s), s];
}
export const decAdd = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = align(a, b);
  return { c: x + y, s };
};
export const decNeg = (a: Dec): Dec => ({ c: -a.c, s: a.s });
export const decSub = (a: Dec, b: Dec): Dec => decAdd(a, decNeg(b));
export const decCmp = (a: Dec, b: Dec): number => {
  const [x, y] = align(a, b);
  return cmpBig(x, y);
};
export const decAbs = (a: Dec): Dec => ({ c: a.c < 0n ? -a.c : a.c, s: a.s });
export const DEC_ZERO: Dec = { c: 0n, s: 0 };
export function decToString(a: Dec): string {
  const neg = a.c < 0n;
  const digits = (neg ? -a.c : a.c).toString().padStart(a.s + 1, '0');
  const body = a.s === 0 ? digits : `${digits.slice(0, -a.s)}.${digits.slice(-a.s)}`;
  return neg ? `-${body}` : body;
}
/** Q(x) = floor(x * 10000 + 0.5) as a scaled integer (source round4 tie direction, negative ties included). */
export function q4(a: Dec): bigint {
  return floorDiv(2n * a.c * 10_000n + pow10(a.s), 2n * pow10(a.s));
}
export function fixed4(q: bigint): string {
  const neg = q < 0n;
  const d = (neg ? -q : q).toString().padStart(5, '0');
  return `${neg ? '-' : ''}${d.slice(0, -4)}.${d.slice(-4)}`;
}
export const q4OfString = (raw: string): bigint => q4(parseDec(raw));
export const sumDec = (values: Dec[]): Dec => values.reduce(decAdd, DEC_ZERO);

/** |a-b| <= 1e-8 + 1e-12*max(|a|,|b|), exact. `scale`d bound is multiplied by 1e12 so everything stays integral. */
export function withinScalarTolerance(
  a: Dec,
  b: Dec,
): { pass: boolean; difference: Dec; tolerance: Dec } {
  const diff = decAbs(decSub(a, b));
  const m = decCmp(decAbs(a), decAbs(b)) >= 0 ? decAbs(a) : decAbs(b);
  return toleranceResult(diff, m);
}
/** Aggregate form: bound uses sum(|contribution|) instead of the scalar maximum. */
export function withinAggregateTolerance(
  sum: Dec,
  expected: Dec,
  absContributions: Dec,
): { pass: boolean; difference: Dec; tolerance: Dec } {
  const diff = decAbs(decSub(sum, expected));
  const m = decCmp(absContributions, decAbs(expected)) >= 0 ? absContributions : decAbs(expected);
  return toleranceResult(diff, m);
}
function toleranceResult(diff: Dec, m: Dec) {
  // tolerance = 1e-8 + 1e-12*m, exact at scale m.s + 12.
  const tolerance: Dec = { c: pow10(m.s + 4) + m.c, s: m.s + 12 };
  return { pass: decCmp(diff, tolerance) <= 0, difference: diff, tolerance };
}

// ---------------------------------------------------------------------------------------------
// Tiny strict schema combinators (recursive unknown-key rejection, all keys required)
// ---------------------------------------------------------------------------------------------
type Dc<T> = (v: unknown) => T;
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export const dObj =
  <T>(shape: { [K in keyof T]: Dc<T[K]> }): Dc<T> =>
  (v) => {
    if (!isObj(v)) return fail('shape_invalid');
    const keys = Object.keys(shape);
    for (const k of Object.keys(v)) if (!keys.includes(k)) return fail('unknown_key');
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) return fail('missing_key');
      out[k] = (shape as Record<string, Dc<unknown>>)[k](v[k]);
    }
    return out as T;
  };
export const dArr =
  <T>(item: Dc<T>, max = 100_000): Dc<T[]> =>
  (v) => {
    if (!Array.isArray(v) || v.length > max) return fail('array_invalid');
    return v.map(item);
  };
export const dStr =
  (min = 0, max = 256): Dc<string> =>
  (v) => {
    if (typeof v !== 'string') return fail('string_invalid');
    if (v.length < min || Buffer.byteLength(v, 'utf8') > max) return fail('string_invalid');
    return v;
  };
export const dNfc =
  (min: number, max: number): Dc<string> =>
  (v) => {
    const s = dStr(0, max * 4)(v);
    const t = s.trim().normalize('NFC');
    if (t !== s || t.length < min || t.length > max) return fail('string_invalid');
    return t;
  };
export const dUuid: Dc<UUID> = (v) =>
  typeof v === 'string' && UUID_RE.test(v) ? v : fail('uuid_invalid');
export const dDigest: Dc<Digest> = (v) =>
  typeof v === 'string' && DIGEST_RE.test(v) ? v : fail('digest_invalid');
export const dSha40: Dc<string> = (v) =>
  typeof v === 'string' && SHA40_RE.test(v) ? v : fail('sha_invalid');
export const dBool: Dc<boolean> = (v) => (typeof v === 'boolean' ? v : fail('boolean_invalid'));
export const dInt: Dc<number> = (v) =>
  Number.isSafeInteger(v) ? (v as number) : fail('integer_invalid');
export const dUtc: Dc<string> = (v) =>
  typeof v === 'string' && UTC_RE.test(v) && !Number.isNaN(Date.parse(v))
    ? v
    : fail('instant_invalid');
export const dLedgerId: Dc<string> = (v) => assertLedgerId(v);
export const dEnum =
  <T extends string>(...values: T[]): Dc<T> =>
  (v) =>
    values.includes(v as T) ? (v as T) : fail('enum_invalid');
export const dNullable =
  <T>(inner: Dc<T>): Dc<T | null> =>
  (v) =>
    v === null ? null : inner(v);
export const dNumStr: Dc<string> = (v) => (parseDec(v), v as string);
/** Raw PostgreSQL numeric spelling retained verbatim; unparseable/overlarge input is rejected. */
export const dAny: Dc<unknown> = (v) => v;

const dTarget: Dc<QualifiedOperatorTarget> = dObj<QualifiedOperatorTarget>({
  databaseIdentity: dDigest,
  authProject: dStr(1, 256),
  authUrl: dStr(1, 512),
});
export const decodeQualifiedTarget = dTarget;

// ---------------------------------------------------------------------------------------------
// Diagnostic manifest (diagnostic-wire.md "Input and reference primitives")
// ---------------------------------------------------------------------------------------------
export type SourceKind =
  | 'pos_ticket'
  | 'pos_ticket_line'
  | 'payment'
  | 'booking_product'
  | 'booking'
  | 'booking_group'
  | 'booking_status'
  | 'grant'
  | 'redemption'
  | 'invoice'
  | 'accrual'
  | 'stock_entry'
  | 'stock_line'
  | 'ledger'
  | 'stock_item'
  | 'warehouse'
  | 'product'
  | 'correction';
const SOURCE_KINDS: SourceKind[] = [
  'pos_ticket',
  'pos_ticket_line',
  'payment',
  'booking_product',
  'booking',
  'booking_group',
  'booking_status',
  'grant',
  'redemption',
  'invoice',
  'accrual',
  'stock_entry',
  'stock_line',
  'ledger',
  'stock_item',
  'warehouse',
  'product',
  'correction',
];
export type SourceRef = { kind: SourceKind; id: string };
const dRefId: Dc<string> = dStr(1, 400);
export const dSourceRef: Dc<SourceRef> = (v) => {
  const r = dObj<SourceRef>({ kind: dEnum(...SOURCE_KINDS), id: dRefId })(v);
  if (r.kind === 'ledger') assertLedgerId(r.id);
  else if (r.kind === 'booking_group') {
    if (!/^[0-9a-f-]{36}\/.+/.test(r.id) || !UUID_RE.test(r.id.slice(0, 36)))
      return fail('ref_invalid');
  } else if (!UUID_RE.test(r.id)) return fail('ref_invalid');
  return r;
};
export const refKey = (r: SourceRef): string => `${r.kind}:${r.id}`;
export const cmpRef = (a: SourceRef, b: SourceRef): number =>
  a.kind !== b.kind
    ? cmpStr(a.kind, b.kind)
    : a.kind === 'ledger'
      ? cmpLedgerId(a.id, b.id)
      : cmpStr(a.id, b.id);

export type ExpectedComponent = {
  source: { kind: 'pos_ticket' | 'pos_ticket_line' | 'booking'; id: UUID };
  itemId: UUID;
  warehouseId: UUID;
  intendedStockQty: string;
  stockUom: string;
  fulfilled: boolean;
  trueUpCoverage: 'not_covered' | 'covered' | 'unknown';
};
const dFixed4 =
  (max: number): Dc<string> =>
  (v) => {
    if (typeof v !== 'string' || !new RegExp(`^\\d{1,${max}}\\.\\d{4}$`).test(v))
      return fail('fixed4_invalid');
    return v;
  };
const dExpected = dObj<ExpectedComponent>({
  source: dObj({
    kind: dEnum<'pos_ticket' | 'pos_ticket_line' | 'booking'>(
      'pos_ticket',
      'pos_ticket_line',
      'booking',
    ),
    id: dUuid,
  }),
  itemId: dUuid,
  warehouseId: dUuid,
  intendedStockQty: dFixed4(9),
  stockUom: dNfc(1, 80),
  fulfilled: dBool,
  trueUpCoverage: dEnum('not_covered', 'covered', 'unknown'),
});
export const SURFACES = [
  'booking_hover',
  'booking_detail',
  'pos_ticket_detail',
  'stock_movement_list',
  'stock_item_ledger',
] as const;
export type ProjectionObservation = {
  surface: (typeof SURFACES)[number];
  source: SourceRef;
  productId: UUID | null;
  itemId: UUID | null;
  warehouseId: UUID | null;
  presence: 'shown' | 'omitted';
  qty: string | null;
  stockUom: string | null;
  observedAt: string;
  appSourceSha: string | null;
};
export type ProjectionAssertion = {
  kind: 'projection_comparison';
  componentKey: string;
  sourceEvidenceSha256: Digest;
  verifiedByProfileId: UUID;
  verifiedAt: string;
  observations: ProjectionObservation[];
};
const dObservation: Dc<ProjectionObservation> = (v) => {
  const o = dObj<ProjectionObservation>({
    surface: dEnum(...SURFACES),
    source: dSourceRef,
    productId: dNullable(dUuid),
    itemId: dNullable(dUuid),
    warehouseId: dNullable(dUuid),
    presence: dEnum('shown', 'omitted'),
    qty: dNullable(dStr(1, 40)),
    stockUom: dNullable(dNfc(1, 80)),
    observedAt: dUtc,
    appSourceSha: dNullable(dSha40),
  })(v);
  if (!o.productId && !o.itemId) return fail('projection_identity_missing');
  if (o.presence === 'omitted' && (o.qty !== null || o.stockUom !== null))
    return fail('projection_omitted_has_qty');
  if (o.presence === 'shown') {
    if (o.qty === null || !/^\d{1,9}(\.\d+)?$/.test(o.qty) || o.stockUom === null)
      return fail('projection_qty_invalid');
    parseDec(o.qty);
  }
  return o;
};
const dProjection: Dc<ProjectionAssertion> = (v) => {
  const p = dObj<ProjectionAssertion>({
    kind: dEnum<'projection_comparison'>('projection_comparison'),
    componentKey: dStr(1, 400),
    sourceEvidenceSha256: dDigest,
    verifiedByProfileId: dUuid,
    verifiedAt: dUtc,
    observations: dArr(dObservation, 5),
  })(v);
  if (p.observations.length < 2) return fail('projection_observations');
  if (new Set(p.observations.map((o) => o.surface)).size !== p.observations.length)
    return fail('projection_surface_duplicate');
  if (p.observations.some((o) => Date.parse(o.observedAt) > Date.parse(p.verifiedAt)))
    return fail('projection_observed_after_verified');
  return p;
};
export type DiagnosticEvidenceRef = {
  referenceId: UUID;
  kind: 'document' | 'owner_attestation' | 'prior_correction';
  sha256: Digest;
  privateRef: string;
  correctionId: UUID | null;
  assertion:
    | null
    | {
        kind: 'expected_component';
        component: ExpectedComponent;
        verifiedByProfileId: UUID;
        verifiedAt: string;
      }
    | ProjectionAssertion;
};
const dAssertion: Dc<DiagnosticEvidenceRef['assertion']> = (v) => {
  if (v === null) return null;
  if (isObj(v) && v.kind === 'projection_comparison') return dProjection(v);
  return dObj({
    kind: dEnum<'expected_component'>('expected_component'),
    component: dExpected,
    verifiedByProfileId: dUuid,
    verifiedAt: dUtc,
  })(v);
};
const dEvidenceRef: Dc<DiagnosticEvidenceRef> = (v) => {
  const r = dObj<DiagnosticEvidenceRef>({
    referenceId: dUuid,
    kind: dEnum('document', 'owner_attestation', 'prior_correction'),
    sha256: dDigest,
    privateRef: dNfc(1, 256),
    correctionId: dNullable(dUuid),
    assertion: dAssertion,
  })(v);
  if (
    r.kind === 'prior_correction'
      ? r.correctionId === null || r.assertion !== null
      : r.correctionId !== null
  )
    return fail('evidence_ref_invalid');
  if (r.assertion?.kind === 'projection_comparison' && r.kind === 'prior_correction')
    return fail('evidence_ref_invalid');
  return r;
};
export type DiagnosticCase = {
  caseKey: string;
  bookingIds: UUID[];
  ticketIds: UUID[];
  itemIds: UUID[];
  identityUnresolved: boolean;
  searchHint: null | { description: string };
  dateHints: null | { after: string | null; before: string | null; timezone: string };
  evidenceRefs: DiagnosticEvidenceRef[];
};
export type DiagnosticManifestV1 = {
  schemaVersion: 1;
  target: QualifiedOperatorTarget;
  actorProfileId: UUID;
  cases: DiagnosticCase[];
};
const dDate: Dc<string> = (v) => {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  )
    return fail('date_invalid');
  return v;
};
const validZone = (z: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
};
const dUuidSet: Dc<UUID[]> = (v) => [...new Set(dArr(dUuid, 100)(v))].sort(cmpStr);
const dCase: Dc<DiagnosticCase> = (v) => {
  const c = dObj<DiagnosticCase>({
    caseKey: dNfc(1, 100),
    bookingIds: dUuidSet,
    ticketIds: dUuidSet,
    itemIds: dUuidSet,
    identityUnresolved: dBool,
    searchHint: dNullable(dObj({ description: dNfc(1, 500) })),
    dateHints: dNullable(
      dObj({ after: dNullable(dDate), before: dNullable(dDate), timezone: dStr(1, 64) }),
    ),
    evidenceRefs: dArr(dEvidenceRef, 1000),
  })(v);
  const ids = c.bookingIds.length + c.ticketIds.length + c.itemIds.length;
  if (ids === 0 && !(c.identityUnresolved && c.searchHint)) return fail('case_has_no_identity');
  if (c.dateHints) {
    const { after, before, timezone } = c.dateHints;
    if (after === null && before === null) return fail('date_hint_empty');
    if (after !== null && before !== null && !(after < before)) return fail('date_hint_order');
    if (!validZone(timezone)) return fail('date_hint_timezone');
  }
  return c;
};
export const MANIFEST_MAX_BYTES = 1_048_576;
export function decodeDiagnosticManifestV1(value: unknown): DiagnosticManifestV1 {
  if (Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') > MANIFEST_MAX_BYTES)
    return fail('manifest_too_large');
  const m = dObj<DiagnosticManifestV1>({
    schemaVersion: (v) => (v === 1 ? 1 : fail('schema_version')),
    target: dTarget,
    actorProfileId: dUuid,
    cases: dArr(dCase, 100),
  })(value);
  if (new Set(m.cases.map((c) => c.caseKey)).size !== m.cases.length)
    return fail('case_key_duplicate');
  const refs = m.cases.flatMap((c) => c.evidenceRefs.map((r) => r.referenceId));
  if (new Set(refs).size !== refs.length) return fail('reference_id_duplicate');
  const distinct = new Set(m.cases.flatMap((c) => [...c.bookingIds, ...c.ticketIds, ...c.itemIds]));
  if (distinct.size > 1000) return fail('too_many_ids');
  return m;
}

// ---------------------------------------------------------------------------------------------
// Stock entry source decoder (source-explanation.md "Stock entry source decoder")
// ---------------------------------------------------------------------------------------------
export type StockEntrySource =
  | { kind: 'pos'; id: UUID }
  | { kind: 'booking'; id: UUID }
  | { kind: 'invoice'; id: UUID }
  | { kind: 'service'; id: UUID | null; finProductId: UUID | null }
  | { kind: 'purchase'; id: UUID }
  | {
      kind: 'manual_reconciliation';
      label: 'repair-opening-balance' | 'analyst-reconciliation-2026-08';
    }
  | { kind: 'none' }
  | { kind: 'unknown'; metadataSha256: Digest };

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const has = (m: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(m, k);

/**
 * The only way F1 derives an entry's source. `metadataSha256` is `sha256(metadata::text)` computed in PostgreSQL;
 * pure fixtures may omit it and get the canonical-JSON digest. Raw metadata never leaves this function.
 * Decisions (spec 122 review F1-R6-IR-01): an opening-balance RECEIPT `{source:'repair-opening-balance'}`
 * (scripts/repair-stock-valuation.ts) is manual_reconciliation; invoice ids are matched like the live unique index,
 * `lower(btrim(metadata->>'invoiceId'))`, so uppercase/padded legacy ids decode to the lowercase canonical id.
 */
export function decodeStockEntrySource(
  type: string,
  metadata: unknown,
  metadataSha256?: Digest,
): StockEntrySource {
  const unknown = (): StockEntrySource => ({
    kind: 'unknown',
    metadataSha256: metadataSha256 ?? canonicalSha256(metadata ?? null),
  });
  if (!isObj(metadata)) return unknown();
  const m = metadata;
  const source = m.source;
  const sourceId = m.sourceId;
  if (type === 'issue' && source === 'pos') {
    if (!isUuid(sourceId)) return unknown();
    if (has(m, 'ticketId') && m.ticketId !== sourceId) return unknown();
    return { kind: 'pos', id: sourceId };
  }
  if (type === 'issue' && source === 'booking') {
    return isUuid(sourceId) ? { kind: 'booking', id: sourceId } : unknown();
  }
  if (type === 'issue' && source === 'invoice') {
    const raw = m.invoiceId;
    const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return UUID_RE.test(id) ? { kind: 'invoice', id } : unknown();
  }
  if (type === 'issue' && source === 'service') {
    if (
      (has(m, 'sourceId') && !isUuid(sourceId)) ||
      (has(m, 'finProductId') && !isUuid(m.finProductId))
    )
      return unknown();
    return {
      kind: 'service',
      id: isUuid(sourceId) ? sourceId : null,
      finProductId: isUuid(m.finProductId) ? m.finProductId : null,
    };
  }
  if (type === 'receipt' && !has(m, 'source') && has(m, 'purchaseId')) {
    return isUuid(m.purchaseId) ? { kind: 'purchase', id: m.purchaseId } : unknown();
  }
  if (type === 'receipt' && source === 'repair-opening-balance') {
    return { kind: 'manual_reconciliation', label: 'repair-opening-balance' };
  }
  if (
    type === 'adjustment' &&
    m.reconciliation === true &&
    (source === 'repair-opening-balance' || source === 'analyst-reconciliation-2026-08')
  ) {
    return { kind: 'manual_reconciliation', label: source };
  }
  if (!has(m, 'source') && !has(m, 'sourceId') && !has(m, 'invoiceId') && !has(m, 'purchaseId')) {
    return { kind: 'none' };
  }
  return unknown();
}

// ---------------------------------------------------------------------------------------------
// Output types and strict report decoder (diagnostic-wire.md "Exact output primitives")
// ---------------------------------------------------------------------------------------------
export type Classification =
  | 'duplicate'
  | 'missing_realization'
  | 'variant_mismatch'
  | 'display_only'
  | 'valid'
  | 'unresolved';
const CLASSIFICATIONS: Classification[] = [
  'duplicate',
  'missing_realization',
  'variant_mismatch',
  'display_only',
  'valid',
  'unresolved',
];
export const REASONS = [
  'duplicate_net_issue',
  'missing_net_issue',
  'wrong_variant_issue',
  'display_multiplicity_only',
  'stock_matches_intent',
  'identity_unresolved',
  'identity_ambiguous',
  'no_stable_ids',
  'source_ownership_ambiguous',
  'expected_effect_unknown',
  'true_up_coverage_unknown',
  'true_up_already_covered',
  'evidence_conflict',
  'evidence_unverified',
  'incomplete_read',
  'unsupported_shape',
  'numeric_unsupported',
  'integrity_failed',
  'mixed_discrepancies',
  'mapping_not_qualified',
  'owner_confirmation_missing',
  'stock_source_unknown',
  'projection_unverified',
  'projection_conflict',
  'projection_source_changed',
  'projection_identity_unavailable',
] as const;
export type Reason = (typeof REASONS)[number];
export type Coverage = {
  sourceGraphComplete: boolean;
  ledgerHistoryComplete: boolean;
  openingKnown: boolean;
  fulfillmentKnown: boolean;
  trueUpCoverage: 'not_covered' | 'covered' | 'unknown';
};
export const ERROR_CODES = [
  'scope_unavailable',
  'schema_unavailable',
  'read_failed',
  'timeout',
  'capacity',
  'stock_integrity_failed',
  'unsupported_numeric',
  'provenance_incomplete',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type DiagnosticError = { code: ErrorCode; caseKey: string | null; ref: SourceRef | null };
export type ComponentRow = {
  componentKey: string;
  source: SourceRef;
  itemId: UUID;
  warehouseId: UUID;
  intendedQty: string | null;
  stockUom: string | null;
  actualIssuedQty: string | null;
  actualValue: string | null;
  classification: Classification;
  reasonCodes: Reason[];
  evidenceReferenceIds: UUID[];
  ledgerIds: string[];
};
export type SecondaryFinding = {
  kind: Exclude<Classification, 'unresolved'>;
  componentKey: string;
  intendedQty: string | null;
  actualQty: string | null;
  evidenceRefs: UUID[];
  reason: Reason;
};
export type CaseRow = {
  caseKey: string;
  candidateIds: { bookingIds: UUID[]; ticketIds: UUID[]; itemIds: UUID[] };
  sources: SourceRef[];
  identityState: 'matched' | 'ambiguous' | 'unmatched';
  classification: Classification;
  reasonCodes: Reason[];
  coverage: Coverage;
  components: ComponentRow[];
  secondaryFindings: SecondaryFinding[];
  evidenceReferenceIds: UUID[];
  priorCorrectionIds: UUID[];
  repairEligible: boolean;
  hint: { state: 'none' | 'withheld_private_input'; sha256: Digest | null };
};
export type MovementEvidence = {
  ledgerId: string;
  entryId: UUID;
  entryState: 'draft' | 'submitted' | 'cancelled' | 'unavailable';
  entryType: 'receipt' | 'issue' | 'transfer' | 'adjustment' | 'unavailable';
  itemId: UUID;
  warehouseId: UUID;
  qtyDelta: string;
  valueDelta: string;
  qtyAfter: string;
  valuationRate: string;
  postedAt: string;
  sourceRefs: SourceRef[];
};
export type GraphNode = {
  ref: SourceRef;
  state: 'available' | 'missing_or_unavailable';
  rowSha256: Digest | null;
};
export type GraphEdge = {
  from: SourceRef;
  to: SourceRef;
  relation: 'owns' | 'links' | 'realizes' | 'reverses' | 'supersedes' | 'recipe' | 'covers';
};
export type NumericCheck = {
  caseKey: string | null;
  itemId: UUID;
  warehouseId: UUID;
  family: 'quantity' | 'value' | 'rate';
  actual: string | null;
  expected: string | null;
  normalizedActual: string | null;
  normalizedExpected: string | null;
  difference: string | null;
  tolerance: string | null;
  result: 'pass' | 'fail' | 'unknown';
};
export type KeyTotal = {
  itemId: UUID;
  warehouseId: UUID;
  ledgerQtySum: string;
  ledgerValueSum: string;
  latestLedgerId: string | null;
  latestQty: string | null;
  latestRate: string | null;
  binExists: boolean;
  binQty: string | null;
  binRate: string | null;
  integrity: 'pass' | 'fail';
};

export type WarningEvidence = {
  state: 'none' | 'present' | 'unavailable';
  code: string | null;
  sourceSha256: Digest | null;
  draftEntryId: UUID | null;
  items: { itemId: UUID; requested: string; available: string }[];
};
const dWarning = dObj<WarningEvidence>({
  state: dEnum('none', 'present', 'unavailable'),
  code: dNullable((v) =>
    typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(v) ? v : fail('warning_code'),
  ),
  sourceSha256: dNullable(dDigest),
  draftEntryId: dNullable(dUuid),
  items: dArr(dObj({ itemId: dUuid, requested: dNumStr, available: dNumStr }), 1000),
});
const dSourceEntry: Dc<StockEntrySource> = (v) => {
  if (!isObj(v)) return fail('shape_invalid');
  switch (v.kind) {
    case 'pos':
    case 'booking':
    case 'invoice':
    case 'purchase':
      return dObj({ kind: dEnum(v.kind as 'pos'), id: dUuid })(v) as StockEntrySource;
    case 'service':
      return dObj({
        kind: dEnum<'service'>('service'),
        id: dNullable(dUuid),
        finProductId: dNullable(dUuid),
      })(v);
    case 'manual_reconciliation':
      return dObj({
        kind: dEnum<'manual_reconciliation'>('manual_reconciliation'),
        label: dEnum('repair-opening-balance' as const, 'analyst-reconciliation-2026-08' as const),
      })(v);
    case 'none':
      return dObj({ kind: dEnum<'none'>('none') })(v);
    case 'unknown':
      return dObj({ kind: dEnum<'unknown'>('unknown'), metadataSha256: dDigest })(v);
    default:
      return fail('enum_invalid');
  }
};
const S = dStr(0, 256);
const N = dNullable;
const dTs = dUtc;
/** Closed SourceValue shapes, one per `kind`. */
const VALUE_SHAPES: Record<string, Dc<unknown>> = {
  ticket: dObj({
    kind: dEnum<'ticket'>('ticket'),
    status: S,
    submittedAt: dTs,
    voidedAt: N(dTs),
    currency: S,
    total: dNumStr,
    stockEntryId: N(dUuid),
    warning: dWarning,
  }),
  sale_line: dObj({
    kind: dEnum<'sale_line'>('sale_line'),
    ticketId: dUuid,
    lineKind: S,
    finProductId: N(dUuid),
    bookingId: N(dUuid),
    qty: dNumStr,
    unitPrice: dNumStr,
    discount: dNumStr,
    total: dNumStr,
    lineNo: dInt,
    planId: N(dUuid),
    redemptionId: N(dUuid),
  }),
  payment: dObj({
    kind: dEnum<'payment'>('payment'),
    ticketId: dUuid,
    paidAt: dTs,
    amount: dNumStr,
    method: S,
    currency: S,
  }),
  booking: dObj({
    kind: dEnum<'booking'>('booking'),
    status: S,
    resourceId: dUuid,
    startTime: dTs,
    endTime: dTs,
    createdAt: dTs,
    updatedAt: dTs,
    productId: N(dUuid),
    eventTypeId: dUuid,
    groupId: N(dStr(1, 256)),
    rescheduledFromId: N(dUuid),
    invoiceId: N(dUuid),
    packageGrantId: N(dUuid),
    paymentPlanId: N(dUuid),
  }),
  booking_product: dObj({
    kind: dEnum<'booking_product'>('booking_product'),
    bookingId: dUuid,
    productId: dUuid,
    qty: dNumStr,
    createdAt: dTs,
    updatedAt: dTs,
  }),
  booking_group: dObj({
    kind: dEnum<'booking_group'>('booking_group'),
    resourceId: dUuid,
    groupId: dStr(1, 256),
    memberIds: dArr(dUuid, 1000),
  }),
  booking_status: dObj({
    kind: dEnum<'booking_status'>('booking_status'),
    bookingId: dUuid,
    fromStatus: N(S),
    toStatus: S,
    changedBy: N(dUuid),
    changedAt: dTs,
  }),
  invoice: dObj({ kind: dEnum<'invoice'>('invoice'), providerRef: N(S) }),
  accrual: dObj({
    kind: dEnum<'accrual'>('accrual'),
    source: S,
    sourceId: dUuid,
    finProductId: N(dUuid),
    itemId: dUuid,
    warehouseId: dUuid,
    status: dEnum('open', 'realized', 'released'),
    qtyConsumption: dNumStr,
    qty: dNumStr,
    realizedEntryId: N(dUuid),
    realizedQty: N(dNumStr),
    realizedValue: N(dNumStr),
    createdAt: dTs,
    updatedAt: dTs,
    realizedAt: N(dTs),
    releasedAt: N(dTs),
  }),
  stock_entry: dObj({
    kind: dEnum<'stock_entry'>('stock_entry'),
    type: dEnum('receipt', 'issue', 'transfer', 'adjustment'),
    status: dEnum('draft', 'submitted', 'cancelled'),
    createdAt: dTs,
    updatedAt: dTs,
    postedAt: N(dTs),
    source: dSourceEntry,
  }),
  stock_line: dObj({
    kind: dEnum<'stock_line'>('stock_line'),
    entryId: dUuid,
    itemId: dUuid,
    qty: dNumStr,
    uom: N(S),
    rate: N(dNumStr),
    fromWarehouseId: N(dUuid),
    toWarehouseId: N(dUuid),
    lineNo: dInt,
  }),
  grant: dObj({
    kind: dEnum<'grant'>('grant'),
    sourceTicketId: dUuid,
    sourceLineId: dUuid,
    packageProductId: dUuid,
    serviceProductId: dUuid,
    sessionsTotal: dInt,
    unitValue: dNumStr,
    expiresAt: N(dStr(10, 10)),
    status: S,
    createdAt: dTs,
    cancelledAt: N(dTs),
  }),
  redemption: dObj({
    kind: dEnum<'redemption'>('redemption'),
    grantId: dUuid,
    bookingId: N(dUuid),
    ticketId: N(dUuid),
    ticketLineId: N(dUuid),
    redeemedAt: dTs,
    reversedAt: N(dTs),
  }),
  correction: dObj({
    kind: dEnum<'correction'>('correction'),
    correctionKind: dEnum(
      'sale_variant',
      'sale_stock_repost',
      'receipt_replace',
      'product_mapping',
      'receipt_chain',
    ),
    sourceType: dEnum('pos_ticket_line', 'stock_receipt', 'fin_product'),
    sourceId: dUuid,
    sourceEntryId: N(dUuid),
    replacementEntryId: N(dUuid),
    appliedAt: dTs,
  }),
};
const REF_TO_VALUE_KIND: Record<string, string> = {
  pos_ticket: 'ticket',
  pos_ticket_line: 'sale_line',
  payment: 'payment',
  booking: 'booking',
  booking_product: 'booking_product',
  booking_group: 'booking_group',
  booking_status: 'booking_status',
  invoice: 'invoice',
  accrual: 'accrual',
  stock_entry: 'stock_entry',
  stock_line: 'stock_line',
  grant: 'grant',
  redemption: 'redemption',
  correction: 'correction',
};
export type SourceValue = Record<string, unknown> & { kind: string };
export type SourceEvidenceRow =
  | { ref: SourceRef; state: 'available'; rowSha256: Digest; value: SourceValue }
  | { ref: SourceRef; state: 'missing_or_unavailable'; rowSha256: null; value: null };
const dSourceEvidenceRow: Dc<SourceEvidenceRow> = (v) => {
  if (!isObj(v)) return fail('shape_invalid');
  const ref = dSourceRef(v.ref);
  if (v.state === 'missing_or_unavailable')
    return dObj({
      ref: dSourceRef,
      state: dEnum<'missing_or_unavailable'>('missing_or_unavailable'),
      rowSha256: (x) => (x === null ? null : fail('shape_invalid')),
      value: (x) => (x === null ? null : fail('shape_invalid')),
    })(v) as SourceEvidenceRow;
  const expectKind = REF_TO_VALUE_KIND[ref.kind];
  if (!expectKind || !isObj(v.value) || v.value.kind !== expectKind || !VALUE_SHAPES[expectKind])
    return fail('ref_value_mismatch');
  return dObj({
    ref: dSourceRef,
    state: dEnum<'available'>('available'),
    rowSha256: dDigest,
    value: VALUE_SHAPES[expectKind] as Dc<SourceValue>,
  })(v) as SourceEvidenceRow;
};
export type TimelineRow = {
  ref: SourceRef;
  field: string;
  at: string | null;
  meaning: 'stored_source_time' | 'current_state_observation' | 'timestamp_unavailable';
};
const TIMELINE_FIELDS = [
  'submitted_at',
  'voided_at',
  'paid_at',
  'start_time',
  'end_time',
  'created_at',
  'updated_at',
  'changed_at',
  'posted_at',
  'realized_at',
  'released_at',
  'cancelled_at',
  'redeemed_at',
  'reversed_at',
  'applied_at',
  'state_observed',
];
export type ProjectionEvidenceResult = {
  referenceId: UUID | null;
  componentKey: string;
  state: 'admitted' | 'not_provided' | 'unavailable' | 'conflicting';
  observations: ProjectionObservation[];
  reason:
    | 'matched_source_capture'
    | 'projection_unverified'
    | 'projection_source_changed'
    | 'projection_identity_unavailable'
    | 'projection_conflict';
};

const dCoverage = dObj<Coverage>({
  sourceGraphComplete: dBool,
  ledgerHistoryComplete: dBool,
  openingKnown: dBool,
  fulfillmentKnown: dBool,
  trueUpCoverage: dEnum('not_covered', 'covered', 'unknown'),
});
const dClass = dEnum<Classification>(...CLASSIFICATIONS);
const dReason = dEnum<Reason>(...REASONS);
const dEntryState = dEnum('draft', 'submitted', 'cancelled', 'unavailable');
const dEntryType = dEnum('receipt', 'issue', 'transfer', 'adjustment', 'unavailable');
const dLabel = (id: string) => dObj({ [id]: dUuid, name: dNullable(dStr(0, 1024)) } as never);
const dCaseRow = dObj<CaseRow>({
  caseKey: dNfc(1, 100),
  candidateIds: dObj({
    bookingIds: dArr(dUuid, 100),
    ticketIds: dArr(dUuid, 100),
    itemIds: dArr(dUuid, 100),
  }),
  sources: dArr(dSourceRef),
  identityState: dEnum('matched', 'ambiguous', 'unmatched'),
  classification: dClass,
  reasonCodes: dArr(dReason, 64),
  coverage: dCoverage,
  components: dArr(
    dObj<ComponentRow>({
      componentKey: dStr(1, 400),
      source: dSourceRef,
      itemId: dUuid,
      warehouseId: dUuid,
      intendedQty: dNullable(dNumStr),
      stockUom: dNullable(dStr(1, 256)),
      actualIssuedQty: dNullable(dNumStr),
      actualValue: dNullable(dNumStr),
      classification: dClass,
      reasonCodes: dArr(dReason, 64),
      evidenceReferenceIds: dArr(dUuid),
      ledgerIds: dArr(dLedgerId),
    }),
  ),
  secondaryFindings: dArr(
    dObj<SecondaryFinding>({
      kind: dEnum('duplicate', 'missing_realization', 'variant_mismatch', 'display_only', 'valid'),
      componentKey: dStr(1, 400),
      intendedQty: dNullable(dNumStr),
      actualQty: dNullable(dNumStr),
      evidenceRefs: dArr(dUuid),
      reason: dReason,
    }),
  ),
  evidenceReferenceIds: dArr(dUuid),
  priorCorrectionIds: dArr(dUuid),
  repairEligible: dBool,
  hint: dObj({ state: dEnum('none', 'withheld_private_input'), sha256: dNullable(dDigest) }),
});
export type ReconciliationReport = {
  schemaVersion: 1;
  mode: 'read-only';
  orgId: UUID;
  actorProfileId: UUID;
  target: QualifiedOperatorTarget;
  source: { gitSha: string; deploymentVerified: false };
  observedAt: string;
  snapshot: null | {
    id: string;
    startedAt: string;
    role: 'app_ledger';
    orgId: UUID;
    profileId: UUID;
    readOnly: true;
  };
  scope: {
    caseKeys: string[];
    itemWarehouseKeys: { itemId: UUID; warehouseId: UUID }[];
    dateHintsApplied: false;
  };
  evidenceCoverage: Coverage;
  cases: CaseRow[];
  ledger: MovementEvidence[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  sourceEvidence: SourceEvidenceRow[];
  timeline: TimelineRow[];
  sourceEvidenceSha256: Digest | null;
  projectionEvidence: ProjectionEvidenceResult[];
  labels: {
    items: { itemId: UUID; name: string | null; code: string | null }[];
    products: { productId: UUID; name: string | null }[];
    warehouses: { warehouseId: UUID; name: string | null }[];
  };
  totals: KeyTotal[];
  numericChecks: NumericCheck[];
  errors: DiagnosticError[];
  outcome: 'complete' | 'integrity_failed' | 'incomplete';
  complete: boolean;
};
export function decodeReconciliationReport(value: unknown): ReconciliationReport {
  const r = dObj<ReconciliationReport>({
    schemaVersion: (v) => (v === 1 ? 1 : fail('schema_version')),
    mode: dEnum<'read-only'>('read-only'),
    orgId: dUuid,
    actorProfileId: dUuid,
    target: dTarget,
    source: dObj({
      gitSha: dSha40,
      deploymentVerified: (v) => (v === false ? false : fail('shape_invalid')),
    }),
    observedAt: dUtc,
    snapshot: dNullable(
      dObj({
        id: dStr(1, 200),
        startedAt: dUtc,
        role: dEnum<'app_ledger'>('app_ledger'),
        orgId: dUuid,
        profileId: dUuid,
        readOnly: (v) => (v === true ? true : fail('shape_invalid')),
      }),
    ),
    scope: dObj({
      caseKeys: dArr(dStr(1, 400), 100),
      itemWarehouseKeys: dArr(dObj({ itemId: dUuid, warehouseId: dUuid }), 1000),
      dateHintsApplied: (v) => (v === false ? false : fail('shape_invalid')),
    }),
    evidenceCoverage: dCoverage,
    cases: dArr(dCaseRow, 100),
    ledger: dArr(
      dObj<MovementEvidence>({
        ledgerId: dLedgerId,
        entryId: dUuid,
        entryState: dEntryState,
        entryType: dEntryType,
        itemId: dUuid,
        warehouseId: dUuid,
        qtyDelta: dNumStr,
        valueDelta: dNumStr,
        qtyAfter: dNumStr,
        valuationRate: dNumStr,
        postedAt: dUtc,
        sourceRefs: dArr(dSourceRef),
      }),
      50_000,
    ),
    graph: dObj({
      nodes: dArr(
        dObj<GraphNode>({
          ref: dSourceRef,
          state: dEnum('available', 'missing_or_unavailable'),
          rowSha256: dNullable(dDigest),
        }),
      ),
      edges: dArr(
        dObj<GraphEdge>({
          from: dSourceRef,
          to: dSourceRef,
          relation: dEnum(
            'owns',
            'links',
            'realizes',
            'reverses',
            'supersedes',
            'recipe',
            'covers',
          ),
        }),
      ),
    }),
    sourceEvidence: dArr(dSourceEvidenceRow),
    timeline: dArr(
      dObj<TimelineRow>({
        ref: dSourceRef,
        field: (v) =>
          TIMELINE_FIELDS.includes(v as string) ? (v as string) : fail('enum_invalid'),
        at: dNullable(dUtc),
        meaning: dEnum('stored_source_time', 'current_state_observation', 'timestamp_unavailable'),
      }),
    ),
    sourceEvidenceSha256: dNullable(dDigest),
    projectionEvidence: dArr(
      dObj<ProjectionEvidenceResult>({
        referenceId: dNullable(dUuid),
        componentKey: dStr(1, 400),
        state: dEnum('admitted', 'not_provided', 'unavailable', 'conflicting'),
        observations: dArr(dObservation, 5),
        reason: dEnum(
          'matched_source_capture',
          'projection_unverified',
          'projection_source_changed',
          'projection_identity_unavailable',
          'projection_conflict',
        ),
      }),
    ),
    labels: dObj({
      items: dArr(
        dObj({ itemId: dUuid, name: dNullable(dStr(0, 1024)), code: dNullable(dStr(0, 1024)) }),
      ),
      products: dArr(dObj({ productId: dUuid, name: dNullable(dStr(0, 1024)) })),
      warehouses: dArr(dObj({ warehouseId: dUuid, name: dNullable(dStr(0, 1024)) })),
    }),
    totals: dArr(
      dObj<KeyTotal>({
        itemId: dUuid,
        warehouseId: dUuid,
        ledgerQtySum: dNumStr,
        ledgerValueSum: dNumStr,
        latestLedgerId: dNullable(dLedgerId),
        latestQty: dNullable(dNumStr),
        latestRate: dNullable(dNumStr),
        binExists: dBool,
        binQty: dNullable(dNumStr),
        binRate: dNullable(dNumStr),
        integrity: dEnum('pass', 'fail'),
      }),
    ),
    numericChecks: dArr(
      dObj<NumericCheck>({
        caseKey: dNullable(dStr(1, 400)),
        itemId: dUuid,
        warehouseId: dUuid,
        family: dEnum('quantity', 'value', 'rate'),
        actual: dNullable(dNumStr),
        expected: dNullable(dNumStr),
        normalizedActual: dNullable(dNumStr),
        normalizedExpected: dNullable(dNumStr),
        difference: dNullable(dNumStr),
        tolerance: dNullable(dNumStr),
        result: dEnum('pass', 'fail', 'unknown'),
      }),
    ),
    errors: dArr(
      dObj<DiagnosticError>({
        code: dEnum(...ERROR_CODES),
        caseKey: dNullable(dStr(1, 400)),
        ref: dNullable(dSourceRef),
      }),
    ),
    outcome: dEnum('complete', 'integrity_failed', 'incomplete'),
    complete: dBool,
  })(value);
  assertReportConsistent(r);
  return r;
}

/** Outcome/coverage/error/order consistency (diagnostic-wire.md "Outcome consistency"); throws on violation. */
export function assertReportConsistent(r: ReconciliationReport): void {
  const incomplete = r.outcome === 'incomplete';
  if (r.complete === incomplete) fail('outcome_complete_mismatch');
  if (incomplete) {
    if (r.errors.length === 0) fail('incomplete_without_error');
    if (r.totals.length || r.numericChecks.length) fail('incomplete_has_totals');
    if (r.cases.some((c) => c.repairEligible)) fail('incomplete_repair_eligible');
    const cv = r.evidenceCoverage;
    if (
      cv.sourceGraphComplete ||
      cv.ledgerHistoryComplete ||
      cv.openingKnown ||
      cv.fulfillmentKnown
    )
      fail('incomplete_coverage');
    if (r.sourceEvidenceSha256 !== null) fail('incomplete_source_hash');
    if (r.snapshot === null && r.ledger.length) fail('snapshot_required');
  } else {
    if (r.errors.length) fail('complete_has_errors');
    if (r.snapshot === null) fail('snapshot_required');
    if (r.outcome === 'integrity_failed' && r.cases.some((c) => c.repairEligible))
      fail('integrity_repair_eligible');
  }
  const ledgerIds = r.ledger.map((m) => m.ledgerId);
  if (new Set(ledgerIds).size !== ledgerIds.length) fail('ledger_duplicate');
  for (let i = 1; i < ledgerIds.length; i++)
    if (cmpLedgerId(ledgerIds[i - 1], ledgerIds[i]) >= 0) fail('ledger_order');
  const nodes = new Set(r.graph.nodes.map((n) => refKey(n.ref)));
  for (const m of r.ledger)
    for (const s of m.sourceRefs)
      if (!nodes.has(refKey(s)) && !r.sourceEvidence.some((e) => refKey(e.ref) === refKey(s)))
        fail('dangling_ref');
  for (const c of r.cases) {
    if (!c.repairEligible) continue;
    if (c.classification !== 'variant_mismatch') fail('repair_eligible_not_variant');
  }
}

/** Run-stable comparison projection (diagnostic-wire.md): drop observedAt/snapshot id+startedAt and current-state times. */
export function runStableProjection(r: ReconciliationReport): string {
  const clone = JSON.parse(JSON.stringify(r)) as ReconciliationReport;
  (clone as { observedAt?: string }).observedAt = undefined;
  if (clone.snapshot) {
    (clone.snapshot as { id?: string }).id = undefined;
    (clone.snapshot as { startedAt?: string }).startedAt = undefined;
  }
  for (const t of clone.timeline) if (t.meaning === 'current_state_observation') t.at = null;
  return canonicalJson(clone);
}

/** Digest that binds source facts without run metadata, timeline or projection (source-explanation.md). */
export function computeSourceEvidenceSha256(
  orgId: UUID,
  sourceEvidence: SourceEvidenceRow[],
  ledger: MovementEvidence[],
  graph: ReconciliationReport['graph'],
): Digest {
  return canonicalSha256({ schemaVersion: 1, orgId, sourceEvidence, ledger, graph });
}

// ---------------------------------------------------------------------------------------------
// Ledger identity, totals and full-union integrity (data-model.md; report.md decision table)
// ---------------------------------------------------------------------------------------------
export type LedgerMovement = Omit<MovementEvidence, 'sourceRefs'> & { source: StockEntrySource };
export type BinRow = { itemId: UUID; warehouseId: UUID; qty: string; rate: string };
const keyOf = (itemId: string, warehouseId: string) => `${itemId}:${warehouseId}`;

/** Canonical row-ID dedupe: identical repeats collapse; a same-ID row with different content is an integrity failure. */
export function dedupeLedger(rows: readonly LedgerMovement[]): {
  rows: LedgerMovement[];
  conflicts: string[];
} {
  const byId = new Map<string, LedgerMovement>();
  const conflicts: string[] = [];
  for (const r of rows) {
    assertLedgerId(r.ledgerId);
    const prev = byId.get(r.ledgerId);
    if (!prev) byId.set(r.ledgerId, r);
    else if (canonicalJson(prev) !== canonicalJson(r)) conflicts.push(r.ledgerId);
  }
  return {
    rows: [...byId.values()].sort((a, b) => cmpLedgerId(a.ledgerId, b.ledgerId)),
    conflicts,
  };
}

/** Full-union comparison of ledger keys and bin keys: detects missing bins, orphan bins, qty and rate differences. */
export function computeKeyTotals(
  ledger: readonly LedgerMovement[],
  bins: readonly BinRow[],
  caseKey: string | null = null,
): { totals: KeyTotal[]; checks: NumericCheck[]; integrityFailed: boolean } {
  const keys = new Map<string, { itemId: string; warehouseId: string }>();
  const byKey = new Map<string, LedgerMovement[]>();
  for (const m of ledger) {
    const k = keyOf(m.itemId, m.warehouseId);
    keys.set(k, { itemId: m.itemId, warehouseId: m.warehouseId });
    byKey.set(k, [...(byKey.get(k) ?? []), m]);
  }
  const binByKey = new Map<string, BinRow>();
  for (const b of bins) {
    const k = keyOf(b.itemId, b.warehouseId);
    keys.set(k, { itemId: b.itemId, warehouseId: b.warehouseId });
    binByKey.set(k, b);
  }
  const totals: KeyTotal[] = [];
  const checks: NumericCheck[] = [];
  let integrityFailed = false;
  for (const [k, { itemId, warehouseId }] of [...keys].sort(([, a], [, b]) =>
    a.itemId !== b.itemId ? cmpStr(a.itemId, b.itemId) : cmpStr(a.warehouseId, b.warehouseId),
  )) {
    const rows = (byKey.get(k) ?? []).slice().sort((a, b) => cmpLedgerId(a.ledgerId, b.ledgerId));
    const bin = binByKey.get(k);
    const qtySum = sumDec(rows.map((r) => parseDec(r.qtyDelta)));
    const valSum = sumDec(rows.map((r) => parseDec(r.valueDelta)));
    const latest = rows.at(-1) ?? null;
    let ok = true;
    const push = (
      family: NumericCheck['family'],
      actual: string | null,
      expected: string | null,
    ) => {
      const a = tryParseDec(actual);
      const e = tryParseDec(expected);
      if (!a || !e) {
        checks.push({
          caseKey,
          itemId,
          warehouseId,
          family,
          actual,
          expected,
          normalizedActual: null,
          normalizedExpected: null,
          difference: null,
          tolerance: null,
          result: 'unknown',
        });
        ok = false;
        return;
      }
      if (family === 'quantity') {
        const qa = q4(a),
          qe = q4(e);
        const pass = qa === qe;
        if (!pass) ok = false;
        checks.push({
          caseKey,
          itemId,
          warehouseId,
          family,
          actual,
          expected,
          normalizedActual: qa.toString(),
          normalizedExpected: qe.toString(),
          difference: (qa - qe).toString(),
          tolerance: '0',
          result: pass ? 'pass' : 'fail',
        });
        return;
      }
      const t = withinScalarTolerance(a, e);
      if (!t.pass) ok = false;
      checks.push({
        caseKey,
        itemId,
        warehouseId,
        family,
        actual,
        expected,
        normalizedActual: decToString(a),
        normalizedExpected: decToString(e),
        difference: decToString(t.difference),
        tolerance: decToString(t.tolerance),
        result: t.pass ? 'pass' : 'fail',
      });
    };
    // Net signed quantity must equal the terminal ledger quantity (opening history included).
    if (latest) push('quantity', decToString(qtySum), latest.qtyAfter);
    // The latest ledger quantity/rate is the bin; a missing bin or an orphan bin fails outright.
    if (rows.length && !bin) ok = false;
    if (!rows.length && bin && q4(parseDec(bin.qty)) !== 0n) ok = false;
    if (latest && bin) {
      push('quantity', latest.qtyAfter, bin.qty);
      push('rate', latest.valuationRate, bin.rate);
    }
    if (!ok) integrityFailed = true;
    totals.push({
      itemId,
      warehouseId,
      ledgerQtySum: decToString(qtySum),
      ledgerValueSum: decToString(valSum),
      latestLedgerId: latest?.ledgerId ?? null,
      latestQty: latest?.qtyAfter ?? null,
      latestRate: latest?.valuationRate ?? null,
      binExists: !!bin,
      binQty: bin?.qty ?? null,
      binRate: bin?.rate ?? null,
      integrity: ok ? 'pass' : 'fail',
    });
  }
  return { totals, checks, integrityFailed };
}

// ---------------------------------------------------------------------------------------------
// Ordered classifier (report.md "Deterministic classification decision table")
// ---------------------------------------------------------------------------------------------
export type Attribution = { kind: 'pos' | 'booking'; id: UUID };
export interface ClassifierComponent {
  source: { kind: 'pos_ticket' | 'pos_ticket_line' | 'booking'; id: UUID };
  attribution: Attribution;
  itemId: UUID;
  warehouseId: UUID;
  /** null = unknown; an explicit documented zero is "0.0000". */
  intendedStockQty: string | null;
  stockUom: string | null;
  fulfilled: boolean | null;
  trueUpCoverage: 'not_covered' | 'covered' | 'unknown';
  /** 'owner_assertion' = documentary/owner intent (pairing and repair eligibility need it); else immutable snapshot. */
  intentSource: 'owner_assertion' | 'historical_snapshot';
  /** True when other components of the same attribution are not asserted: the shared issue is unallocated. */
  sharedUnallocated?: boolean;
  evidenceReferenceIds: UUID[];
}
export interface ClassifierInput {
  identityState: 'matched' | 'ambiguous' | 'unmatched';
  noStableIds: boolean;
  identityUnresolved: boolean;
  coverage: Coverage;
  integrityFailed: boolean;
  numericUnsupported: boolean;
  evidenceConflict: boolean;
  components: ClassifierComponent[];
  /** Deduplicated ledger rows of every affected key. */
  ledger: readonly LedgerMovement[];
  /** Stock UOM per item, for pairing. */
  itemUoms: Readonly<Record<string, string | null>>;
  projections: readonly ProjectionEvidenceResult[];
  mappingQualified: boolean;
}
export interface ClassifierOutput {
  classification: Classification;
  reasonCodes: Reason[];
  components: ComponentRow[];
  secondaryFindings: SecondaryFinding[];
  repairEligible: boolean;
}

const componentKeyOf = (c: Pick<ClassifierComponent, 'source' | 'itemId' | 'warehouseId'>) =>
  `${c.source.kind}:${c.source.id}:${c.itemId}:${c.warehouseId}`;
const attrOf = (s: StockEntrySource): string | null =>
  s.kind === 'pos' || s.kind === 'booking' ? `${s.kind}:${s.id}` : null;
const sortReasons = (rs: Iterable<Reason>): Reason[] => [...new Set(rs)].sort(cmpStr) as Reason[];

export function classifyCase(input: ClassifierInput): ClassifierOutput {
  const reasons = new Set<Reason>();
  const unresolved = (r: Reason) => reasons.add(r);
  if (input.noStableIds) unresolved('no_stable_ids');
  else if (input.identityState === 'ambiguous') unresolved('identity_ambiguous');
  else if (input.identityState === 'unmatched' || input.identityUnresolved)
    unresolved('identity_unresolved');
  // No asserted component = no historical intent: never a vacuous `valid`.
  if (input.components.length === 0 && !input.noStableIds) unresolved('expected_effect_unknown');
  const cv = input.coverage;
  if (!cv.sourceGraphComplete || !cv.ledgerHistoryComplete) unresolved('incomplete_read');
  if (!cv.openingKnown) unresolved('evidence_unverified');
  if (input.integrityFailed) unresolved('integrity_failed');
  if (input.numericUnsupported) unresolved('numeric_unsupported');
  if (input.evidenceConflict) unresolved('evidence_conflict');

  const rows = new Map<string, ComponentRow>();
  const compReasons = new Map<string, Set<Reason>>();
  const addCompReason = (k: string, r: Reason) => {
    if (!compReasons.has(k)) compReasons.set(k, new Set());
    compReasons.get(k)!.add(r);
    reasons.add(r);
  };
  const secondary: SecondaryFinding[] = [];
  const kinds = new Set<'duplicate' | 'missing_realization' | 'variant_mismatch'>();
  let displayFinding = false;
  let pairedVariantComponents = 0;

  // Affected keys: every component key plus keys reached by pairing below; an `unknown` source on one blocks it.
  const unknownOnKey = new Set(
    input.ledger
      .filter((m) => m.source.kind === 'unknown')
      .map((m) => keyOf(m.itemId, m.warehouseId)),
  );

  // Group components by attribution.
  const groups = new Map<string, ClassifierComponent[]>();
  for (const c of input.components) {
    const g = `${c.attribution.kind}:${c.attribution.id}`;
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  for (const [g, comps] of groups) {
    const comp0 = comps.map((c) => ({ c, k: componentKeyOf(c) }));
    // Per-component prerequisites (order 1).
    let blocked = false;
    for (const { c, k } of comp0) {
      if (c.intendedStockQty === null || c.fulfilled === null || c.stockUom === null) {
        addCompReason(k, 'expected_effect_unknown');
        blocked = true;
      } else if (tryParseDec(c.intendedStockQty) === null) {
        addCompReason(k, 'numeric_unsupported');
        blocked = true;
      }
      if (c.trueUpCoverage === 'unknown') {
        addCompReason(k, 'true_up_coverage_unknown');
        blocked = true;
      }
      if (c.sharedUnallocated) {
        addCompReason(k, 'source_ownership_ambiguous');
        blocked = true;
      }
      if (unknownOnKey.has(keyOf(c.itemId, c.warehouseId))) {
        addCompReason(k, 'stock_source_unknown');
        blocked = true;
      }
    }
    const rowsOf = (m: LedgerMovement) => attrOf(m.source) === g && m.entryType === 'issue';
    const attributed = input.ledger.filter(rowsOf);
    // Expected vector E and actual vector A in Q4 per item/warehouse key (BigInt).
    const E = new Map<string, bigint>();
    const eInfo = new Map<string, ClassifierComponent[]>();
    if (!blocked) {
      for (const c of comps) {
        const k = keyOf(c.itemId, c.warehouseId);
        const want = c.fulfilled ? q4(parseDec(c.intendedStockQty!)) : 0n;
        E.set(k, (E.get(k) ?? 0n) + want);
        eInfo.set(k, [...(eInfo.get(k) ?? []), c]);
      }
    }
    const A = new Map<string, bigint>();
    const liveEntries = new Map<string, Map<string, bigint>>();
    for (const m of attributed) {
      const k = keyOf(m.itemId, m.warehouseId);
      const d = -q4(parseDec(m.qtyDelta));
      A.set(k, (A.get(k) ?? 0n) + d);
      const perEntry = liveEntries.get(k) ?? new Map<string, bigint>();
      perEntry.set(m.entryId, (perEntry.get(m.entryId) ?? 0n) + d);
      liveEntries.set(k, perEntry);
    }
    const allKeys = new Set([...E.keys(), ...A.keys()]);
    const flagged = new Set<string>(); // keys with a proven discrepancy in this group
    if (!blocked) {
      for (const k of allKeys)
        if ((A.get(k) ?? 0n) < 0n) {
          for (const { k: ck } of comp0) addCompReason(ck, 'evidence_conflict');
          blocked = true;
        }
    }
    if (!blocked) {
      // Pairing: an expected key with no issue + a unique unexpected key with exact qty, warehouse and UOM.
      const paired = new Map<string, string>(); // expected key -> actual key
      const expectedShort = [...E.keys()].filter((k) => (A.get(k) ?? 0n) === 0n && E.get(k)! > 0n);
      const unexpected = [...A.keys()].filter((k) => !E.has(k) && A.get(k)! > 0n);
      for (const ek of expectedShort) {
        const ec = eInfo.get(ek)!;
        if (!ec.every((c) => c.intentSource === 'owner_assertion')) continue;
        const wh = ek.split(':')[1];
        const cands = unexpected.filter(
          (uk) =>
            uk.split(':')[1] === wh &&
            A.get(uk) === E.get(ek) &&
            input.itemUoms[uk.split(':')[0]] != null &&
            input.itemUoms[uk.split(':')[0]] ===
              (ec[0].stockUom ?? input.itemUoms[ek.split(':')[0]]),
        );
        if (cands.length === 1) paired.set(ek, cands[0]);
      }
      const pairedActual = new Set(paired.values());
      if (new Set(pairedActual).size !== paired.size) paired.clear(); // many-to-one is not unique
      const done = new Set<string>();
      for (const [ek, uk] of paired) {
        kinds.add('variant_mismatch');
        pairedVariantComponents += eInfo.get(ek)!.length;
        flagged.add(ek);
        done.add(ek);
        done.add(uk);
        for (const c of eInfo.get(ek)!)
          secondary.push({
            kind: 'variant_mismatch',
            componentKey: componentKeyOf(c),
            intendedQty: fixed4(E.get(ek)!),
            actualQty: fixed4(A.get(uk)!),
            evidenceRefs: [...c.evidenceReferenceIds].sort(cmpStr),
            reason: 'wrong_variant_issue',
          });
      }
      for (const k of allKeys) {
        if (done.has(k)) continue;
        const e = E.get(k) ?? 0n,
          a = A.get(k) ?? 0n;
        if (!E.has(k)) {
          for (const { k: ck } of comp0) addCompReason(ck, 'unsupported_shape');
          blocked = true;
          continue;
        }
        if (a > e) {
          const live = [...(liveEntries.get(k) ?? new Map()).values()].filter((v) => v > 0n).length;
          if (live >= 2) {
            kinds.add('duplicate');
            flagged.add(k);
            for (const c of eInfo.get(k)!)
              secondary.push({
                kind: 'duplicate',
                componentKey: componentKeyOf(c),
                intendedQty: fixed4(e),
                actualQty: fixed4(a),
                evidenceRefs: [...c.evidenceReferenceIds].sort(cmpStr),
                reason: 'duplicate_net_issue',
              });
          } else {
            for (const c of eInfo.get(k)!) addCompReason(componentKeyOf(c), 'unsupported_shape');
            blocked = true;
          }
        } else if (a < e) {
          kinds.add('missing_realization');
          flagged.add(k);
          for (const c of eInfo.get(k)!)
            secondary.push({
              kind: 'missing_realization',
              componentKey: componentKeyOf(c),
              intendedQty: fixed4(e),
              actualQty: fixed4(a),
              evidenceRefs: [...c.evidenceReferenceIds].sort(cmpStr),
              reason: 'missing_net_issue',
            });
        }
      }
      if (flagged.size && comps.some((c) => c.trueUpCoverage === 'covered')) {
        for (const { k: ck } of comp0) addCompReason(ck, 'true_up_already_covered');
      }
    }
    // Component rows (always emitted, never silently dropped).
    for (const { c, k } of comp0) {
      const key = keyOf(c.itemId, c.warehouseId);
      const mine = attributed.filter((m) => keyOf(m.itemId, m.warehouseId) === key);
      const known = !blocked || !compReasons.get(k)?.has('expected_effect_unknown');
      rows.set(k, {
        componentKey: k,
        source: { kind: c.source.kind, id: c.source.id },
        itemId: c.itemId,
        warehouseId: c.warehouseId,
        intendedQty:
          c.intendedStockQty !== null && tryParseDec(c.intendedStockQty)
            ? fixed4(q4(parseDec(c.intendedStockQty)))
            : null,
        stockUom: c.stockUom,
        actualIssuedQty: known
          ? decToString(decNeg(sumDec(mine.map((m) => parseDec(m.qtyDelta)))))
          : null,
        actualValue: known
          ? decToString(decNeg(sumDec(mine.map((m) => parseDec(m.valueDelta)))))
          : null,
        classification: 'unresolved',
        reasonCodes: [],
        evidenceReferenceIds: [...c.evidenceReferenceIds].sort(cmpStr),
        ledgerIds: mine.map((m) => m.ledgerId).sort(cmpLedgerId),
      });
    }
  }
  // Display: admitted projection discrepancy, or projection problems that force unresolved.
  const projReason = new Set<Reason>();
  for (const p of input.projections) {
    if (p.state === 'conflicting') projReason.add('projection_conflict');
    else if (p.state === 'unavailable')
      projReason.add(
        p.reason === 'projection_source_changed'
          ? 'projection_source_changed'
          : 'projection_identity_unavailable',
      );
    else if (p.state === 'admitted') {
      const shown = p.observations
        .filter((o) => o.presence === 'shown' && o.qty !== null)
        .map((o) => q4OfString(o.qty!));
      const omitted = p.observations.some((o) => o.presence === 'omitted');
      if (omitted || new Set(shown).size > 1) displayFinding = true;
    }
  }
  for (const r of projReason) reasons.add(r);

  // Final primary classification.
  const proven = [...kinds];
  let classification: Classification;
  let reasonCodes: Reason[];
  const blockedOverall = [...reasons].length > 0;
  if (blockedOverall) {
    classification = 'unresolved';
    reasonCodes = sortReasons(reasons);
    if (proven.length > 1) reasonCodes = sortReasons([...reasonCodes, 'mixed_discrepancies']);
  } else if (proven.length > 1) {
    classification = 'unresolved';
    reasonCodes = ['mixed_discrepancies'];
  } else if (proven.length === 1) {
    classification = proven[0];
    reasonCodes = [
      classification === 'duplicate'
        ? 'duplicate_net_issue'
        : classification === 'missing_realization'
          ? 'missing_net_issue'
          : 'wrong_variant_issue',
    ];
  } else if (displayFinding) {
    classification = 'display_only';
    reasonCodes = ['display_multiplicity_only'];
  } else {
    classification = 'valid';
    reasonCodes = ['stock_matches_intent'];
    if (
      input.projections.every((p) => p.state === 'not_provided') ||
      input.projections.length === 0
    )
      reasonCodes.push('projection_unverified');
  }
  // Unresolved-but-proven discrepancies stay visible through secondaryFindings (already collected).
  if (displayFinding && classification !== 'display_only') {
    for (const c of input.components)
      secondary.push({
        kind: 'display_only',
        componentKey: componentKeyOf(c),
        intendedQty: null,
        actualQty: null,
        evidenceRefs: [],
        reason: 'display_multiplicity_only',
      });
  }
  const only = input.components.length === 1 ? input.components[0] : null;
  let repairEligible = false;
  if (
    classification === 'variant_mismatch' &&
    only &&
    pairedVariantComponents === 1 &&
    only.attribution.kind === 'pos'
  ) {
    const ownerConfirmed = only.intentSource === 'owner_assertion';
    if (!input.mappingQualified)
      reasonCodes = sortReasons([...reasonCodes, 'mapping_not_qualified']);
    if (!ownerConfirmed) reasonCodes = sortReasons([...reasonCodes, 'owner_confirmation_missing']);
    repairEligible =
      input.mappingQualified &&
      ownerConfirmed &&
      only.trueUpCoverage === 'not_covered' &&
      secondary.length === 1;
  }
  const out = [...rows.values()].sort(
    (a, b) =>
      cmpStr(a.itemId, b.itemId) ||
      cmpStr(a.warehouseId, b.warehouseId) ||
      cmpStr(a.componentKey, b.componentKey),
  );
  for (const r of out) {
    const rr = compReasons.get(r.componentKey);
    r.classification =
      classification === 'unresolved' || (rr && rr.size) ? 'unresolved' : classification;
    r.reasonCodes =
      rr && rr.size ? sortReasons(rr) : classification === 'unresolved' ? reasonCodes : reasonCodes;
  }
  secondary.sort((a, b) => cmpStr(a.componentKey, b.componentKey) || cmpStr(a.kind, b.kind));
  return {
    classification,
    reasonCodes,
    components: out,
    secondaryFindings: secondary,
    repairEligible,
  };
}
