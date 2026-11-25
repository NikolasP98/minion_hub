/**
 * Auditable stock correction workflow (spec 124): preview / apply / status for `variant_swap`
 * (same-price product swap on a submitted sale) and `receipt_replace` (standalone receipt). One gated
 * transaction does cancel -> create -> submit -> stamp -> immutable receipt + audit, or nothing.
 *
 * TODO(handoff): (T011) the retry wrapper covers ONLY correction transactions; participant wrappers keep
 * their own timeouts. (T023) no blocked-evidence projection with F1/F2 links, GET-by-id detail or operator
 * CLI loader key yet. Owner currency attestation (valuation-qualification.md: `valuation` envelope,
 * owner-only proof, qualified cost currency) is NOT built in the engine or the UI, so cost lines render
 * unformatted; private garment `stock_only` entrypoints are not wired, and a public `stock_only` is
 * refused (owner_evidence_required). See meta proposals/2026-11-17-hub-stock-correction-handoff.md.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { LockHit } from '$lib/types/record-locks';
import { getOrgTransactionDb } from '$server/db/pg-client';
import { withOrgCore, withOrgCoreTransaction, type CoreTx } from '$server/db/with-org-core';
import {
  stkCorrections,
  stkEntries,
  stkEntryLines,
  stkBins,
  stkItems,
} from '$server/db/pg-schema/stock';
import { posTicketLines } from '$server/db/pg-pos-schema';
import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
import {
  resolveFreshCapabilitiesReadOnlyInTransaction,
  resolveFreshOperatorCapabilitiesForWriteInTransaction,
  type FreshCapabilitySnapshot,
} from './rbac.service';
import {
  OperatorAuthorityError,
  sqlStateOf as sqlState,
} from '$server/auth/active-operator-principal';
import { recordAuditInTx } from './activity.service';
import {
  consumeUnlockInTx,
  lockRefusalError,
  personActor,
  recordLockFor,
} from './record-locks.service';
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
import {
  PosError,
  applySaleVariantPlanInTx,
  planSaleVariantInTx,
  type SaleVariantPlan,
} from './pos.service';
import {
  CorrectionError,
  parsePreviewRequest,
  parseReason,
  payloadHashOf,
  previewHashOf,
  changesValue,
  validateReceiptReplacement,
  type PreviewRequest,
  type ReceiptDelta,
  type ReceiptLine,
  type ReceiptPeriodEvaluation,
  type OriginalReceiptLine,
} from './stock-corrections.logic';

export interface CorrectionCommand {
  request: PreviewRequest;
  operationKey: string;
  previewHash: string;
  payloadHash: string;
  reason: string;
}

/**
 * Server-only option for the existing till swap routes (never read from a request body): the swap keeps
 * today's POS-edit-only authority and binds the path ticket to the line's ticket. Mixed and stock-moving
 * swaps therefore keep working for a POS user exactly as before; value-changing receipts never use it.
 */
export interface PosScope {
  ticketId: string;
}

export interface CorrectionPreview {
  schemaVersion: 1;
  domain: 'sale_variant' | 'receipt_replace';
  eligible: boolean;
  blockers: string[];
  previewHash: string;
  payloadHash: string;
  productChange: { from: string; to: string } | null;
  quantityEffects: { itemId: string; before: string; after: string }[];
  /** Rates/values only with the finance cost authority; absent otherwise. */
  cost: { lines: { lineId: string; kind: 'qty' | 'rate'; before: string; after: string }[] } | null;
}

export interface CorrectionReceipt {
  id: string;
  kind: string;
  operationKey: string;
  sourceType: string;
  sourceId: string;
  sourceEntryId: string | null;
  replacementEntryId: string | null;
  reason: string;
  actorId: string;
  appliedAt: string;
}
export type CorrectionResult =
  | { schemaVersion: 1; outcome: 'applied'; replayed: boolean; receipt: CorrectionReceipt }
  | { schemaVersion: 1; outcome: 'not_found' };

/** A deleting principal or an inactive organization is refused by the authority bridge: a plain 403, no private data. */
export async function active<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof OperatorAuthorityError) {
      // Only a definite refusal is a 403; limit/inconsistent/unavailable are not the caller's fault (503).
      if (e.code === 'operator_principal_inactive' || e.code === 'operator_scope_invalid')
        throw new CorrectionError('not allowed', 'forbidden');
      throw new CorrectionError('authority is unavailable, try again', 'unavailable');
    }
    throw e;
  }
}

