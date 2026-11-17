/**
 * FACES receipt-chain correction writer (minion-meta spec 123, contracts/correction.md + command-envelope.md).
 * One atomic reverse-and-replay of a single item/warehouse segment using the F3 transaction-accepting primitives.
 * Original ledger rows stay immutable; originals are cancelled (signed reversal rows) and linked replacements are created.
 */
import { instantMonthKey } from '$lib/time/zoned';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, withOrgCoreTransaction, type CoreTx } from '$server/db/with-org-core';
import { stkCorrections } from '$server/db/pg-schema/stock';
import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
import {
  resolveFreshCapabilitiesReadOnlyInTransaction,
  resolveFreshOperatorCapabilitiesForWriteInTransaction,
  type FreshCapabilitySnapshot,
} from './rbac.service';
import { recordAuditInTx } from './activity.service';
import {
  StockError,
  assertStockModulesEnabledInTx,
  cancelEntryInTx,
  createEntryInTx,
  lockBinsInTx,
  lockStockWrite,
  submitEntryInTx,
  type Actor,
  type StockWriteGuard,
} from './stock.service';
import { applyLedgerDelta, computeLegValue, round4 } from './stock.logic';
import {
  canonical,
  receiptRateBasis,
  sha256,
  ticketFinancialSha256,
  type DocumentBasis,
} from '../../../scripts/lib/faces-receipt-replay';
import {
  ReceiptCorrectionError,
  decodeReceiptChainManifestV1,
  decodeReceiptCorrectionCommand,
  decodeReceiptCorrectionStatusInput,
  mapHelperRefusal,
  planCorrectEffects,
  policyStateDigest,
  receiptManifestSha256,
  receiptPayloadHash,
  receiptPreviewHash,
  stockStateDigest,
  financialStateDigest,
  ruleStateDigest,
  sourceStateDigest,
  type ConsumerEvidence,
  type EntryEvidence,
  type EntryReplacement,
  type ReceiptChainManifestV1,
  residualMatches,
  type ReceiptCorrectionCode,
  type ReceiptManifestBase,
} from './faces-receipt-correction.logic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MATH = { computeLegValue, applyLedgerDelta, round4 };

export type ReceiptCorrectionPreview = {
  schemaVersion: 1;
  domain: 'receipt_chain';
  outcome: 'preview';
  eligible: true;
  manifestSha256: string;
  planSha256: string;
  previewHash: string;
  sourceStateSha256: string;
  stockStateSha256: string;
  policyStateSha256: string;
  intended: ReceiptManifestBase['intended'];
};
export type ReceiptChainReceipt = {
  correctionId: string;
  operationKey: string;
  action: 'correct' | 'compensate';
  inverseOfOperationId: string | null;
  manifestSha256: string;
  previewHash: string;
  payloadHash: string;
  sourceReceiptId: string;
  replacementReceiptId: string;
  entryMap: EntryReplacement[];
  postedAt: string;
  accountingTimezone: string;
  netCogsDelta: string;
  terminalQty: string;
  terminalValue: string;
  terminalRate: string;
};
export type ReceiptCorrectionResult = {
  schemaVersion: 1;
  domain: 'receipt_chain';
  outcome: 'applied';
  replayed: boolean;
  receipt: ReceiptChainReceipt;
};
export type ReceiptCorrectionStatus =
  | {
      schemaVersion: 1;
      domain: 'receipt_chain';
      outcome: 'applied';
      receipt: ReceiptChainReceipt;
      currentState: 'matches' | 'changed' | 'compensated';
    }
  | {
      schemaVersion: 1;
      domain: 'receipt_chain';
      outcome: 'absent_before_unchanged' | 'unknown';
      receipt: null;
    };

type Rows = Array<Record<string, unknown>>;
const run = async (tx: CoreTx, q: ReturnType<typeof sql>): Promise<Rows> =>
  (await tx.execute(q)) as unknown as Rows;
const idList = (ids: readonly string[]) =>
  sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  );
