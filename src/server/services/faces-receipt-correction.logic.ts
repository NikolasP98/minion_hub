/**
 * FACES receipt-chain correction: pure manifest/command/status decoders, hashes and effect planning
 * (minion-meta spec 123 contracts/command-envelope.md). No DB, alias, CLI or environment import; DocumentBasis /
 * UnitQualification and every wire combinator come from the already-created pure replay module.
 */
import {
  canonical,
  decodeDocumentBasis,
  engineString,
  parseRat,
  receiptRateBasis,
  sha256,
  wire,
  WireError,
  type Digest,
  type DocumentBasis,
  type QualifiedOperatorTarget,
  type StockReplayMath,
  type UUID,
} from '../../../scripts/lib/faces-receipt-replay';

const {
  str,
  label,
  uuid,
  digest,
  codeSha,
  seq,
  utc,
  raw,
  posDec,
  engine,
  int,
  lit,
  nul,
  arr,
  obj,
  union,
} = wire;
type V<T> = (x: unknown, p: string) => T;
const bad = (p: string): never => {
  throw new WireError(p);
};

export const MAX_ISSUES = 128;
export const MAX_COMMAND_BYTES = 1048576;

export type EntryEvidence = {
  entryId: UUID;
  headerRowSha256: Digest;
  lineId: UUID;
  lineRowSha256: Digest;
  type: 'receipt' | 'issue';
  ledgerId: string;
  ledgerRowSha256: Digest;
  qty: string;
  uom: string | null;
  rate: string | null;
  qtyDelta: string;
  valueDelta: string;
  qtyAfter: string;
  valuationRate: string;
  source: { kind: 'receipt' | 'pos_ticket' | 'booking'; id: UUID };
};
export type ConsumerEvidence =
  | {
      kind: 'pos_ticket';
      id: UUID;
      rowSha256: Digest;
      currentEntryId: UUID;
      financialFiscalSha256: Digest;
      replacementEntryId: UUID;
    }
  | {
      kind: 'stock_accrual';
      id: UUID;
      rowSha256: Digest;
      currentEntryId: UUID;
      sourceType: 'booking';
      sourceId: UUID;
      realizedQty: string;
      realizedValue: string;
      replacementEntryId: UUID;
      intendedRealizedValue: string;
    };
export type EntryReplacement = { sourceEntryId: UUID; replacementEntryId: UUID };
export type ReplayEffect = {
  phase: 'reverse_issue' | 'reverse_receipt' | 'receipt' | 'issue';
  entryId: UUID;
  qtyDelta: string;
  valueDelta: string;
  qtyAfter: string;
  valuationRate: string;
};
export type ReceiptManifestBase = {
  schemaVersion: 1;
  kind: 'receipt_chain';
  target: QualifiedOperatorTarget;
  sourceCodeSha: string;
  orgId: UUID;
  actorProfileId: UUID;
  operationKey: UUID;
  sourceReceiptId: UUID;
  sourceReceiptLineId: UUID;
  itemId: UUID;
  warehouseId: UUID;
  stockUom: string;
  entries: EntryEvidence[];
  consumers: ConsumerEvidence[];
  entryMap: EntryReplacement[];
  opening: {
    qty: string;
    value: string;
    valuationRate: string;
    ledgerId: string | null;
    rowSha256: Digest | null;
  };
  before: {
    binRowSha256: Digest;
    latestLedgerId: string;
    latestLedgerRowSha256: Digest;
    itemRowSha256: Digest;
    ruleStateSha256: Digest;
    sourceStateSha256: Digest;
    financialFiscalSha256: Digest;
    policyStateSha256: Digest;
  };
  intended: {
    receiptQty: string;
    receiptRate: string;
    effects: ReplayEffect[];
    terminalQty: string;
    terminalValue: string;
    terminalRate: string;
    netCogsDelta: string;
  };
  postedAt: string;
  accountingTimezone: string;
  correctionMonth: string;
  reason: string;
  ownerApprovalReference: string;
};
export type CompensateBasis = {
  policy: 'restore_prior_before_snapshot';
  priorManifestSha256: Digest;
  originalDocumentSha256: Digest;
};
export type ReceiptChainManifestV1 =
  | (ReceiptManifestBase & { action: 'correct'; basis: DocumentBasis })
  | (ReceiptManifestBase & {
      action: 'compensate';
      inverseOfOperationId: UUID;
      basis: CompensateBasis;
    });