// ── authority ────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function costAuthority(c: FreshCapabilitySnapshot): boolean {
  return (
    c.capabilities.can('finance', 'view') &&
    c.capabilities.fieldLevel('finance') >= SENSITIVE_FIELD_LEVEL
  );
}
const can = (c: FreshCapabilitySnapshot, m: string, a: 'view' | 'edit' | 'manage') =>
  c.capabilities.can(m, a);

/** Throws forbidden / stock_scope_required; returns whether a cost-bearing apply would be allowed. */
function sourceAuthority(
  caps: FreshCapabilitySnapshot,
  domain: 'sale_variant' | 'receipt_replace',
  movesStock: boolean,
  valueChange: boolean,
  apply: boolean,
  posScope = false,
): { costVisible: boolean } {
  const deny = (why: string) => new CorrectionError(why, 'forbidden');
  if (domain === 'sale_variant') {
    if (!can(caps, 'pos', 'view') || !can(caps, 'pos', 'edit')) throw deny('needs POS edit');
    // The existing till swap keeps its POS-edit-only authority (orchestrator decision 1/2).
    if (posScope) return { costVisible: false };
    if (!movesStock) return { costVisible: false };
    if (!can(caps, 'stock', 'view'))
      throw new CorrectionError(
        'stock access is required for this correction',
        'stock_scope_required',
      );
    if (apply && (!can(caps, 'stock', 'manage') || !costAuthority(caps)))
      throw deny('needs stock management and cost access');
    return { costVisible: costAuthority(caps) };
  }
  if (!can(caps, 'stock', 'view')) throw deny('needs stock access');
  if (apply && (!can(caps, 'stock', 'manage') || !costAuthority(caps)))
    throw deny('needs stock management and cost access');
  // Corrections that change stock VALUE (rate) are owner-only (orchestrator decision 2).
  if (apply && valueChange && caps.membershipRole !== 'owner')
    throw deny('only an owner may correct a stock value');
  return { costVisible: costAuthority(caps) };
}

/**
 * Coarse admission by SOURCE TYPE, run before any source read or lock: the same uniform `forbidden`
 * answer whether or not the source exists (no existence oracle). The precise effect-based
 * `sourceAuthority` re-check still runs after planning.
 */
export function coarseAuthority(
  caps: FreshCapabilitySnapshot,
  request: PreviewRequest,
  apply: boolean,
): void {
  const ok =
    request.sourceType === 'pos_ticket_line'
      ? can(caps, 'pos', 'view') && can(caps, 'pos', 'edit')
      : apply
        ? can(caps, 'stock', 'manage')
        : can(caps, 'stock', 'view');
  if (!ok) throw new CorrectionError('not allowed', 'forbidden');
}

// ── snapshots ────────────────────────────────────────────────────────────────────────────

type Rows = Array<Record<string, unknown>>;
const rowsOf = (r: unknown): Rows => r as unknown as Rows;

async function ledgerSnapshot(tx: CoreTx, ctx: CoreCtx, entryIds: string[]) {
  if (!entryIds.length) return [];
  // ledger ids are read as TEXT: the drizzle column is mode:'number' and must not narrow bigserial.
  return rowsOf(
    await tx.execute(sql`select id::text as id, entry_id::text as entry_id, item_id::text as item_id,
        warehouse_id::text as warehouse_id, qty_delta::text as qty_delta, value_delta::text as value_delta
      from stk_ledger where org_id = ${ctx.tenantId} and entry_id in (${sql.join(
        entryIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}) order by id`),
  );
}
async function binSnapshot(
  tx: CoreTx,
  ctx: CoreCtx,
  keys: { itemId: string; warehouseId: string }[],
) {
  const uniq = [...new Map(keys.map((k) => [`${k.itemId}:${k.warehouseId}`, k])).values()].sort(
    (a, b) => (`${a.itemId}:${a.warehouseId}` < `${b.itemId}:${b.warehouseId}` ? -1 : 1),
  );
  const out: {
    itemId: string;
    warehouseId: string;
    exists: boolean;
    qty: string | null;
    rate: string | null;
  }[] = [];
  for (const k of uniq) {
    const [b] = await tx
      .select({ qty: stkBins.qty, rate: stkBins.valuationRate })
      .from(stkBins)
      .where(
        and(
          eq(stkBins.orgId, ctx.tenantId),
          eq(stkBins.itemId, k.itemId),
          eq(stkBins.warehouseId, k.warehouseId),
        ),
      );
    out.push({ ...k, exists: !!b, qty: b ? String(b.qty) : null, rate: b ? String(b.rate) : null });
  }
  return out;
}