const sqlState = (e: unknown): string | null => {
  for (
    let c: unknown = e, i = 0;
    c && typeof c === 'object' && i < 5;
    c = (c as { cause?: unknown }).cause, i += 1
  ) {
    const code = (c as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
};
const TRANSPORT = new Set([
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'CONNECTION_CLOSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
]);
const isTransportLoss = (e: unknown): boolean => {
  for (
    let c: unknown = e, i = 0;
    c && typeof c === 'object' && i < 5;
    c = (c as { cause?: unknown }).cause, i += 1
  ) {
    if (TRANSPORT.has(String((c as { code?: unknown }).code))) return true;
  }
  return false;
};
const fail = (code: ReceiptCorrectionCode): never => {
  throw new ReceiptCorrectionError(code);
};
/** Classifies a thrown helper/DB error from its actual known boundary, never by parsing private text. */
function classify(e: unknown): ReceiptCorrectionError {
  if (e instanceof ReceiptCorrectionError) return e;
  if (e instanceof StockError) return new ReceiptCorrectionError(mapHelperRefusal(e.code));
  return new ReceiptCorrectionError(mapHelperRefusal(null, sqlState(e)));
}

// ───────────── authority ─────────────
function requireOwnerWithCost(c: FreshCapabilitySnapshot, apply: boolean): void {
  const ok =
    c.membershipRole === 'owner' &&
    c.capabilities.can('stock', apply ? 'manage' : 'view') &&
    c.capabilities.can('pos', 'view') &&
    c.capabilities.can('finance', 'view') &&
    c.capabilities.fieldLevel('finance') >= SENSITIVE_FIELD_LEVEL;
  if (!ok) fail('actor_unavailable'); // generic: reveals no foreign state
}
const requireProfile = (ctx: CoreCtx): string =>
  ctx.profileId && UUID_RE.test(ctx.profileId) ? ctx.profileId : fail('actor_unavailable');

// ───────────── fresh evidence in manifest shape ─────────────
type FreshChain = {
  entries: EntryEvidence[];
  consumers: Array<Record<string, unknown> & { kind: string; id: string; currentEntryId: string }>;
  opening: ReceiptManifestBase['opening'];
  binRowSha256: string;
  itemRowSha256: string;
  latestLedgerId: string;
  latestLedgerRowSha256: string;
  rangeLedgerIds: string[];
  timezone: string | null;
  /** fin_settings.currency: stock is valued in this currency (foreign typed rates are converted at entry time). */
  currency: string | null;
  lockedPeriods: string[];
  /** Metadata/party/note of each original entry, needed to copy the replacements. */
  originals: Map<
    string,
    {
      partyId: string | null;
      note: string | null;
      metadata: Record<string, unknown>;
      postedAt: string;
    }
  >;
};

const kindOf = (
  meta: Record<string, unknown>,
  type: string,
): EntryEvidence['source']['kind'] | null =>
  type === 'receipt'
    ? 'receipt'
    : meta.source === 'pos'
      ? 'pos_ticket'
      : meta.source === 'booking'
        ? 'booking'
        : null;

type Probe = {
  itemId: string;
  warehouseId: string;
  entryIds: readonly string[];
  firstLedgerId: string;
  /** Compensate reads the prior replacement chain, which is corrected provenance by design. */
  compensate?: boolean;
};
const probeOf = (m: ReceiptChainManifestV1): Probe => ({
  itemId: m.itemId,
  warehouseId: m.warehouseId,
  entryIds: m.entries.map((e) => e.entryId),
  firstLedgerId: m.entries[0].ledgerId,
  compensate: m.action === 'compensate',
});

async function readFresh(tx: CoreTx, ctx: CoreCtx, m: Probe, lock: boolean): Promise<FreshChain> {
  const org = ctx.tenantId;
  const ids = [...m.entryIds];
  const issueIds = ids.slice(1);
  const ownerFor = lock ? sql` for update` : sql``;
  // lock order after the gate: sources -> (authority done by caller) -> entries -> accruals -> bins
  const tickets = await run(
    tx,
    sql`select t.id::text id, t.stock_entry_id::text entry_id, to_jsonb(t)::text row_text,
              coalesce((select jsonb_agg(to_jsonb(p)::text order by p.id) from pos_payments p where p.org_id=t.org_id and p.ticket_id=t.id),'[]'::jsonb) pays
         from pos_tickets t where t.org_id=${org} and t.stock_entry_id in (${idList(ids)}) order by t.id${ownerFor}`,
  );
  const entries = await run(
    tx,
    sql`select e.id::text id, e.type, e.status, e.party_id::text party_id, e.note, e.metadata, to_jsonb(e)::text row_text,
              to_char(e.posted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') posted_at
         from stk_entries e where e.org_id=${org} and e.id in (${idList(ids)}) order by e.id${ownerFor}`,
  );
  const accruals = await run(
    tx,
    sql`select a.id::text id, a.realized_entry_id::text entry_id, a.source, a.source_id::text source_id, a.realized_qty::text rq,
              a.realized_value::text rv, to_jsonb(a)::text row_text
         from stk_accruals a where a.org_id=${org} and a.realized_entry_id in (${idList(ids)}) order by a.id${ownerFor}`,
  );
  const lines = await run(
    tx,
    sql`select l.id::text id, l.entry_id::text entry_id, l.item_id::text item_id, l.qty::text qty, l.uom, l.rate::text rate,
              l.from_warehouse_id::text from_wh, l.to_warehouse_id::text to_wh, to_jsonb(l)::text row_text
         from stk_entry_lines l where l.org_id=${org} and l.entry_id in (${idList(ids)}) order by l.entry_id, l.line_no, l.id`,
  );
  const ledger = await run(
    tx,
    sql`select l.id::text id, l.entry_id::text entry_id, l.item_id::text item_id, l.warehouse_id::text warehouse_id,
              l.qty_delta::text qty_delta, l.value_delta::text value_delta, l.qty_after::text qty_after,
              l.valuation_rate::text valuation_rate, to_jsonb(l)::text row_text
         from stk_ledger l where l.org_id=${org} and l.entry_id in (${idList(ids)}) order by l.id`,
  );
  const range = await run(
    tx,
    sql`select l.id::text id, to_jsonb(l)::text row_text from stk_ledger l
         where l.org_id=${org} and l.item_id=${m.itemId}::uuid and l.warehouse_id=${m.warehouseId}::uuid and l.id >= ${m.firstLedgerId}::bigint
         order by l.id`,
  );
  const [prior] = await run(
    tx,
    sql`select l.id::text id, l.qty_after::text qty_after, l.valuation_rate::text valuation_rate, to_jsonb(l)::text row_text from stk_ledger l
         where l.org_id=${org} and l.item_id=${m.itemId}::uuid and l.warehouse_id=${m.warehouseId}::uuid and l.id < ${m.firstLedgerId}::bigint
         order by l.id desc limit 1`,
  );
  const [bin] = await run(
    tx,
    sql`select to_jsonb(b)::text row_text from stk_bins b where b.org_id=${org} and b.item_id=${m.itemId}::uuid and b.warehouse_id=${m.warehouseId}::uuid`,
  );
  const [item] = await run(
    tx,
    sql`select to_jsonb(i)::text row_text from stk_items i where i.org_id=${org} and i.id=${m.itemId}::uuid`,
  );
  const [settings] = await run(
    tx,
    sql`select timezone, currency from fin_settings where org_id=${org}`,
  );
  const locks = await run(
    tx,
    sql`select period from pos_period_locks where org_id=${org} order by period`,
  );
  if (!bin || !item || entries.length !== ids.length) fail('stale_preview');
  if (!m.compensate) {
    const [replaced] = await run(
      tx,
      sql`select 1 from stk_corrections where org_id=${org} and kind='receipt_chain' and replacement_entry_id in (${idList(ids)}) limit 1`,
    );
    if (replaced) fail('unsupported_movement');
  }

  const byEntry = (rows: Rows, id: string) => rows.filter((r) => String(r.entry_id) === id);
  const originals: FreshChain['originals'] = new Map();
  const evidence: EntryEvidence[] = ids.map((id, idx) => {
    const e = entries.find((r) => String(r.id) === id)!;
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const ls = byEntry(lines, id);
    const lg = byEntry(ledger, id);
    // shape errors are unsupported history, not a silently first-row-selected plan
    if (e.status !== 'submitted' || ls.length !== 1 || lg.length !== 1)
      fail('unsupported_movement');
    // correct mode never re-corrects: corrected provenance in the chain is unsupported (only compensate may read it)
    if (!m.compensate && ('correctionOf' in meta || 'compensatesOperation' in meta))
      fail('unsupported_movement');
    const kind = kindOf(meta, String(e.type));
    const srcId =
      kind === 'receipt' ? id : typeof meta.sourceId === 'string' ? meta.sourceId : null;
    // exactly one receipt (first) then ordinary issues: a second receipt/transfer/adjustment is unsupported
    if (!kind || !srcId || e.type !== (idx === 0 ? 'receipt' : 'issue'))
      fail('unsupported_movement');
    const [l] = ls;
    const [g] = lg;
    if (
      String(l.item_id) !== m.itemId ||
      String(g.item_id) !== m.itemId ||
      String(g.warehouse_id) !== m.warehouseId
    )
      fail('unsupported_movement');
    originals.set(id, {
      partyId: (e.party_id as string | null) ?? null,
      note: (e.note as string | null) ?? null,
      metadata: meta,
      postedAt: String(e.posted_at),
    });
    return {
      entryId: id,
      headerRowSha256: sha256(String(e.row_text)),
      lineId: String(l.id),
      lineRowSha256: sha256(String(l.row_text)),
      type: e.type as 'receipt' | 'issue',
      ledgerId: String(g.id),
      ledgerRowSha256: sha256(String(g.row_text)),
      qty: String(l.qty),
      uom: (l.uom as string | null) ?? null,
      rate: l.rate === null ? null : String(l.rate),
      qtyDelta: String(g.qty_delta),
      valueDelta: String(g.value_delta),
      qtyAfter: String(g.qty_after),
      valuationRate: String(g.valuation_rate),
      source: { kind, id: srcId } as EntryEvidence['source'],
    };
  });
  const consumers: FreshChain['consumers'] = [
    ...tickets.map((t) => ({
      kind: 'pos_ticket',
      id: String(t.id),
      rowSha256: sha256(String(t.row_text)),
      currentEntryId: String(t.entry_id),
      financialFiscalSha256: ticketFinancialSha256(String(t.row_text), t.pays as string[]),
    })),
    ...accruals.map((a) => ({
      kind: 'stock_accrual',
      id: String(a.id),
      rowSha256: sha256(String(a.row_text)),
      currentEntryId: String(a.entry_id),
      sourceType: String(a.source),
      sourceId: String(a.source_id),
      realizedQty: a.rq === null ? '' : String(a.rq),
      realizedValue: a.rv === null ? '' : String(a.rv),
    })),
  ].sort((x, y) => (x.kind + x.id < y.kind + y.id ? -1 : 1));
  const last = range[range.length - 1];
  void issueIds;
  return {
    entries: evidence,
    consumers,
    opening: prior
      ? {
          qty: String(prior.qty_after),
          valuationRate: String(prior.valuation_rate),
          value: String(Number(prior.qty_after) * Number(prior.valuation_rate)),
          ledgerId: String(prior.id),
          rowSha256: sha256(String(prior.row_text)),
        }
      : { qty: '0', value: '0', valuationRate: '0', ledgerId: null, rowSha256: null },
    binRowSha256: sha256(String(bin.row_text)),
    itemRowSha256: sha256(String(item.row_text)),
    latestLedgerId: String(last?.id ?? ''),
    latestLedgerRowSha256: sha256(String(last?.row_text ?? '')),
    rangeLedgerIds: range.map((r) => String(r.id)),
    timezone: (settings?.timezone as string | undefined) ?? null,
    currency: (settings?.currency as string | undefined) ?? null,
    lockedPeriods: locks.map((r) => String(r.period)),
    originals,
  };
}

/** Every approved fact must still hold; any delta is stale/conflict before a write. */
function verifyFresh(
  m: ReceiptChainManifestV1,
  f: FreshChain,
): { sourceStateSha256: string; stockStateSha256: string; policyStateSha256: string } {
  if (canonical(f.entries) !== canonical(m.entries)) fail('stale_preview');
  if (Number(m.intended.receiptQty) !== Number(m.entries[0].qty)) fail('invariant_failed');
  if (f.rangeLedgerIds.join() !== m.entries.map((e) => e.ledgerId).join()) fail('stale_preview'); // a new movement after preview
  // consumers: same set, same row hashes, same frozen values; replacement ids and intended values are manifest-only
  const approved = m.consumers.map((c) =>
    c.kind === 'pos_ticket'
      ? {
          kind: c.kind,
          id: c.id,
          rowSha256: c.rowSha256,
          currentEntryId: c.currentEntryId,
          financialFiscalSha256: c.financialFiscalSha256,
        }
      : {
          kind: c.kind,
          id: c.id,
          rowSha256: c.rowSha256,
          currentEntryId: c.currentEntryId,
          sourceType: c.sourceType,
          sourceId: c.sourceId,
          realizedQty: c.realizedQty,
          realizedValue: c.realizedValue,
        },
  );
  if (canonical(f.consumers) !== canonical(approved)) fail('stale_preview');
  if (canonical(f.opening) !== canonical(m.opening)) fail('stale_preview');
  const b = m.before;
  if (
    f.binRowSha256 !== b.binRowSha256 ||
    f.itemRowSha256 !== b.itemRowSha256 ||
    f.latestLedgerId !== b.latestLedgerId ||
    f.latestLedgerRowSha256 !== b.latestLedgerRowSha256
  )
    fail('stale_preview');
  // the document total is only trusted in the org's stock valuation currency
  if (m.action === 'correct' && m.basis.valuationCurrency !== f.currency) fail('invariant_failed');
  // period policy: verified zone equals fresh finance settings; correction month unlocked
  if (
    f.timezone === null ||
    f.timezone !== m.accountingTimezone ||
    f.lockedPeriods.includes(m.correctionMonth)
  )
    fail('period_unavailable');
  const policy = policyStateDigest({
    accountingTimezone: m.accountingTimezone,
    correctionMonth: m.correctionMonth,
    actorProfileId: m.actorProfileId,
    lockedPeriods: f.lockedPeriods,
  });
  if (policy !== b.policyStateSha256) fail('stale_preview');
  // the approved effects must be exactly what the source engine produces now (independent of caller authority)
  const replan = planCorrectEffects(
    { entries: m.entries, entryMap: m.entryMap, receiptRate: m.intended.receiptRate },
    MATH,
  );
  if (
    canonical(replan) !==
    canonical({
      effects: m.intended.effects,
      terminalQty: m.intended.terminalQty,
      terminalValue: m.intended.terminalValue,
      terminalRate: m.intended.terminalRate,
      netCogsDelta: m.intended.netCogsDelta,
    })
  )
    fail('invariant_failed');
  m.consumers.forEach((c) => {
    if (c.kind !== 'stock_accrual') return;
    const eff = m.intended.effects.find(
      (x) => x.phase === 'issue' && x.entryId === c.replacementEntryId,
    );
    if (!eff || c.intendedRealizedValue !== String(round4(-Number(eff.valueDelta))))
      fail('invariant_failed');
  });
  return {
    sourceStateSha256: m.before.sourceStateSha256,
    stockStateSha256: stockStateDigest(m),
    policyStateSha256: policy,
  };
}

const hashesOf = (
  m: ReceiptChainManifestV1,
  d: { sourceStateSha256: string; stockStateSha256: string; policyStateSha256: string },
) => {
  const manifestSha256 = receiptManifestSha256(m);
  const previewHash = receiptPreviewHash({ manifestSha256, ...d });
  return {
    manifestSha256,
    previewHash,
    payloadHash: receiptPayloadHash({
      orgId: m.orgId,
      actorProfileId: m.actorProfileId,
      manifestSha256,
      previewHash,
    }),
  };
};

function receiptOf(row: typeof stkCorrections.$inferSelect): ReceiptChainReceipt {
  const intended = row.intended as {
    action: 'correct' | 'compensate';
    inverseOfOperationId: string | null;
    domainManifest: ReceiptChainManifestV1;
    manifestSha256: string;
  };
  const m = intended.domainManifest;
  return {
    correctionId: row.id,
    operationKey: row.operationKey,
    action: intended.action,
    inverseOfOperationId: intended.inverseOfOperationId ?? null,
    manifestSha256: intended.manifestSha256,
    previewHash: row.previewHash,
    payloadHash: row.payloadHash,
    sourceReceiptId: m.sourceReceiptId,
    replacementReceiptId: row.replacementEntryId as string,
    entryMap: m.entryMap,
    postedAt: m.postedAt,
    accountingTimezone: m.accountingTimezone,
    netCogsDelta: m.intended.netCogsDelta,
    terminalQty: m.intended.terminalQty,
    terminalValue: m.intended.terminalValue,
    terminalRate: m.intended.terminalRate,
  };
}

const RETRY = new Set(['40001', '40P01', '55P03']);
/** One owned write transaction: lock 1 s, statement 12 s, 60 s overall, 3 attempts on confirmed rollbacks only (F3 protocol). */
async function writeTransaction<T>(
  ctx: CoreCtx,
  fn: (tx: CoreTx, guard: StockWriteGuard) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + 60_000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withOrgCore(ctx, async (tx) => {
        await tx.execute(sql`set local lock_timeout = '1000ms'`);
        await tx.execute(sql`set local statement_timeout = '12000ms'`);
        return fn(tx, await lockStockWrite(tx, ctx));
      });
    } catch (e) {
      const code = sqlState(e);
      if (!code || !RETRY.has(code) || attempt >= 3 || Date.now() >= deadline) throw e;
      await new Promise((r) => setTimeout(r, attempt === 1 ? 40 : 80));
    }
  }
}
function readSnapshot<T>(ctx: CoreCtx, fn: (tx: CoreTx) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    return withOrgCoreTransaction(ctx, tx as unknown as CoreTx, fn);
  });
}