export type ReceiptCorrectionCommand = {
  manifest: ReceiptChainManifestV1;
  approvedPlanSha256: Digest;
  previewHash: Digest;
};
export type ReceiptCorrectionStatusInput = {
  target: QualifiedOperatorTarget;
  orgId: UUID;
  actorProfileId: UUID;
  operationKey: UUID;
  action: 'correct' | 'compensate';
  manifestSha256: Digest;
  manifest: ReceiptChainManifestV1;
};

// ───────────── state digests (decisions for review finding F2-R6-IR-002) ─────────────
// Each digest is a pure function of manifest-shaped evidence, so the decoder can verify the derived ones and the service
// recomputes them from fresh rows read in the same shape. Row hashes themselves are raw to_jsonb(row)::text SHA-256s.
type ConsumerKey = { kind: string; id: UUID; rowSha256: Digest; currentEntryId: UUID };
/** Frozen-quantity rule evidence: the chain replays stored quantities, never today's recipes or conversions. */
export const ruleStateDigest = (entries: readonly EntryEvidence[]): Digest =>
  sha256(
    canonical({
      domain: 'receipt_chain_rules',
      entries: entries.map((e) => ({ entryId: e.entryId, qty: e.qty, uom: e.uom })),
    }),
  );
/** Aggregate of the per-ticket financial/fiscal digests (ticket row + its payments), sorted by ticket id. */
export const financialStateDigest = (consumers: readonly ConsumerEvidence[]): Digest =>
  sha256(
    canonical({
      domain: 'receipt_chain_financial',
      tickets: consumers.flatMap((c) =>
        c.kind === 'pos_ticket' ? [{ id: c.id, sha: c.financialFiscalSha256 }] : [],
      ),
    }),
  );
export const sourceStateDigest = (
  entries: readonly EntryEvidence[],
  consumers: readonly (ConsumerKey & Record<string, unknown>)[],
): Digest =>
  sha256(
    canonical({
      domain: 'receipt_chain_source',
      entries: entries.map((e) => ({
        entryId: e.entryId,
        headerRowSha256: e.headerRowSha256,
        lineId: e.lineId,
        lineRowSha256: e.lineRowSha256,
        ledgerId: e.ledgerId,
        ledgerRowSha256: e.ledgerRowSha256,
      })),
      consumers: consumers.map((c) => ({
        kind: c.kind,
        id: c.id,
        rowSha256: c.rowSha256,
        currentEntryId: c.currentEntryId,
      })),
    }),
  );
export const stockStateDigest = (
  m: Pick<ReceiptManifestBase, 'opening' | 'before' | 'entries'>,
): Digest =>
  sha256(
    canonical({
      domain: 'receipt_chain_stock',
      opening: m.opening,
      binRowSha256: m.before.binRowSha256,
      latestLedgerId: m.before.latestLedgerId,
      latestLedgerRowSha256: m.before.latestLedgerRowSha256,
      itemRowSha256: m.before.itemRowSha256,
      ledger: m.entries.map((e) => ({
        ledgerId: e.ledgerId,
        qtyDelta: e.qtyDelta,
        valueDelta: e.valueDelta,
        qtyAfter: e.qtyAfter,
        valuationRate: e.valuationRate,
      })),
    }),
  );