function policyOf(caps: FreshCapabilitySnapshot, extra: unknown) {
  return {
    membershipRole: caps.membershipRole,
    roles: [...caps.realRoles].sort(),
    pos: ['view', 'edit'].map((a) => can(caps, 'pos', a as 'view')),
    stock: ['view', 'manage'].map((a) => can(caps, 'stock', a as 'view')),
    finance: can(caps, 'finance', 'view'),
    financeLevel: caps.capabilities.fieldLevel('finance'),
    extra,
  };
}

// ── planning (shared by preview and apply) ────────────────────────────────────────────────

interface SalePlanned {
  domain: 'sale_variant';
  plan: SaleVariantPlan;
  sourceId: string;
  sourceSnapshot: unknown;
  stockSnapshot: unknown;
  policyExtra: unknown;
  movesStock: boolean;
  valueChange: false;
}
interface ReceiptPlanned {
  domain: 'receipt_replace';
  original: typeof stkEntries.$inferSelect;
  originalLines: (typeof stkEntryLines.$inferSelect)[];
  replacement: ReceiptLine[];
  deltas: ReceiptDelta[];
  period: ReceiptPeriodEvaluation;
  sourceId: string;
  sourceSnapshot: unknown;
  stockSnapshot: unknown;
  policyExtra: unknown;
  /** Spec 140 S3: the owner unlock this plan relies on (consumed by the apply), and the hits it overrides. */
  unlock: { eventId: string; rules: LockHit[] } | null;
  movesStock: true;
  valueChange: boolean;
}
type Planned = SalePlanned | ReceiptPlanned;

function mapPos(e: unknown): never {
  if (e instanceof CorrectionError) throw e;
  if (e instanceof StockError) {
    const map: Record<string, CorrectionError['code']> = {
      negative_stock: 'negative_stock',
      duplicate_source: 'duplicate_source',
      module_disabled: 'module_disabled',
    };
    throw new CorrectionError(e.message, map[e.code] ?? 'dependent_history');
  }
  if (e instanceof PosError) {
    // Legacy POS codes keep their meaning; the closed list folds the rest into dependent_history.
    const direct = [
      'not_found',
      'price_differs',
      'stock_drift',
      'negative_stock',
      'period_locked',
      'record_locked',
    ];
    throw new CorrectionError(
      e.message,
      (direct.includes(e.code) ? e.code : 'dependent_history') as CorrectionError['code'],
      e.items,
      e.code,
    );
  }
  throw e;
}