// ───────────── manifest producer (review finding F2-R6-IR-001) ─────────────
export type DraftReceiptCorrectionInput = {
  target: ReceiptManifestBase['target'];
  sourceCodeSha: string;
  operationKey: string;
  receiptEntryId: string;
  receiptLineId: string;
  basis: DocumentBasis;
  postedAt: string;
  reason: string;
  ownerApprovalReference: string;
  /** Preallocated replacement UUIDs in entry order; generated when omitted so a retry can reuse a saved draft instead. */
  replacementIds?: readonly string[];
};
const monthOf = (iso: string, tz: string): string => instantMonthKey(new Date(iso), tz);

type AssembleInput = {
  target: ReceiptManifestBase['target'];
  sourceCodeSha: string;
  operationKey: string;
  postedAt: string;
  reason: string;
  ownerApprovalReference: string;
  replacementIds?: readonly string[];
  receiptRate: string;
  receiptQty: string;
  stockUom: string;
  tail:
    | { action: 'correct'; basis: DocumentBasis }
    | {
        action: 'compensate';
        inverseOfOperationId: string;
        basis: {
          policy: 'restore_prior_before_snapshot';
          priorManifestSha256: string;
          originalDocumentSha256: string;
        };
      };
};
/** Shared manifest assembly for both actions: digests and engine effects are derived, never typed. */
function assemble(
  ctx: CoreCtx,
  profile: string,
  probe: Probe,
  f: FreshChain,
  input: AssembleInput,
): ReceiptChainManifestV1 {
  if (f.timezone === null) return fail('period_unavailable');
  const ids = input.replacementIds ?? f.entries.map(() => randomUUID());
  const entryMap = f.entries.map((e, i) => ({
    sourceEntryId: e.entryId,
    replacementEntryId: ids[i],
  }));
  const receiptRate = input.receiptRate;
  const planned = planCorrectEffects({ entries: f.entries, entryMap, receiptRate }, MATH);
  const consumers = f.consumers.map((c) => {
    const idx = f.entries.findIndex((e) => e.entryId === c.currentEntryId);
    const replacementEntryId = entryMap[idx].replacementEntryId;
    if (c.kind === 'pos_ticket') return { ...c, replacementEntryId } as unknown as ConsumerEvidence;
    const eff = planned.effects.find(
      (x) => x.phase === 'issue' && x.entryId === replacementEntryId,
    )!;
    return {
      ...c,
      replacementEntryId,
      intendedRealizedValue: String(round4(-Number(eff.valueDelta))),
    } as unknown as ConsumerEvidence;
  });
  const before = {
    binRowSha256: f.binRowSha256,
    latestLedgerId: f.latestLedgerId,
    latestLedgerRowSha256: f.latestLedgerRowSha256,
    itemRowSha256: f.itemRowSha256,
    ruleStateSha256: ruleStateDigest(f.entries),
    sourceStateSha256: sourceStateDigest(f.entries, consumers),
    financialFiscalSha256: financialStateDigest(consumers),
    policyStateSha256: policyStateDigest({
      accountingTimezone: f.timezone,
      correctionMonth: monthOf(input.postedAt, f.timezone),
      actorProfileId: profile,
      lockedPeriods: f.lockedPeriods,
    }),
  };
  return decodeReceiptChainManifestV1(
    JSON.parse(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'receipt_chain',
        target: input.target,
        sourceCodeSha: input.sourceCodeSha,
        orgId: ctx.tenantId,
        actorProfileId: profile,
        operationKey: input.operationKey,
        sourceReceiptId: probe.entryIds[0],
        sourceReceiptLineId: f.entries[0].lineId,
        itemId: probe.itemId,
        warehouseId: probe.warehouseId,
        stockUom: input.stockUom,
        entries: f.entries,
        consumers,
        entryMap,
        opening: f.opening,
        before,
        intended: { receiptQty: input.receiptQty, receiptRate, ...planned },
        postedAt: input.postedAt,
        accountingTimezone: f.timezone,
        correctionMonth: monthOf(input.postedAt, f.timezone),
        reason: input.reason,
        ownerApprovalReference: input.ownerApprovalReference,
        ...input.tail,
      }),
    ),
  );
}
/**
 * Builds the complete executable manifest of a CORRECT operation from one read-only owned snapshot: discovers the same-key chain,
 * reads every raw-row hash, derives every digest and authors the 2x(1+n) engine effects. The owner reviews and approves the
 * result; nothing here writes. Unsupported/ambiguous shapes refuse; the diagnostic CLI/report remains the explanatory artifact.
 */