/** Period/timezone/authority evidence; lockedPeriods are the actual pos_period_locks rows read in the snapshot. */
export const policyStateDigest = (input: {
  accountingTimezone: string;
  correctionMonth: string;
  actorProfileId: UUID;
  lockedPeriods: readonly string[];
}): Digest =>
  sha256(
    canonical({
      domain: 'receipt_chain_policy',
      accountingTimezone: input.accountingTimezone,
      correctionMonth: input.correctionMonth,
      actorProfileId: input.actorProfileId,
      membershipRole: 'owner',
      lockedPeriods: [...input.lockedPeriods].sort(),
    }),
  );

// ───────────── field decoders ─────────────
/** Positive stock quantity: at most nine integer and four fractional digits (F3 transaction-protocol admission rule). */
const qty4: V<string> = (x, p) => {
  const s = posDec(x, p);
  const [i, f = ''] = s.split('.');
  if (i.replace(/^0+(?=\d)/, '').length > 9 || f.replace(/0+$/, '').length > 4) bad(p);
  return s;
};
const refSource = union<EntryEvidence['source']>('kind', {
  receipt: obj({ kind: lit('receipt'), id: uuid }) as V<EntryEvidence['source']>,
  pos_ticket: obj({ kind: lit('pos_ticket'), id: uuid }) as V<EntryEvidence['source']>,
  booking: obj({ kind: lit('booking'), id: uuid }) as V<EntryEvidence['source']>,
});
const entryV = obj<EntryEvidence>({
  entryId: uuid,
  headerRowSha256: digest,
  lineId: uuid,
  lineRowSha256: digest,
  type: lit('receipt', 'issue'),
  ledgerId: seq,
  ledgerRowSha256: digest,
  qty: raw,
  uom: nul(str(0, 80)),
  rate: nul(raw),
  qtyDelta: raw,
  valueDelta: raw,
  qtyAfter: raw,
  valuationRate: raw,
  source: refSource,
});
const consumerV = union<ConsumerEvidence>('kind', {
  pos_ticket: obj({
    kind: lit('pos_ticket'),
    id: uuid,
    rowSha256: digest,
    currentEntryId: uuid,
    financialFiscalSha256: digest,
    replacementEntryId: uuid,
  }) as V<ConsumerEvidence>,
  stock_accrual: obj({
    kind: lit('stock_accrual'),
    id: uuid,
    rowSha256: digest,
    currentEntryId: uuid,
    sourceType: lit('booking'),
    sourceId: uuid,
    realizedQty: raw,
    realizedValue: raw,
    replacementEntryId: uuid,
    intendedRealizedValue: engine,
  }) as V<ConsumerEvidence>,
});
const mapV = obj<EntryReplacement>({ sourceEntryId: uuid, replacementEntryId: uuid });
const effectV = obj<ReplayEffect>({
  phase: lit('reverse_issue', 'reverse_receipt', 'receipt', 'issue'),
  entryId: uuid,
  qtyDelta: engine,
  valueDelta: engine,
  qtyAfter: engine,
  valuationRate: engine,
});
const baseShape = {
  schemaVersion: lit(1 as const),
  kind: lit('receipt_chain' as const),
  target: wire.target,
  sourceCodeSha: codeSha,
  orgId: uuid,
  actorProfileId: uuid,
  operationKey: uuid,
  sourceReceiptId: uuid,
  sourceReceiptLineId: uuid,
  itemId: uuid,
  warehouseId: uuid,
  stockUom: label(1, 80),
  entries: arr(entryV, MAX_ISSUES + 1),
  consumers: arr(consumerV, 2 * MAX_ISSUES),
  entryMap: arr(mapV, MAX_ISSUES + 1),
  opening: obj({
    qty: raw,
    value: raw,
    valuationRate: raw,
    ledgerId: nul(seq),
    rowSha256: nul(digest),
  }) as V<ReceiptManifestBase['opening']>,
  before: obj({
    binRowSha256: digest,
    latestLedgerId: seq,
    latestLedgerRowSha256: digest,
    itemRowSha256: digest,
    ruleStateSha256: digest,
    sourceStateSha256: digest,
    financialFiscalSha256: digest,
    policyStateSha256: digest,
  }) as V<ReceiptManifestBase['before']>,
  intended: obj({
    receiptQty: qty4,
    receiptRate: posDec,
    effects: arr(effectV, 2 * (MAX_ISSUES + 1)),
    terminalQty: engine,
    terminalValue: engine,
    terminalRate: engine,
    netCogsDelta: engine,
  }) as V<ReceiptManifestBase['intended']>,
  postedAt: utc,
  accountingTimezone: label(1, 64),
  correctionMonth: wire.re(/^\d{4}-(0[1-9]|1[0-2])$/),
  reason: label(1, 1000),
  ownerApprovalReference: label(1, 1000),
};
const correctV = obj({
  ...baseShape,
  action: lit('correct'),
  basis: ((x: unknown, p: string) => decodeDocumentBasis(x)) as V<DocumentBasis>,
});
const compensateV = obj({
  ...baseShape,
  action: lit('compensate'),
  inverseOfOperationId: uuid,
  basis: obj({
    policy: lit('restore_prior_before_snapshot'),
    priorManifestSha256: digest,
    originalDocumentSha256: digest,
  }) as V<CompensateBasis>,
});