async function plan(
  tx: CoreTx,
  ctx: CoreCtx,
  request: PreviewRequest,
  opts: { lock: boolean; now: Date; ticketId?: string },
): Promise<Planned> {
  if (request.mode === 'variant_swap') {
    let p: SaleVariantPlan;
    try {
      p = await planSaleVariantInTx(tx, ctx, {
        lineId: request.sourceId,
        expectedProductId: request.expectedProductId,
        productId: request.replacement.productId,
        lock: opts.lock,
      });
    } catch (e) {
      return mapPos(e);
    }
    // The swap routes bind the path ticket to the line's real ticket; a foreign pair is a plain 404.
    if (opts.ticketId && p.ticket.id !== opts.ticketId)
      throw new CorrectionError('line not found', 'not_found');
    const ledger = p.liveEntryId ? await ledgerSnapshot(tx, ctx, [p.liveEntryId]) : [];
    const bins = await binSnapshot(tx, ctx, [
      ...p.frozenOriginal.map((l) => ({ itemId: l.itemId, warehouseId: l.fromWarehouseId })),
      ...p.newLines.map((l) => ({ itemId: l.itemId, warehouseId: l.fromWarehouseId })),
    ]);
    return {
      domain: 'sale_variant',
      plan: p,
      sourceId: p.line.id,
      movesStock: p.movesStock,
      valueChange: false,
      policyExtra: null,
      sourceSnapshot: {
        ticket: { id: p.ticket.id, status: p.ticket.status, stockEntryId: p.ticket.stockEntryId },
        line: {
          id: p.line.id,
          productId: p.line.finProductId,
          description: p.line.description,
          qty: String(p.line.qty),
          bookingId: p.line.bookingId,
        },
        visitRows: p.visitRows,
        replacementProductId: p.newProduct.id,
      },
      stockSnapshot: {
        entryId: p.liveEntryId,
        ledger,
        bins,
        frozen: p.frozenOriginal,
        newLines: p.newLines,
        oldByItem: p.oldByItem,
        newByItem: p.newByItem,
      },
    };
  }

  // receipt_replace
  const [original] = await (opts.lock
    ? tx
        .select()
        .from(stkEntries)
        .where(and(eq(stkEntries.id, request.sourceId), eq(stkEntries.orgId, ctx.tenantId)))
        .for('update')
    : tx
        .select()
        .from(stkEntries)
        .where(and(eq(stkEntries.id, request.sourceId), eq(stkEntries.orgId, ctx.tenantId))));
  if (!original) throw new CorrectionError('receipt not found', 'not_found');
  const meta = (original.metadata ?? {}) as Record<string, unknown>;
  if (original.type !== 'receipt' || meta.source || meta.invoiceId || meta.sourceId)
    throw new CorrectionError('not a standalone receipt', 'source_ambiguous');
  if (original.status !== 'submitted')
    throw new CorrectionError(`receipt is ${original.status}`, 'dependent_history');
  const originalLines = await tx
    .select()
    .from(stkEntryLines)
    .where(eq(stkEntryLines.entryId, original.id))
    .orderBy(stkEntryLines.lineNo);
  if (!originalLines.length || !original.postedAt)
    throw new CorrectionError('receipt provenance is incomplete', 'source_ambiguous');
  const prior = await tx
    .select({ id: stkCorrections.id })
    .from(stkCorrections)
    .where(
      and(eq(stkCorrections.orgId, ctx.tenantId), eq(stkCorrections.sourceEntryId, original.id)),
    )
    .limit(1);
  if (prior.length) throw new CorrectionError('receipt was already corrected', 'dependent_history');

  // A line stored without a UOM is in its item's stock UOM (no implicit conversion exists).
  const itemUoms = new Map(
    (
      await tx
        .select({ id: stkItems.id, uom: stkItems.uom })
        .from(stkItems)
        .where(
          and(
            eq(stkItems.orgId, ctx.tenantId),
            inArray(
              stkItems.id,
              originalLines.map((l) => l.itemId),
            ),
          ),
        )
    ).map((i) => [i.id, i.uom]),
  );
  let deltas: ReceiptDelta[];
  try {
    deltas = validateReceiptReplacement(
      originalLines.map((l): OriginalReceiptLine => ({
        id: l.id,
        itemId: l.itemId,
        qty: String(l.qty),
        rate: l.rate == null ? null : String(l.rate),
        uom: l.uom ?? itemUoms.get(l.itemId) ?? null,
        toWarehouseId: l.toWarehouseId,
      })),
      request.replacement.lines,
    );
  } catch (e) {
    throw e;
  }
  const binKeys = originalLines.map((l) => ({
    itemId: l.itemId,
    warehouseId: l.toWarehouseId as string,
  }));
  // No later movement on any affected bin (bigserial compare stays in SQL).
  const [later] = rowsOf(
    await tx.execute(sql`select count(*)::int as n from stk_ledger l
      where l.org_id = ${ctx.tenantId}
        and (l.item_id, l.warehouse_id) in (${sql.join(
          binKeys.map((k) => sql`(${k.itemId}::uuid, ${k.warehouseId}::uuid)`),
          sql`, `,
        )})
        and l.id > (select max(id) from stk_ledger where entry_id = ${original.id}::uuid and org_id = ${ctx.tenantId})`),
  ) as Array<{ n: number }>;
  if ((later?.n ?? 0) > 0)
    throw new CorrectionError('later stock movements depend on this receipt', 'dependent_history');

  const lock = await recordLockFor(
    tx,
    ctx.tenantId,
    { type: 'stock_receipt', id: original.id, postedAt: original.postedAt },
    { now: opts.now },
  );
  if (lock.locked) throw lockRefusalError(lock);
  const period = lock.period;
  return {
    domain: 'receipt_replace',
    original,
    originalLines,
    replacement: request.replacement.lines,
    deltas,
    period,
    sourceId: original.id,
    movesStock: true,
    valueChange: changesValue(deltas),
    unlock: lock.unlock ? { eventId: lock.unlock.eventId, rules: lock.rules } : null,
    // Without a policy row (or an unlock) the extra is exactly what it was before spec 140 (open previews stay valid).
    policyExtra: {
      receiptPeriodPolicy: period,
      locks: [...lock.lockedPeriods].sort(),
      ...(lock.hasPolicyRow
        ? { lockPolicy: { rules: lock.policy, externalLockIds: lock.externalLockIds } }
        : {}),
      ...(lock.unlock ? { unlockEventId: lock.unlock.eventId } : {}),
    },
    sourceSnapshot: {
      entry: {
        id: original.id,
        status: original.status,
        postedAt: original.postedAt.toISOString(),
        metadata: meta,
      },
      lines: originalLines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        qty: String(l.qty),
        rate: l.rate == null ? null : String(l.rate),
        uom: l.uom ?? itemUoms.get(l.itemId) ?? null,
        toWarehouseId: l.toWarehouseId,
      })),
    },
    stockSnapshot: {
      ledger: await ledgerSnapshot(tx, ctx, [original.id]),
      bins: await binSnapshot(tx, ctx, binKeys),
    },
  };
}