export async function draftReceiptCorrectionManifest(
  ctx: CoreCtx,
  input: DraftReceiptCorrectionInput,
): Promise<ReceiptChainManifestV1> {
  const profile = requireProfile(ctx);
  try {
    return await readSnapshot(ctx, async (tx) => {
      requireOwnerWithCost(
        await resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile),
        false,
      );
      const [own] = await run(
        tx,
        sql`select l.id::text id, l.item_id::text item_id, l.warehouse_id::text wh from stk_ledger l where l.org_id=${ctx.tenantId} and l.entry_id=${input.receiptEntryId}::uuid`,
      );
      const lineRows = await run(
        tx,
        sql`select l.id::text id, l.item_id::text item_id from stk_entry_lines l where l.org_id=${ctx.tenantId} and l.entry_id=${input.receiptEntryId}::uuid`,
      );
      if (!own || lineRows.length !== 1 || String(lineRows[0].id) !== input.receiptLineId)
        return fail('unsupported_movement');
      const chain = await run(
        tx,
        sql`select l.entry_id::text entry_id from stk_ledger l where l.org_id=${ctx.tenantId} and l.item_id=${String(own.item_id)}::uuid and l.warehouse_id=${String(own.wh)}::uuid and l.id >= ${String(own.id)}::bigint order by l.id limit 130`,
      );
      if (chain.length > 129 || new Set(chain.map((r) => r.entry_id)).size !== chain.length)
        return fail('unsupported_movement');
      const probe: Probe = {
        itemId: String(own.item_id),
        warehouseId: String(own.wh),
        entryIds: chain.map((r) => String(r.entry_id)),
        firstLedgerId: String(own.id),
      };
      const f = await readFresh(tx, ctx, probe, false);
      const rb = receiptRateBasis(input.basis.totalValuation, input.basis.stockQty);
      if (input.basis.valuationCurrency !== f.currency || !residualMatches(input.basis))
        return fail('invariant_failed');
      return assemble(ctx, profile, probe, f, {
        target: input.target,
        sourceCodeSha: input.sourceCodeSha,
        operationKey: input.operationKey,
        postedAt: input.postedAt,
        reason: input.reason,
        ownerApprovalReference: input.ownerApprovalReference,
        replacementIds: input.replacementIds,
        receiptRate: rb.receiptRate,
        receiptQty: input.basis.stockQty,
        stockUom: input.basis.unitQualification.stockUom,
        tail: { action: 'correct', basis: input.basis },
      });
    });
  } catch (e) {
    throw classify(e);
  }
}