const monthIn = (iso: string, tz: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(iso));
  return `${parts.find((q) => q.type === 'year')!.value}-${parts.find((q) => q.type === 'month')!.value}`;
};

function invariants(m: ReceiptChainManifestV1): ReceiptChainManifestV1 {
  const n = m.entries.length;
  const issues = n - 1;
  if (n < 1 || m.entryMap.length !== n || m.intended.effects.length !== 2 * n) bad('$.entries');
  const e0 = m.entries[0];
  if (
    e0.type !== 'receipt' ||
    e0.source.kind !== 'receipt' ||
    e0.source.id !== m.sourceReceiptId ||
    e0.entryId !== m.sourceReceiptId ||
    e0.lineId !== m.sourceReceiptLineId
  )
    bad('$.entries[0]');
  const uniq = (xs: string[], p: string) => new Set(xs).size === xs.length || bad(p);
  uniq(
    m.entries.map((e) => e.entryId),
    '$.entries.entryId',
  );
  uniq(
    m.entries.map((e) => e.lineId),
    '$.entries.lineId',
  );
  uniq(
    m.entries.map((e) => e.ledgerId),
    '$.entries.ledgerId',
  );
  m.entries.forEach((e, i) => {
    if (i > 0 && (e.type !== 'issue' || e.source.kind === 'receipt')) bad(`$.entries[${i}]`);
    if (i > 0 && BigInt(e.ledgerId) <= BigInt(m.entries[i - 1].ledgerId))
      bad(`$.entries[${i}].ledgerId`);
    qty4(e.qty, `$.entries[${i}].qty`);
  });
  if (BigInt(m.before.latestLedgerId) !== BigInt(m.entries[n - 1].ledgerId))
    bad('$.before.latestLedgerId');
  // entryMap: same order as entries, distinct replacements never equal to any original
  const originals = new Set(m.entries.map((e) => e.entryId));
  m.entryMap.forEach((p, i) => {
    if (p.sourceEntryId !== m.entries[i].entryId || originals.has(p.replacementEntryId))
      bad(`$.entryMap[${i}]`);
  });
  uniq(
    m.entryMap.map((p) => p.replacementEntryId),
    '$.entryMap.replacementEntryId',
  );
  // effects: reverse issues descending, reverse receipt, new receipt, new issues ascending
  const expect: { phase: ReplayEffect['phase']; entryId: UUID }[] = [
    ...m.entries
      .slice(1)
      .reverse()
      .map((e) => ({ phase: 'reverse_issue' as const, entryId: e.entryId })),
    { phase: 'reverse_receipt', entryId: e0.entryId },
    { phase: 'receipt', entryId: m.entryMap[0].replacementEntryId },
    ...m.entryMap.slice(1).map((p) => ({ phase: 'issue' as const, entryId: p.replacementEntryId })),
  ];
  expect.forEach((x, i) => {
    if (m.intended.effects[i].phase !== x.phase || m.intended.effects[i].entryId !== x.entryId)
      bad(`$.intended.effects[${i}]`);
  });
  if (issues + 1 !== m.entryMap.length) bad('$.entryMap');
  // consumers: sorted, unique, exactly one of the right kind per issue
  const keys = m.consumers.map((c) => c.kind + c.id);
  if ([...keys].sort().join() !== keys.join() || new Set(keys).size !== keys.length)
    bad('$.consumers');
  const pos = m.consumers.filter((c) => c.kind === 'pos_ticket').length;
  if (pos > MAX_ISSUES || m.consumers.length - pos > MAX_ISSUES) bad('$.consumers');
  m.entries.slice(1).forEach((e, i) => {
    const cs = m.consumers.filter((c) => c.currentEntryId === e.entryId);
    const want = e.source.kind === 'pos_ticket' ? 'pos_ticket' : 'stock_accrual';
    if (
      cs.length !== 1 ||
      cs[0].kind !== want ||
      cs[0].replacementEntryId !== m.entryMap[i + 1].replacementEntryId
    )
      bad(`$.consumers[${e.entryId}]`);
    const c = cs[0];
    if (
      c.kind === 'stock_accrual' &&
      (c.sourceId !== e.source.id ||
        parseRat(c.realizedQty).n !== parseRat(e.qtyDelta.replace('-', '')).n ||
        parseRat(c.realizedQty).d !== parseRat(e.qtyDelta.replace('-', '')).d)
    )
      bad(`$.consumers[${e.entryId}]`);
  });
  if (m.consumers.some((c) => !originals.has(c.currentEntryId) || c.currentEntryId === e0.entryId))
    bad('$.consumers');
  if (m.action === 'correct') {
    // The normalized-unit proof must bind exactly these rows/sources and the frozen item; a stored label may only be null or the proved unit.
    const u = m.basis.unitQualification;
    const proofOk =
      u.sources.length === n &&
      u.itemId === m.itemId &&
      u.itemRowSha256 === m.before.itemRowSha256 &&
      u.documentSha256 === m.basis.sha256 &&
      m.entries.every(
        (e, i) =>
          u.sources[i].entryId === e.entryId &&
          u.sources[i].lineId === e.lineId &&
          u.sources[i].headerRowSha256 === e.headerRowSha256 &&
          u.sources[i].lineRowSha256 === e.lineRowSha256 &&
          u.sources[i].sourceKind === e.source.kind &&
          u.sources[i].sourceId === e.source.id &&
          (e.uom === null || e.uom === u.stockUom),
      );
    if (!proofOk) bad('$.basis.unitQualification');
  }
  // derived digests are pure functions of the manifest's own evidence
  if (m.before.ruleStateSha256 !== ruleStateDigest(m.entries)) bad('$.before.ruleStateSha256');
  if (m.before.financialFiscalSha256 !== financialStateDigest(m.consumers))
    bad('$.before.financialFiscalSha256');
  if (m.before.sourceStateSha256 !== sourceStateDigest(m.entries, m.consumers))
    bad('$.before.sourceStateSha256');
  // posting time and period
  try {
    if (monthIn(m.postedAt, m.accountingTimezone) !== m.correctionMonth) bad('$.correctionMonth');
  } catch (e) {
    if (e instanceof WireError) throw e;
    bad('$.accountingTimezone');
  }
  if ((m.opening.ledgerId === null) !== (m.opening.rowSha256 === null)) bad('$.opening');
  if (m.action === 'correct') {
    if (
      m.basis.stockQty !== m.intended.receiptQty ||
      m.basis.unitQualification.stockUom !== m.stockUom
    )
      bad('$.basis');
    if (
      receiptRateBasis(m.basis.totalValuation, m.basis.stockQty).receiptRate !==
      m.intended.receiptRate
    )
      bad('$.intended.receiptRate');
    if (
      m.basis.unitQualification.receiptEntryId !== m.sourceReceiptId ||
      m.basis.unitQualification.receiptLineId !== m.sourceReceiptLineId
    )
      bad('$.basis.unitQualification');
  }
  return m;
}