// ── transactions ─────────────────────────────────────────────────────────────────────────

const RETRY_CODES = new Set(['40001', '40P01', '55P03']);

/** One owned write transaction: lock_timeout 1 s, statement_timeout 12 s, 60 s overall, 3 attempts (40 ms, 80 ms) on confirmed rollbacks only. */
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
      if (!code || !RETRY_CODES.has(code) || attempt >= 3 || Date.now() >= deadline) {
        if (code && RETRY_CODES.has(code))
          throw new CorrectionError('stock is busy, try again', 'unavailable');
        throw e;
      }
      await new Promise((r) => setTimeout(r, attempt === 1 ? 40 : 80));
    }
  }
}

/** READ ONLY REPEATABLE READ snapshot (preview/status): the bridge's nonlocking mode requires it. */
function readSnapshot<T>(ctx: CoreCtx, fn: (tx: CoreTx) => Promise<T>): Promise<T> {
  return getOrgTransactionDb(ctx.db).transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    return withOrgCoreTransaction(ctx, tx as unknown as CoreTx, fn);
  });
}

function requireProfile(ctx: CoreCtx): string {
  if (!ctx.profileId || !UUID_RE.test(ctx.profileId))
    throw new CorrectionError('an authenticated profile is required', 'forbidden');
  return ctx.profileId;
}

function modulesFor(p: { domain: Planned['domain']; movesStock: boolean }, posScope = false) {
  if (posScope) return ['pos'] as const;
  return p.domain === 'receipt_replace'
    ? (['stock', 'finances'] as const)
    : p.movesStock
      ? (['stock', 'pos', 'finances'] as const)
      : (['pos'] as const);
}

function describe(p: Planned, costVisible: boolean) {
  if (p.domain === 'sale_variant') {
    const items = new Set([...Object.keys(p.plan.oldByItem), ...Object.keys(p.plan.newByItem)]);
    return {
      productChange: { from: p.plan.oldProductId, to: p.plan.newProduct.id },
      quantityEffects: [...items].sort().map((itemId) => ({
        itemId,
        before: String(-(p.plan.oldByItem[itemId] ?? 0)),
        after: String(-(p.plan.newByItem[itemId] ?? 0)),
      })),
      cost: null,
    };
  }
  return {
    productChange: null,
    quantityEffects: p.deltas
      .filter((d) => d.kind === 'qty')
      .map((d) => ({
        itemId: p.originalLines.find((l) => l.id === d.lineId)!.itemId,
        before: d.before,
        after: d.after,
      })),
    cost: costVisible ? { lines: p.deltas } : null,
  };
}