// ───────────── explicit compensation (action 'compensate') ─────────────
type PriorOperation = {
  id: string;
  manifestSha256: string;
  manifest: Extract<ReceiptChainManifestV1, { action: 'correct' }>;
};
/** The one applied same-org receipt_chain CORRECT operation an inverse may undo; inverse-of-inverse and foreign keys refuse. */
async function readPrior(tx: CoreTx, ctx: CoreCtx, id: string): Promise<PriorOperation> {
  const [row] = await tx
    .select()
    .from(stkCorrections)
    .where(and(eq(stkCorrections.orgId, ctx.tenantId), eq(stkCorrections.id, id)));
  const it = row?.intended as
    | { action?: string; manifestSha256?: string; domainManifest?: ReceiptChainManifestV1 }
    | undefined;
  if (!row || row.kind !== 'receipt_chain' || !it?.domainManifest || !it.manifestSha256)
    return fail('source_conflict');
  if (it.action !== 'correct' || it.domainManifest.action !== 'correct')
    return fail('unsupported_movement');
  return { id: row.id, manifestSha256: it.manifestSha256, manifest: it.domainManifest };
}
/** The inverse manifest must be exactly the prior immutable map and restored rate, never client-edited restoration facts. */
async function assertPrior(tx: CoreTx, ctx: CoreCtx, m: ReceiptChainManifestV1): Promise<void> {
  if (m.action !== 'compensate') return;
  const { manifest: p, manifestSha256 } = await readPrior(tx, ctx, m.inverseOfOperationId);
  const sameConsumers =
    canonical(m.consumers.map((c) => c.id).sort()) ===
    canonical(p.consumers.map((c) => c.id).sort());
  const ok =
    m.basis.priorManifestSha256 === manifestSha256 &&
    m.basis.originalDocumentSha256 === p.basis.sha256 &&
    canonical(m.entries.map((e) => e.entryId)) ===
      canonical(p.entryMap.map((x) => x.replacementEntryId)) &&
    m.itemId === p.itemId &&
    m.warehouseId === p.warehouseId &&
    m.stockUom === p.stockUom &&
    p.entries[0].rate !== null &&
    String(Number(m.intended.receiptRate)) === String(Number(p.entries[0].rate)) &&
    Number(m.intended.receiptQty) === Number(p.entries[0].qty) &&
    sameConsumers;
  if (!ok) fail('invariant_failed');
  // every restored issue cost and accrual value equals the prior originals (correction.md §129), not just bin qty/rate
  const near = (a: unknown, b: unknown) => Math.abs(Number(a) - Number(b)) <= 1e-8;
  const issueFx = m.intended.effects.filter((x) => x.phase === 'issue');
  const exact =
    issueFx.length === p.entries.length - 1 &&
    issueFx.every((x, i) => near(x.valueDelta, p.entries[i + 1].valueDelta)) &&
    m.consumers.every((c) => {
      if (c.kind !== 'stock_accrual') return true;
      const j = p.entryMap.findIndex((x) => x.replacementEntryId === c.currentEntryId);
      return j > 0 && near(c.intendedRealizedValue, round4(-Number(p.entries[j].valueDelta)));
    });
  if (!exact) fail('invariant_failed');
}