export function decodeReceiptChainManifestV1(value: unknown): ReceiptChainManifestV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) bad('$');
  const action = (value as Record<string, unknown>).action;
  // Reject mixed unions: correct must omit inverseOfOperationId; compensate must carry it.
  const m = (
    action === 'compensate'
      ? compensateV(value, '$')
      : action === 'correct'
        ? correctV(value, '$')
        : bad('$.action')
  ) as ReceiptChainManifestV1;
  if (Buffer.byteLength(canonical(m)) > MAX_COMMAND_BYTES) bad('$');
  return invariants(m);
}
export const receiptManifestSha256 = (m: ReceiptChainManifestV1): Digest => sha256(canonical(m));

export function decodeReceiptCorrectionCommand(value: unknown): ReceiptCorrectionCommand {
  const c = obj<{ manifest: unknown; approvedPlanSha256: Digest; previewHash: Digest }>({
    manifest: ((x) => x) as V<unknown>,
    approvedPlanSha256: digest,
    previewHash: digest,
  })(value, '$');
  const manifest = decodeReceiptChainManifestV1(c.manifest);
  if (c.approvedPlanSha256 !== receiptManifestSha256(manifest)) bad('$.approvedPlanSha256');
  return { manifest, approvedPlanSha256: c.approvedPlanSha256, previewHash: c.previewHash };
}
export function decodeReceiptCorrectionStatusInput(value: unknown): ReceiptCorrectionStatusInput {
  const s = obj<Omit<ReceiptCorrectionStatusInput, 'manifest'> & { manifest: unknown }>({
    target: wire.target,
    orgId: uuid,
    actorProfileId: uuid,
    operationKey: uuid,
    action: lit('correct', 'compensate'),
    manifestSha256: digest,
    manifest: ((x) => x) as V<unknown>,
  })(value, '$');
  const manifest = decodeReceiptChainManifestV1(s.manifest);
  // actorProfileId is the CURRENT status reader and may differ from manifest.actorProfileId.
  if (
    s.manifestSha256 !== receiptManifestSha256(manifest) ||
    s.action !== manifest.action ||
    s.operationKey !== manifest.operationKey ||
    s.orgId !== manifest.orgId
  ) {
    bad('$.manifestSha256');
  }
  return { ...s, manifest };
}