function hashes(
  ctx: CoreCtx,
  actor: string,
  request: PreviewRequest,
  p: Planned,
  caps: FreshCapabilitySnapshot,
  reason: string,
) {
  const previewHash = previewHashOf({
    orgId: ctx.tenantId,
    actorProfileId: actor,
    request,
    sourceSnapshot: p.sourceSnapshot,
    stockSnapshot: p.stockSnapshot,
    policySnapshot: policyOf(caps, p.policyExtra),
  });
  return {
    previewHash,
    payloadHash: payloadHashOf({
      orgId: ctx.tenantId,
      actorProfileId: actor,
      request,
      previewHash,
      reason,
    }),
  };
}

/** Read-only preview in its own READ ONLY snapshot. Advisory: apply re-plans under the gate. */
export async function previewStockCorrection(
  ctx: CoreCtx,
  rawRequest: unknown,
  rawReason: unknown,
  scope?: PosScope,
): Promise<CorrectionPreview> {
  const actor = requireProfile(ctx);
  const request = parsePreviewRequest(rawRequest);
  const reason = parseReason(rawReason);
  return readSnapshot(ctx, async (tx) => {
    const caps = await active(
      resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, actor),
    );
    coarseAuthority(caps, request, false);
    // A POS-only caller may have a stockless swap checked; nonempty stock intent needs stock access.
    let p: Planned;
    try {
      p = await plan(tx, ctx, request, { lock: false, now: new Date(), ticketId: scope?.ticketId });
    } catch (e) {
      return mapPos(e);
    }
    const { costVisible } = sourceAuthority(
      caps,
      p.domain,
      p.movesStock,
      p.valueChange,
      false,
      !!scope,
    );
    const blockers: string[] = [];
    if (p.movesStock && !costVisible && !scope) blockers.push('cost_visibility_required');
    if (p.valueChange && caps.membershipRole !== 'owner') blockers.push('owner_required');
    const d = describe(p, costVisible);
    return {
      schemaVersion: 1,
      domain: p.domain,
      eligible: blockers.length === 0,
      blockers,
      ...hashes(ctx, actor, request, p, caps, reason),
      ...d,
    };
  });
}

function receiptOf(row: typeof stkCorrections.$inferSelect): CorrectionReceipt {
  return {
    id: row.id,
    kind: row.kind,
    operationKey: row.operationKey,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceEntryId: row.sourceEntryId,
    replacementEntryId: row.replacementEntryId,
    reason: row.reason,
    actorId: row.actorId,
    appliedAt: row.appliedAt.toISOString(),
  };
}