export type DraftReceiptCompensationInput = {
  target: ReceiptManifestBase['target'];
  sourceCodeSha: string;
  operationKey: string;
  inverseOfOperationId: string;
  postedAt: string;
  reason: string;
  ownerApprovalReference: string;
  replacementIds?: readonly string[];
};
/** Producer of the INVERSE manifest from the immutable prior operation; restored facts come from it, never from the caller. */
export async function draftReceiptCompensationManifest(
  ctx: CoreCtx,
  input: DraftReceiptCompensationInput,
): Promise<ReceiptChainManifestV1> {
  const profile = requireProfile(ctx);
  try {
    return await readSnapshot(ctx, async (tx) => {
      requireOwnerWithCost(
        await resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile),
        false,
      );
      const prior = await readPrior(tx, ctx, input.inverseOfOperationId);
      const p = prior.manifest;
      const rate = p.entries[0].rate;
      if (rate === null) return fail('unsupported_movement');
      const replacementIds = p.entryMap.map((x) => x.replacementEntryId);
      const [own] = await run(
        tx,
        sql`select min(l.id)::text id from stk_ledger l where l.org_id=${ctx.tenantId} and l.entry_id=${replacementIds[0]}::uuid`,
      );
      if (!own?.id) return fail('unsupported_movement');
      const probe: Probe = {
        itemId: p.itemId,
        warehouseId: p.warehouseId,
        entryIds: replacementIds,
        firstLedgerId: String(own.id),
        compensate: true,
      };
      const f = await readFresh(tx, ctx, probe, false);
      return assemble(ctx, profile, probe, f, {
        target: input.target,
        sourceCodeSha: input.sourceCodeSha,
        operationKey: input.operationKey,
        postedAt: input.postedAt,
        reason: input.reason,
        ownerApprovalReference: input.ownerApprovalReference,
        replacementIds: input.replacementIds,
        receiptRate: rate,
        receiptQty: p.intended.receiptQty,
        stockUom: p.stockUom,
        tail: {
          action: 'compensate',
          inverseOfOperationId: prior.id,
          basis: {
            policy: 'restore_prior_before_snapshot',
            priorManifestSha256: prior.manifestSha256,
            originalDocumentSha256: p.basis.sha256,
          },
        },
      });
    });
  } catch (e) {
    throw classify(e);
  }
}

// ───────────── preview / apply / status ─────────────
export async function previewReceiptCorrection(
  ctx: CoreCtx,
  manifestInput: unknown,
): Promise<ReceiptCorrectionPreview> {
  let m: ReceiptChainManifestV1;
  try {
    m = decodeReceiptChainManifestV1(manifestInput);
  } catch {
    return fail('invalid_manifest');
  }
  const profile = requireProfile(ctx);
  if (m.orgId !== ctx.tenantId || m.actorProfileId !== profile) fail('target_mismatch');
  try {
    return await readSnapshot(ctx, async (tx) => {
      requireOwnerWithCost(
        await resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile),
        false,
      );
      await assertPrior(tx, ctx, m);
      const digests = verifyFresh(m, await readFresh(tx, ctx, probeOf(m), false));
      const h = hashesOf(m, digests);
      return {
        schemaVersion: 1,
        domain: 'receipt_chain',
        outcome: 'preview',
        eligible: true,
        manifestSha256: h.manifestSha256,
        planSha256: h.manifestSha256,
        previewHash: h.previewHash,
        ...digests,
        intended: m.intended,
      } as ReceiptCorrectionPreview;
    });
  } catch (e) {
    throw classify(e);
  }
}