/** SHA over the fresh-state digests; observation time is metadata and never enters it. */
export function receiptPreviewHash(input: {
  manifestSha256: Digest;
  sourceStateSha256: Digest;
  stockStateSha256: Digest;
  policyStateSha256: Digest;
}): Digest {
  return sha256(canonical({ schemaVersion: 1, domain: 'receipt_chain', ...input }));
}
export function receiptPayloadHash(input: {
  orgId: UUID;
  actorProfileId: UUID;
  manifestSha256: Digest;
  previewHash: Digest;
}): Digest {
  return sha256(canonical({ schemaVersion: 1, domain: 'receipt_chain', ...input }));
}

// ───────────── manifest producer (review finding F2-R6-IR-001) ─────────────
/**
 * Pure producer of `intended.effects`, terminal state and net COGS delta for a CORRECT manifest, from the frozen original
 * evidence and the verified receipt rate. Callers (the draft step of the correct CLI) fill every other field from the owned
 * snapshot; this function is the only place the 2x(1+n) engine effects are authored, so no human writes effect strings.
 */
export function planCorrectEffects(
  input: {
    entries: readonly EntryEvidence[];
    entryMap: readonly EntryReplacement[];
    receiptRate: string;
  },
  math: StockReplayMath,
): Pick<
  ReceiptManifestBase['intended'],
  'effects' | 'terminalQty' | 'terminalValue' | 'terminalRate' | 'netCogsDelta'