/** Apply one correction atomically. Same key + payload replays the recorded result; a changed intent under a used key is key_reuse. */
export async function applyStockCorrection(
  ctx: CoreCtx,
  command: CorrectionCommand,
  actor: Actor,
  scope?: PosScope,
): Promise<CorrectionResult> {
  const profile = requireProfile(ctx);
  if (actor.id !== profile)
    throw new CorrectionError('actor must be the signed-in profile', 'forbidden');
  const request = parsePreviewRequest(command.request);
  const reason = parseReason(command.reason);
  if (!UUID_RE.test(command.operationKey))
    throw new CorrectionError('operationKey must be a UUID', 'invalid_request');

  // Refuse before ANY lock or source read: a read-only snapshot answers the coarse check.
  await readSnapshot(ctx, async (tx) =>
    coarseAuthority(
      await active(resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile)),
      request,
      true,
    ),
  );
  try {
    return await writeTransaction(ctx, async (tx, guard) => {
      // 1. Idempotency first: the key namespace is per org and global across kinds.
      const [existing] = await tx
        .select()
        .from(stkCorrections)
        .where(
          and(
            eq(stkCorrections.orgId, ctx.tenantId),
            eq(stkCorrections.operationKey, command.operationKey),
          ),
        );
      if (existing) {
        // Recompute from the supplied fields: a changed reason/request/actor can never reuse a hash it did not produce.
        const claimed = payloadHashOf({
          orgId: ctx.tenantId,
          actorProfileId: profile,
          request,
          previewHash: command.previewHash,
          reason,
        });
        if (existing.payloadHash !== claimed || existing.actorId !== profile)
          throw new CorrectionError('operation key already used for another intent', 'key_reuse');
        return {
          schemaVersion: 1,
          outcome: 'applied',
          replayed: true,
          receipt: receiptOf(existing),
        } as CorrectionResult;
      }
      // 2. Fresh authority under both gates, then module state read directly.
      const caps = await active(
        resolveFreshOperatorCapabilitiesForWriteInTransaction(tx, ctx.tenantId, profile),
      );
      coarseAuthority(caps, request, true);
      const now = new Date();
      let p: Planned;
      try {
        p = await plan(tx, ctx, request, { lock: true, now, ticketId: scope?.ticketId });
      } catch (e) {
        return mapPos(e);
      }
      sourceAuthority(caps, p.domain, p.movesStock, p.valueChange, true, !!scope);
      try {
        await assertStockModulesEnabledInTx(tx, ctx, guard, modulesFor(p, !!scope));
      } catch (e) {
        return mapPos(e);
      }
      // 3. The approved preview must still describe reality.
      const h = hashes(ctx, profile, request, p, caps, reason);
      if (h.previewHash !== command.previewHash)
        throw new CorrectionError('the source changed since the preview', 'stale_preview');
      if (h.payloadHash !== command.payloadHash)
        throw new CorrectionError('payload does not match the approved preview', 'invalid_request');

      // 4. Write.
      let kind: 'sale_variant' | 'receipt_replace';
      let sourceEntryId: string | null;
      let replacementEntryId: string | null;
      let after: Record<string, unknown>;
      try {
        if (p.domain === 'sale_variant') {
          kind = 'sale_variant';
          const fx = await applySaleVariantPlanInTx(tx, ctx, guard, p.plan, {
            actor,
            operationKey: command.operationKey,
          });
          sourceEntryId = fx.sourceEntryId;
          replacementEntryId = fx.replacementEntryId;
          after = {
            visitProduct: fx.visitProduct,
            newLines: p.plan.newLines,
            entryMap: fx.sourceEntryId ? { [fx.sourceEntryId]: fx.replacementEntryId } : {},
          };
        } else {
          kind = 'receipt_replace';
          const bins = await lockBinsInTx(
            tx,
            ctx,
            guard,
            p.originalLines.map((l) => ({
              itemId: l.itemId,
              warehouseId: l.toWarehouseId as string,
            })),
          );
          await cancelEntryInTx(tx, ctx, guard, p.original.id, actor, { bins });
          const om = (p.original.metadata ?? {}) as Record<string, unknown>;
          const rateChanged = p.deltas.some((d) => d.kind === 'rate');
          const metadata: Record<string, unknown> = {
            correctionOf: p.original.id,
            correctionOperationKey: command.operationKey,
            ...(om.purchaseId !== undefined ? { purchaseId: om.purchaseId } : {}),
            ...(om.providerRef !== undefined ? { providerRef: om.providerRef } : {}),
            // FX conversion keys describe the ORIGINAL rate; keep them only when the rate is unchanged.
            ...(!rateChanged
              ? Object.fromEntries(
                  ['currency', 'fxRate', 'fxUpdatedAt']
                    .filter((k) => k in om)
                    .map((k) => [k, om[k]]),
                )
              : {}),
          };
          const draft = await createEntryInTx(
            tx,
            ctx,
            guard,
            {
              type: 'receipt',
              partyId: p.original.partyId,
              note: p.original.note,
              metadata,
              lines: p.replacement.map((l) => ({
                itemId: l.itemId,
                qty: Number(l.qty),
                rate: Number(l.rate),
                uom: l.uom,
                toWarehouseId: l.toWarehouseId,
              })),
            },
            actor,
          );
          const { entry } = await submitEntryInTx(tx, ctx, guard, draft.id, actor, { bins });
          sourceEntryId = p.original.id;
          replacementEntryId = entry.id;
          after = { deltas: p.deltas, entryMap: { [p.original.id]: entry.id } };
        }
      } catch (e) {
        return mapPos(e);
      }

      // 5. ONE immutable receipt + audit, same commit.
      const [row] = await tx
        .insert(stkCorrections)
        .values({
          orgId: ctx.tenantId,
          operationKey: command.operationKey,
          kind,
          sourceType: p.domain === 'sale_variant' ? 'pos_ticket_line' : 'stock_receipt',
          sourceId: p.sourceId,
          sourceEntryId,
          replacementEntryId,
          payloadHash: h.payloadHash,
          previewHash: h.previewHash,
          reason,
          actorId: profile,
          before: {
            source: p.sourceSnapshot,
            stock: p.stockSnapshot,
            policy: policyOf(caps, p.policyExtra),
          },
          intended: { request },
          after,
          appliedAt: now,
        })
        .returning();
      // Spec 140 S3: the unlock the plan relied on is used up by this correction, in the same commit.
      if (p.domain === 'receipt_replace' && p.unlock)
        await consumeUnlockInTx(
          tx,
          ctx.tenantId,
          {
            eventId: p.unlock.eventId,
            recordId: p.original.id,
            correctionId: row.id,
            rules: p.unlock.rules,
          },
          personActor(ctx, actor.name),
        );
      await recordAuditInTx(tx, ctx, {
        refType: p.domain === 'sale_variant' ? 'pos_ticket' : 'stk_entry',
        refId: p.domain === 'sale_variant' ? p.plan.ticket.id : p.original.id,
        op: 'workflow',
        changes: [{ field: 'correction', label: 'Corrección de stock', old: reason, new: row.id }],
        actor,
      });
      return {
        schemaVersion: 1,
        outcome: 'applied',
        replayed: false,
        receipt: receiptOf(row),
      } as CorrectionResult;
    });
  } catch (e) {
    // A unique violation on (org, operation_key) is a concurrent same-key attempt that lost the race.
    if (sqlState(e) === '23505' && constraintOf(e) === 'stk_corrections_org_operation_key_uniq')
      throw new CorrectionError('another request holds this operation key', 'operation_conflict');
    throw e;
  }
}