export async function applyReceiptCorrection(
  ctx: CoreCtx,
  commandInput: unknown,
  actor: Actor,
): Promise<ReceiptCorrectionResult> {
  let command: ReturnType<typeof decodeReceiptCorrectionCommand>;
  try {
    command = decodeReceiptCorrectionCommand(commandInput);
  } catch {
    return fail('invalid_command');
  }
  const m = command.manifest;
  const profile = requireProfile(ctx);
  if (actor.id !== profile || m.actorProfileId !== profile || m.orgId !== ctx.tenantId)
    fail('target_mismatch');
  try {
    return await writeTransaction(ctx, async (tx, guard) => {
      // 1. fresh authority under both gates (also for replays), then idempotency (org-global key namespace)
      requireOwnerWithCost(
        await resolveFreshOperatorCapabilitiesForWriteInTransaction(tx, ctx.tenantId, profile),
        true,
      );
      const [existing] = await tx
        .select()
        .from(stkCorrections)
        .where(
          and(
            eq(stkCorrections.orgId, ctx.tenantId),
            eq(stkCorrections.operationKey, m.operationKey),
          ),
        );
      if (existing) {
        const claimed = receiptPayloadHash({
          orgId: m.orgId,
          actorProfileId: profile,
          manifestSha256: receiptManifestSha256(m),
          previewHash: command.previewHash,
        });
        if (existing.payloadHash !== claimed || existing.actorId !== profile) fail('key_reuse');
        return {
          schemaVersion: 1,
          domain: 'receipt_chain',
          outcome: 'applied',
          replayed: true,
          receipt: receiptOf(existing),
        } as ReceiptCorrectionResult;
      }
      // 2. module state read directly
      await assertStockModulesEnabledInTx(tx, ctx, guard, ['stock', 'finances']);
      // 3. lock + re-read everything the approval covers
      await assertPrior(tx, ctx, m);
      const fresh = await readFresh(tx, ctx, probeOf(m), true);
      const bins = await lockBinsInTx(tx, ctx, guard, [
        { itemId: m.itemId, warehouseId: m.warehouseId },
      ]);
      const digests = verifyFresh(m, fresh);
      const h = hashesOf(m, digests);
      if (h.previewHash !== command.previewHash) fail('stale_preview');
      const postedAt = new Date(m.postedAt);
      // 4. reverse issues descending, then the receipt (originals stay as cancelled evidence)
      for (const e of [...m.entries.slice(1)].reverse())
        await cancelEntryInTx(tx, ctx, guard, e.entryId, actor, { bins, postedAt });
      await cancelEntryInTx(tx, ctx, guard, m.entries[0].entryId, actor, { bins, postedAt });
      // 5. replacement receipt (only the unit rate changes; raw uom incl. null preserved) then issues ascending
      for (const [i, e] of m.entries.entries()) {
        const o = fresh.originals.get(e.entryId)!;
        const replacementId = m.entryMap[i].replacementEntryId;
        // an inverse restores the pre-correction document: drop the corrected receipt's document hash, keep the first original time
        const { correctionDocumentSha256: _stale, ...inherited } = o.metadata;
        const metadata = {
          ...(m.action === 'compensate' ? inherited : o.metadata),
          correctionOf: e.entryId,
          correctionOperationKey: m.operationKey,
          originalPostedAt:
            m.action === 'compensate' && typeof o.metadata.originalPostedAt === 'string'
              ? o.metadata.originalPostedAt
              : o.postedAt,
          ...(m.action === 'compensate' ? { compensatesOperation: m.inverseOfOperationId } : {}),
          ...(i === 0 && m.action === 'correct'
            ? { correctionDocumentSha256: m.basis.sha256 }
            : {}),
        };
        const draft = await createEntryInTx(
          tx,
          ctx,
          guard,
          {
            type: e.type,
            partyId: o.partyId,
            note: o.note,
            metadata,
            lines: [
              i === 0
                ? {
                    itemId: m.itemId,
                    qty: Number(e.qty),
                    rate: Number(m.intended.receiptRate),
                    uom: e.uom,
                    toWarehouseId: m.warehouseId,
                  }
                : {
                    itemId: m.itemId,
                    qty: Number(e.qty),
                    uom: e.uom,
                    fromWarehouseId: m.warehouseId,
                  },
            ],
          },
          actor,
          { entryId: replacementId },
        );
        await submitEntryInTx(tx, ctx, guard, draft.id, actor, { bins, postedAt });
      }
      // 6. consumer relinking, compare-before; ticket financial/fiscal columns and dates are untouched
      for (const c of m.consumers) {
        const hit =
          c.kind === 'pos_ticket'
            ? await run(
                tx,
                sql`update pos_tickets set stock_entry_id=${c.replacementEntryId}::uuid where org_id=${ctx.tenantId} and id=${c.id}::uuid and stock_entry_id=${c.currentEntryId}::uuid returning id`,
              )
            : await run(
                tx,
                sql`update stk_accruals set realized_entry_id=${c.replacementEntryId}::uuid, realized_value=${c.intendedRealizedValue}, updated_at=${m.postedAt}::timestamptz where org_id=${ctx.tenantId} and id=${c.id}::uuid and realized_entry_id=${c.currentEntryId}::uuid returning id`,
              );
        if (hit.length !== 1) fail('source_conflict');
      }
      // 7. assert actual generated rows equal the approved effects (exponent-expanded readback compares String(Number(text)))
      const produced = await run(
        tx,
        sql`select l.qty_delta::text qd, l.value_delta::text vd, l.qty_after::text qa, l.valuation_rate::text vr from stk_ledger l
             where l.org_id=${ctx.tenantId} and l.item_id=${m.itemId}::uuid and l.warehouse_id=${m.warehouseId}::uuid and l.id > ${m.before.latestLedgerId}::bigint order by l.id`,
      );
      const same = (a: unknown, b: string) => String(Number(a)) === b;
      if (
        produced.length !== m.intended.effects.length ||
        produced.some((p, i) => {
          const f = m.intended.effects[i];
          return !(
            same(p.qd, f.qtyDelta) &&
            same(p.vd, f.valueDelta) &&
            same(p.qa, f.qtyAfter) &&
            same(p.vr, f.valuationRate)
          );
        })
      )
        fail('invariant_failed');
      const [binNow] = await run(
        tx,
        sql`select qty::text qty, valuation_rate::text rate from stk_bins where org_id=${ctx.tenantId} and item_id=${m.itemId}::uuid and warehouse_id=${m.warehouseId}::uuid`,
      );
      if (
        !binNow ||
        !same(binNow.qty, m.intended.terminalQty) ||
        !same(binNow.rate, m.intended.terminalRate)
      )
        fail('invariant_failed');
      // 8. ONE immutable receipt + audit in the same commit
      const consumersAfter = m.consumers.map((c) => ({
        ...c,
        currentEntryId: c.replacementEntryId,
      }));
      const [row] = await tx
        .insert(stkCorrections)
        .values({
          orgId: ctx.tenantId,
          operationKey: m.operationKey,
          kind: 'receipt_chain',
          sourceType: 'stock_receipt',
          sourceId: m.sourceReceiptId,
          sourceEntryId: m.sourceReceiptId,
          replacementEntryId: m.entryMap[0].replacementEntryId,
          payloadHash: h.payloadHash,
          previewHash: h.previewHash,
          reason: m.reason,
          actorId: profile,
          before: {
            entries: m.entries,
            consumers: m.consumers,
            opening: m.opening,
            stock: m.before,
          },
          intended: {
            domain: 'receipt_chain',
            action: m.action,
            inverseOfOperationId: m.action === 'compensate' ? m.inverseOfOperationId : null,
            domainManifest: m,
            manifestSha256: h.manifestSha256,
            previewHash: h.previewHash,
            payloadHash: h.payloadHash,
          },
          after: {
            entryMap: m.entryMap,
            ledgerRowCount: produced.length,
            consumers: consumersAfter,
            actualEffects: m.intended.effects,
          },
          appliedAt: postedAt,
        })
        .returning();
      await recordAuditInTx(tx, ctx, {
        refType: 'stk_entry',
        refId: m.sourceReceiptId,
        op: 'workflow',
        changes: [
          {
            field: 'correction',
            label: 'Corrección de valoración de recepción',
            old: m.reason,
            new: row.id,
          },
        ],
        actor,
      });
      return {
        schemaVersion: 1,
        domain: 'receipt_chain',
        outcome: 'applied',
        replayed: false,
        receipt: receiptOf(row),
      } as ReceiptCorrectionResult;
    });
  } catch (e) {
    // A unique violation on (org, operation_key) is a concurrent same-key attempt; the winner's receipt is authoritative.
    if (sqlState(e) === '23505') throw new ReceiptCorrectionError('source_conflict');
    // Transport loss around COMMIT is unknown, never proof of rollback.
    if (isTransportLoss(e)) throw new ReceiptCorrectionError('commit_outcome_unknown');
    throw classify(e);
  }
}