> {
  const { entries, entryMap, receiptRate } = input;
  const last = entries[entries.length - 1];
  let bin = { qty: Number(last.qtyAfter), rate: Number(last.valuationRate) };
  const effects: ReplayEffect[] = [];
  const reverse = (e: EntryEvidence, phase: 'reverse_issue' | 'reverse_receipt') => {
    const qd = -Number(e.qtyDelta);
    const vd = -Number(e.valueDelta);
    bin = math.applyLedgerDelta(bin, qd, vd);
    effects.push({
      phase,
      entryId: e.entryId,
      qtyDelta: engineString(qd),
      valueDelta: engineString(vd),
      qtyAfter: engineString(bin.qty),
      valuationRate: engineString(bin.rate),
    });
  };
  for (const e of [...entries.slice(1)].reverse()) reverse(e, 'reverse_issue');
  reverse(entries[0], 'reverse_receipt');
  let newIssueCost = 0;
  let origIssueCost = 0;
  entries.forEach((e, i) => {
    const qd = Number(e.qtyDelta);
    const leg = math.computeLegValue(bin, qd, i === 0 ? Number(receiptRate) : null);
    bin = math.applyLedgerDelta(bin, qd, leg.valueDelta);
    effects.push({
      phase: i === 0 ? 'receipt' : 'issue',
      entryId: entryMap[i].replacementEntryId,
      qtyDelta: engineString(qd),
      valueDelta: engineString(leg.valueDelta),
      qtyAfter: engineString(bin.qty),
      valuationRate: engineString(bin.rate),
    });
    if (i > 0) {
      newIssueCost += -leg.valueDelta;
      origIssueCost += -Number(e.valueDelta);
    }
  });
  const net = newIssueCost - origIssueCost;
  return {
    effects,
    terminalQty: engineString(bin.qty),
    terminalValue: engineString(bin.qty * bin.rate),
    terminalRate: engineString(bin.rate),
    netCogsDelta: engineString(Object.is(net, -0) ? 0 : net),
  };
}

// ───────────── typed errors (command-envelope.md "Status, CLI and failures") ─────────────
export type ReceiptCorrectionCode =
  | 'invalid_manifest'
  | 'invalid_command'
  | 'target_mismatch'
  | 'actor_unavailable'
  | 'incomplete_evidence'
  | 'read_unavailable'
  | 'stale_preview'
  | 'key_reuse'
  | 'source_conflict'
  | 'unsupported_movement'
  | 'period_unavailable'
  | 'invariant_failed'
  | 'commit_outcome_unknown';
export const RECEIPT_CORRECTION_EXIT: Record<ReceiptCorrectionCode, 2 | 3 | 4 | 5> = {
  invalid_manifest: 2,
  invalid_command: 2,
  target_mismatch: 2,
  actor_unavailable: 2,
  incomplete_evidence: 3,
  read_unavailable: 3,
  stale_preview: 4,
  key_reuse: 4,
  source_conflict: 4,
  unsupported_movement: 4,
  period_unavailable: 4,
  invariant_failed: 4,
  commit_outcome_unknown: 5,
};
export class ReceiptCorrectionError extends Error {
  constructor(readonly code: ReceiptCorrectionCode) {
    super(code); // fixed code only: never raw SDK/SQL/server text
    this.name = 'ReceiptCorrectionError';
  }
}
/** F3 helper StockError codes / SQLSTATEs mapped to this contract (review finding F2-R6-IR-005). */
export function mapHelperRefusal(
  code: string | null | undefined,
  sqlState?: string | null,
): ReceiptCorrectionCode {
  if (sqlState === '40001' || sqlState === '40P01' || sqlState === '55P03' || sqlState === '57014')
    return 'read_unavailable';
  switch (code) {
    case 'posted_at_out_of_order':
      return 'period_unavailable';
    case 'not_draft':
    case 'not_submitted':
    case 'no_ledger':
    case 'duplicate_source':
    case 'not_found':
      return 'source_conflict';
    case 'module_disabled':
      return 'actor_unavailable';
    default:
      return 'invariant_failed'; // negative_stock, guard_mismatch, ambient_write_not_allowed, invalid_entry_id, ...
  }
}