export function constraintOf(e: unknown): string | null {
  for (
    let c = e, i = 0;
    c && typeof c === 'object' && i < 5;
    c = (c as { cause?: unknown }).cause, i += 1
  ) {
    const n = c as { constraint_name?: unknown; constraint?: unknown };
    const v = n.constraint_name ?? n.constraint;
    if (typeof v === 'string') return v;
  }
  return null;
}

/** Swapping a line to the product it already carries is a successful no-op (legacy till behavior): no write, no receipt. */
export async function isSwapNoOp(
  ctx: CoreCtx,
  ticketId: string,
  lineId: string,
  productId: string,
): Promise<boolean> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ id: posTicketLines.id })
      .from(posTicketLines)
      .where(
        and(
          eq(posTicketLines.id, lineId),
          eq(posTicketLines.ticketId, ticketId),
          eq(posTicketLines.orgId, ctx.tenantId),
          eq(posTicketLines.finProductId, productId),
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}

/** Authoritative status for a lost response: the recorded outcome for a known key, or not_found. */
export async function getStockCorrectionByOperationKey(
  ctx: CoreCtx,
  input: { operationKey: string; payloadHash: string },
): Promise<CorrectionResult> {
  const profile = requireProfile(ctx);
  if (!UUID_RE.test(input.operationKey))
    throw new CorrectionError('operationKey must be a UUID', 'invalid_request');
  return readSnapshot(ctx, async (tx) => {
    const caps = await active(
      resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile),
    );
    if (!can(caps, 'pos', 'view') && !can(caps, 'stock', 'view'))
      throw new CorrectionError('not allowed', 'not_found');
    const [row] = await tx
      .select()
      .from(stkCorrections)
      .where(
        and(
          eq(stkCorrections.orgId, ctx.tenantId),
          eq(stkCorrections.operationKey, input.operationKey),
        ),
      );
    if (!row) return { schemaVersion: 1, outcome: 'not_found' } as CorrectionResult;
    if (row.payloadHash !== input.payloadHash || row.actorId !== profile)
      throw new CorrectionError('operation key already used for another intent', 'key_reuse');
    return {
      schemaVersion: 1,
      outcome: 'applied',
      replayed: true,
      receipt: receiptOf(row),
    } as CorrectionResult;
  });
}

/** The entry that replaced this receipt/sale movement, if a correction cancelled it (for the "corrected" link on the page). */
export async function getReplacementEntryId(ctx: CoreCtx, entryId: string): Promise<string | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ replacementEntryId: stkCorrections.replacementEntryId })
      .from(stkCorrections)
      .where(and(eq(stkCorrections.orgId, ctx.tenantId), eq(stkCorrections.sourceEntryId, entryId)))
      .limit(1);
    return row?.replacementEntryId ?? null;
  });
}