export async function getReceiptCorrectionStatus(
  ctx: CoreCtx,
  input: unknown,
): Promise<ReceiptCorrectionStatus> {
  let s: ReturnType<typeof decodeReceiptCorrectionStatusInput>;
  try {
    s = decodeReceiptCorrectionStatusInput(input);
  } catch {
    return fail('invalid_command');
  }
  const profile = requireProfile(ctx);
  if (s.actorProfileId !== profile || s.orgId !== ctx.tenantId) fail('target_mismatch');
  try {
    return await readSnapshot(ctx, async (tx) => {
      requireOwnerWithCost(
        await resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile),
        false,
      );
      const [row] = await tx
        .select()
        .from(stkCorrections)
        .where(
          and(
            eq(stkCorrections.orgId, ctx.tenantId),
            eq(stkCorrections.operationKey, s.operationKey),
          ),
        );
      if (row) {
        const intended = row.intended as { action: string; manifestSha256: string };
        if (intended.action !== s.action || intended.manifestSha256 !== s.manifestSha256)
          fail('key_reuse');
        const receipt = receiptOf(row);
        const [later] = await run(
          tx,
          sql`select 1 from stk_corrections where org_id=${ctx.tenantId} and kind='receipt_chain' and source_entry_id=${receipt.replacementReceiptId}::uuid and intended->>'action'='compensate' and intended->>'inverseOfOperationId'=${receipt.correctionId} limit 1`,
        );
        const [latest] = await run(
          tx,
          sql`select max(id)::text id from stk_ledger where org_id=${ctx.tenantId} and item_id=${s.manifest.itemId}::uuid and warehouse_id=${s.manifest.warehouseId}::uuid`,
        );
        const [lastRepl] = await run(
          tx,
          sql`select max(id)::text id from stk_ledger where org_id=${ctx.tenantId} and entry_id in (${idList(receipt.entryMap.map((p) => p.replacementEntryId))})`,
        );
        const currentState = later
          ? 'compensated'
          : latest?.id === lastRepl?.id
            ? 'matches'
            : 'changed';
        return {
          schemaVersion: 1,
          domain: 'receipt_chain',
          outcome: 'applied',
          receipt,
          currentState,
        } as ReceiptCorrectionStatus;
      }
      // no receipt: compare the complete approved before-state in this same snapshot
      try {
        await assertPrior(tx, ctx, s.manifest);
        verifyFresh(s.manifest, await readFresh(tx, ctx, probeOf(s.manifest), false));
        return {
          schemaVersion: 1,
          domain: 'receipt_chain',
          outcome: 'absent_before_unchanged',
          receipt: null,
        } as ReceiptCorrectionStatus;
      } catch {
        return {
          schemaVersion: 1,
          domain: 'receipt_chain',
          outcome: 'unknown',
          receipt: null,
        } as ReceiptCorrectionStatus;
      }
    });
  } catch (e) {
    throw classify(e);
  }
}
