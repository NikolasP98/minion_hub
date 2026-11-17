/**
 * Historical Faja M garment stock-only repost (minion-meta spec 122, contracts/repair.md): single ticket, frozen original L
 * issue, exact Q4 equality, owner-attested valuation, one gated transaction (cancel original, create+submit the M replacement,
 * stamp the ticket, immutable `sale_stock_repost` receipt, one audit). Payments, ticket facts and bookings are never touched.
 *
 * TODO(handoff): F3's garment engine/`GarmentManifestV1` is absent at this base, so this runs on F3's cancel/create/submit
 * primitives with an F1-defined closed manifest (scripts/lib/faces-garment-repost.ts). Period-lock/fiscal admission of
 * `postedAt` is NOT enforced here (use F3's period policy once its garment engine lands); production apply is an owner action.
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, withOrgCoreTransaction, type CoreTx } from '$server/db/with-org-core';
import { stkCorrections } from '$server/db/pg-schema/stock';
import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
import {
  OperatorAuthorityError,
  assertActiveOperatorPrincipalReadOnlyInTx,
  readOperatorAuthorityForWriteInTx,
} from '$server/auth/active-operator-principal';
import {
  resolveFreshCapabilitiesReadOnlyInTransaction,
  resolveFreshOperatorCapabilitiesForWriteInTransaction,
  type FreshCapabilitySnapshot,
} from './rbac.service';
import { recordAuditInTx } from './activity.service';
import {
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
  decodeGarmentRepostManifestV1,
  garmentManifestSha256,
  planGarmentRepost,
  type GarmentFacts,
  type GarmentRepostCommand,
  type GarmentRepostManifestV1,
} from '../../../scripts/lib/faces-garment-repost';
import {
  UUID_RE,
  canonicalSha256,
  cmpStr,
  decodeStockEntrySource,
  fixed4,
  parseDec,
  q4,
  type Digest,
} from '../../../scripts/lib/faces-stock-reconciliation';

export type RepostErrorCode =
  | 'forbidden'
  | 'stale'
  | 'blocked'
  | 'key_reuse'
  | 'operation_conflict'
  | 'invalid_request'
  | 'invariant_failed';
export class RepostError extends Error {
  constructor(
    message: string,
    readonly code: RepostErrorCode,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'RepostError';
  }
}
type Rows = Record<string, unknown>[];
const run = (tx: CoreTx, q: ReturnType<typeof sql>) => tx.execute(q) as unknown as Promise<Rows>;
const str = (v: unknown) => String(v);
const HASH = sql.raw(`encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')`);
const uuidList = (ids: readonly string[]) =>
  ids.length
    ? sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )
    : sql`null::uuid`;

async function active<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof OperatorAuthorityError) throw new RepostError('not allowed', 'forbidden');
    throw e;
  }
}
function admit(c: FreshCapabilitySnapshot): void {
  const k = c.capabilities;
  if (
    c.membershipRole !== 'owner' ||
    !k.can('stock', 'manage') ||
    !k.can('pos', 'view') ||
    !k.can('finance', 'view') ||
    k.fieldLevel('finance') < SENSITIVE_FIELD_LEVEL
  )
    throw new RepostError('not allowed', 'forbidden');
}
const profileOf = (ctx: CoreCtx): string => {
  if (!ctx.profileId || !UUID_RE.test(ctx.profileId))
    throw new RepostError('an authenticated profile is required', 'forbidden');
  return ctx.profileId;
};
function readSnapshot<T>(ctx: CoreCtx, fn: (tx: CoreTx) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    await tx.execute(sql`set local time zone 'UTC'`);
    return withOrgCoreTransaction(ctx, tx as unknown as CoreTx, fn);
  });
}
const sqlState = (e: unknown): string | null => {
  for (
    let c: unknown = e, i = 0;
    c && typeof c === 'object' && i < 5;
    i += 1, c = (c as { cause?: unknown }).cause
  ) {
    const code = (c as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
};

interface Ids {
  ticketId: string;
  ticketLineId: string;
  productId: string;
  originalEntryId: string;
  fromItemId: string;
  toItemId: string;
  warehouseId: string;
  mappingCorrectionId: string | null;
}
const idsOf = (m: GarmentRepostManifestV1): Ids => ({
  ticketId: m.ticketId,
  ticketLineId: m.ticketLineId,
  productId: m.productId,
  originalEntryId: m.originalEntryId,
  fromItemId: m.fromItemId,
  toItemId: m.toItemId,
  warehouseId: m.warehouseId,
  mappingCorrectionId: m.mappingCorrectionId,
});

/** Everything the plan and the fingerprint depend on, read under the caller's snapshot or gate pair. */
export async function readGarmentFacts(tx: CoreTx, ctx: CoreCtx, id: Ids) {
  const org = ctx.tenantId;
  const [ticket] = await run(
    tx,
    sql`select t.id::text as id, t.status, t.stock_entry_id::text as stock_entry_id, ${HASH} as h from pos_tickets t where t.org_id = ${org} and t.id = ${id.ticketId}::uuid`,
  );
  if (!ticket) throw new RepostError('ticket unavailable', 'blocked', 'incomplete_evidence');
  const lines = await run(
    tx,
    sql`select t.id::text as id, t.ticket_id::text as ticket_id, t.fin_product_id::text as fin_product_id, t.qty::text as qty, ${HASH} as h from pos_ticket_lines t where t.org_id = ${org} and t.ticket_id = ${id.ticketId}::uuid order by t.id`,
  );
  const payments = await run(
    tx,
    sql`select t.id::text as id, ${HASH} as h from pos_payments t where t.org_id = ${org} and t.ticket_id = ${id.ticketId}::uuid order by t.id`,
  );
  const [entry] = await run(
    tx,
    sql`select t.id::text as id, t.type, t.status, t.metadata, encode(sha256(convert_to(t.metadata::text,'UTF8')),'hex') as msha, ${HASH} as h from stk_entries t where t.org_id = ${org} and t.id = ${id.originalEntryId}::uuid`,
  );
  if (!entry) throw new RepostError('original entry unavailable', 'blocked', 'incomplete_evidence');
  const entryLines = await run(
    tx,
    sql`select t.id::text as id, t.item_id::text as item_id, t.qty::text as qty, t.from_warehouse_id::text as wh, t.uom, ${HASH} as h from stk_entry_lines t where t.org_id = ${org} and t.entry_id = ${id.originalEntryId}::uuid order by t.id`,
  );
  const ledger = await run(
    tx,
    sql`select t.id::text as id, ${HASH} as h from stk_ledger t where t.org_id = ${org} and t.entry_id = ${id.originalEntryId}::uuid order by t.id`,
  );
  const keys = [id.fromItemId, id.toItemId];
  const bins = await run(
    tx,
    sql`select t.item_id::text as item_id, t.qty::text as qty, t.valuation_rate::text as rate, ${HASH} as h from stk_bins t where t.org_id = ${org} and t.warehouse_id = ${id.warehouseId}::uuid and t.item_id in (${uuidList(keys)}) order by t.item_id`,
  );
  const latest = await run(
    tx,
    sql`select distinct on (t.item_id) t.item_id::text as item_id, t.id::text as id, ${HASH} as h from stk_ledger t where t.org_id = ${org} and t.warehouse_id = ${id.warehouseId}::uuid and t.item_id in (${uuidList(keys)}) order by t.item_id, t.id desc`,
  );
  const recipe = await run(
    tx,
    sql`select t.item_id::text as item_id from stk_consumption t where t.org_id = ${org} and t.fin_product_id = ${id.productId}::uuid`,
  );
  let receiptOk = false;
  if (id.mappingCorrectionId) {
    const [r] = await run(
      tx,
      sql`select t.after, t.kind, t.source_id::text as source_id from stk_corrections t where t.org_id = ${org} and t.id = ${id.mappingCorrectionId}::uuid`,
    );
    const after = r?.after as { mappingState?: { recipe?: { itemId: string }[] } } | undefined;
    receiptOk =
      !!r &&
      r.kind === 'product_mapping' &&
      r.source_id === id.productId &&
      after?.mappingState?.recipe?.[0]?.itemId === id.toItemId;
  }
  const fingerprintSha256 = canonicalSha256({
    ticket: ticket.h,
    lines: lines.map((l) => [l.id, l.h]),
    payments: payments.map((p) => [p.id, p.h]),
    entry: entry.h,
    entryLines: entryLines.map((l) => [l.id, l.h]),
    ledger: ledger.map((l) => [l.id, l.h]),
    bins: keys.map((k) => [k, bins.find((b) => b.item_id === k)?.h ?? null]),
    latest: keys.map((k) => [
      k,
      latest.find((b) => b.item_id === k)?.id ?? null,
      latest.find((b) => b.item_id === k)?.h ?? null,
    ]),
  });
  const mLine = lines.find((l) => l.id === id.ticketLineId);
  const facts: GarmentFacts = {
    ticket: {
      id: str(ticket.id),
      status: str(ticket.status),
      stockEntryId: ticket.stock_entry_id === null ? null : str(ticket.stock_entry_id),
    },
    line: {
      id: str(mLine?.id ?? ''),
      ticketId: str(mLine?.ticket_id ?? ''),
      finProductId: mLine?.fin_product_id === null || !mLine ? null : str(mLine.fin_product_id),
      qty: str(mLine?.qty ?? '0'),
    },
    entry: {
      id: str(entry.id),
      type: str(entry.type),
      status: str(entry.status),
      metadata: entry.metadata,
      metadataSha256: str(entry.msha),
    },
    entryLines: entryLines.map((l) => ({
      itemId: str(l.item_id),
      qty: str(l.qty),
      warehouseId: l.wh === null ? null : str(l.wh),
    })),
    currentMappedItemId: recipe.length === 1 ? str(recipe[0].item_id) : null,
    mappingReceiptValid: id.mappingCorrectionId === null ? true : receiptOk,
    toBinQty:
      bins.find((b) => b.item_id === id.toItemId)?.qty === undefined
        ? null
        : str(bins.find((b) => b.item_id === id.toItemId)!.qty),
    fingerprintSha256,
  };
  return { facts, entry, entryLines, ledger, bins, latest, ticketHash: str(ticket.h) };
}

export interface GarmentDraftInput {
  target: GarmentRepostManifestV1['target'];
  actorProfileId: string;
  operationKey: string;
  ticketLineId: string;
  toItemId: string;
  mappingCorrectionId: string | null;
  inverseOfOperationId: string | null;
  currency: string;
  attestedAt: string;
  evidenceReference: string;
  evidenceSha256: string;
  postedAt: string;
  reason: string;
  ownerApprovalReference: string;
  sourceCodeSha: string;
}
/** Read-only manifest producer (review F1-R6-IR-02): derives every ID and fingerprint from the current snapshot. */
export async function draftGarmentRepostManifest(
  ctx: CoreCtx,
  d: GarmentDraftInput,
): Promise<GarmentRepostManifestV1> {
  const profile = profileOf(ctx);
  if (d.actorProfileId !== profile)
    throw new RepostError('draft actor must be the principal', 'forbidden');
  return readSnapshot(ctx, async (tx) => {
    await active(assertActiveOperatorPrincipalReadOnlyInTx(tx, ctx.tenantId, profile));
    admit(await active(resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile)));
    const [line] = await run(
      tx,
      sql`select t.ticket_id::text as ticket_id, t.fin_product_id::text as product_id from pos_ticket_lines t where t.org_id = ${ctx.tenantId} and t.id = ${d.ticketLineId}::uuid`,
    );
    if (!line || !line.product_id)
      throw new RepostError('line unavailable', 'blocked', 'incomplete_evidence');
    const [ticket] = await run(
      tx,
      sql`select t.stock_entry_id::text as e from pos_tickets t where t.org_id = ${ctx.tenantId} and t.id = ${str(line.ticket_id)}::uuid`,
    );
    if (!ticket?.e)
      throw new RepostError('ticket has no stock entry', 'blocked', 'ticket_not_stamped');
    const [el] = await run(
      tx,
      sql`select t.item_id::text as item_id, t.qty::text as qty, t.from_warehouse_id::text as wh from stk_entry_lines t where t.org_id = ${ctx.tenantId} and t.entry_id = ${str(ticket.e)}::uuid`,
    );
    if (!el || !el.wh)
      throw new RepostError('entry is not a single warehouse line', 'blocked', 'not_single_line');
    const base: Ids = {
      ticketId: str(line.ticket_id),
      ticketLineId: d.ticketLineId,
      productId: str(line.product_id),
      originalEntryId: str(ticket.e),
      fromItemId: str(el.item_id),
      toItemId: d.toItemId,
      warehouseId: str(el.wh),
      mappingCorrectionId: d.mappingCorrectionId,
    };
    const f = await readGarmentFacts(tx, ctx, base);
    const key = (itemId: string) => {
      const l = f.latest.find((x) => x.item_id === itemId);
      return {
        itemId,
        warehouseId: base.warehouseId,
        latestLedgerId: l ? str(l.id) : null,
        latestLedgerRowSha256: l ? str(l.h) : null,
      };
    };
    const raw = {
      schemaVersion: 1,
      kind: 'sale_stock_repost',
      action: d.inverseOfOperationId ? 'compensate' : 'correct',
      target: d.target,
      sourceCodeSha: d.sourceCodeSha,
      operationKey: d.operationKey,
      orgId: ctx.tenantId,
      actorProfileId: profile,
      ...base,
      qty: fixed4(q4(parseDec(str(el.qty)))),
      sourceFingerprintSha256: f.facts.fingerprintSha256,
      trueUpCoverage: 'not_covered',
      valuation: {
        schemaVersion: 1,
        kind: 'owner_attested_stock_currency',
        orgId: ctx.tenantId,
        currency: d.currency,
        attestedByProfileId: profile,
        attestedAt: d.attestedAt,
        evidenceReference: d.evidenceReference,
        evidenceSha256: d.evidenceSha256,
        keys: [key(base.fromItemId), key(base.toItemId)],
      },
      postedAt: d.postedAt,
      reason: d.reason,
      ownerApprovalReference: d.ownerApprovalReference,
      ...(d.inverseOfOperationId ? { inverseOfOperationId: d.inverseOfOperationId } : {}),
    };
    return decodeGarmentRepostManifestV1(raw);
  });
}

export type GarmentPreview =
  | {
      schemaVersion: 1;
      domain: 'sale_stock_repost';
      outcome: 'preview';
      eligible: true;
      manifestSha256: Digest;
      previewHash: Digest;
      payloadHash: Digest;
      effects: { itemId: string; warehouseId: string; qtyDelta: string }[];
      cost: { currency: string; originalIssueValue: string; replacementValueEstimate: string };
    }
  | {
      schemaVersion: 1;
      domain: 'sale_stock_repost';
      outcome: 'blocked';
      eligible: false;
      code: string;
    };

function valuationMatches(
  m: GarmentRepostManifestV1,
  f: Awaited<ReturnType<typeof readGarmentFacts>>,
): boolean {
  return m.valuation.keys.every((k) => {
    const l = f.latest.find((x) => x.item_id === k.itemId);
    return (
      (l ? str(l.id) : null) === k.latestLedgerId &&
      (l ? str(l.h) : null) === k.latestLedgerRowSha256
    );
  });
}
const policyHash = (principalStateHash: string) => canonicalSha256({ principalStateHash });
const previewHashOf = (manifestSha256: string, fingerprint: string, policy: string) =>
  canonicalSha256({
    schemaVersion: 1,
    domain: 'sale_stock_repost',
    manifestSha256,
    fingerprint,
    policy,
  });
const payloadHashOf = (orgId: string, actor: string, manifestSha256: string, previewHash: string) =>
  canonicalSha256({
    schemaVersion: 1,
    domain: 'sale_stock_repost',
    orgId,
    actor,
    manifestSha256,
    previewHash,
  });

export async function previewGarmentRepost(
  ctx: CoreCtx,
  input: GarmentRepostManifestV1,
): Promise<GarmentPreview> {
  const profile = profileOf(ctx);
  const m = decodeGarmentRepostManifestV1(input);
  if (m.orgId !== ctx.tenantId || m.actorProfileId !== profile)
    throw new RepostError('manifest does not match the principal', 'forbidden');
  return readSnapshot(ctx, async (tx) => {
    const principal = await active(
      assertActiveOperatorPrincipalReadOnlyInTx(tx, ctx.tenantId, profile),
    );
    admit(await active(resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile)));
    const f = await readGarmentFacts(tx, ctx, idsOf(m));
    const plan = planGarmentRepost(m, f.facts);
    if (!plan.eligible && plan.code === 'stale_fingerprint')
      throw new RepostError('manifest is stale against fresh state', 'stale');
    if (!plan.eligible || !valuationMatches(m, f))
      return {
        schemaVersion: 1,
        domain: 'sale_stock_repost',
        outcome: 'blocked',
        eligible: false,
        code: plan.eligible ? 'valuation_boundary_changed' : plan.code,
      };
    const manifestSha256 = garmentManifestSha256(m);
    const previewHash = previewHashOf(
      manifestSha256,
      f.facts.fingerprintSha256,
      policyHash(principal.principalStateHash),
    );
    const original = await run(
      tx,
      sql`select coalesce(sum(value_delta),0)::text as v from stk_ledger where org_id = ${ctx.tenantId} and entry_id = ${m.originalEntryId}::uuid`,
    );
    const toRate = f.bins.find((b) => b.item_id === m.toItemId)?.rate;
    return {
      schemaVersion: 1,
      domain: 'sale_stock_repost',
      outcome: 'preview',
      eligible: true,
      manifestSha256,
      previewHash,
      payloadHash: payloadHashOf(ctx.tenantId, profile, manifestSha256, previewHash),
      effects: plan.effects,
      cost: {
        currency: m.valuation.currency,
        originalIssueValue: str(original[0]?.v ?? '0'),
        replacementValueEstimate:
          toRate === undefined ? '0' : String(Number(toRate) * Number(m.qty)),
      },
    };
  });
}

export interface RepostReceipt {
  correctionId: string;
  operationKey: string;
  action: 'correct' | 'compensate';
  manifestSha256: Digest;
  previewHash: Digest;
  payloadHash: Digest;
  sourceEntryId: string;
  replacementEntryId: string;
  fingerprintBefore: Digest;
  fingerprintAfter: Digest;
  postedAt: string;
}
export type RepostApplyResult = {
  schemaVersion: 1;
  domain: 'sale_stock_repost';
  outcome: 'applied';
  replayed: boolean;
  receipt: RepostReceipt;
};

export async function applyGarmentRepost(
  ctx: CoreCtx,
  command: GarmentRepostCommand,
  actor: Actor,
): Promise<RepostApplyResult> {
  const profile = profileOf(ctx);
  if (actor.id !== profile)
    throw new RepostError('actor must be the signed-in profile', 'forbidden');
  const m = decodeGarmentRepostManifestV1(command.manifest);
  const manifestSha256 = garmentManifestSha256(m);
  if (command.approvedPlanSha256 !== manifestSha256)
    throw new RepostError('approved plan does not match the manifest', 'invalid_request');
  if (m.orgId !== ctx.tenantId || m.actorProfileId !== profile)
    throw new RepostError('manifest does not match the principal', 'forbidden');
  await readSnapshot(ctx, async (tx) => {
    await active(assertActiveOperatorPrincipalReadOnlyInTx(tx, ctx.tenantId, profile));
    admit(await active(resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile)));
  });
  try {
    return await withOrgCore(ctx, async (tx) => {
      await tx.execute(sql`set local lock_timeout = '1000ms'`);
      await tx.execute(sql`set local statement_timeout = '12000ms'`);
      await tx.execute(sql`set local time zone 'UTC'`);
      const guard: StockWriteGuard = await lockStockWrite(tx, ctx);
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
        const r =
          existing.kind === 'sale_stock_repost'
            ? (existing.after as { receipt?: RepostReceipt }).receipt
            : undefined;
        if (
          !r ||
          r.manifestSha256 !== manifestSha256 ||
          r.previewHash !== command.previewHash ||
          existing.actorId !== profile
        )
          throw new RepostError('operation key already used for another intent', 'key_reuse');
        return {
          schemaVersion: 1,
          domain: 'sale_stock_repost',
          outcome: 'applied',
          replayed: true,
          receipt: r,
        } as RepostApplyResult;
      }
      const caps = await active(
        resolveFreshOperatorCapabilitiesForWriteInTransaction(tx, ctx.tenantId, profile),
      );
      admit(caps);
      await assertStockModulesEnabledInTx(tx, ctx, guard, ['stock', 'pos', 'finances']);
      if (m.action === 'compensate') {
        const [fwd] = await tx
          .select()
          .from(stkCorrections)
          .where(
            and(
              eq(stkCorrections.orgId, ctx.tenantId),
              eq(stkCorrections.operationKey, m.inverseOfOperationId),
            ),
          );
        if (
          !fwd ||
          fwd.kind !== 'sale_stock_repost' ||
          fwd.replacementEntryId !== m.originalEntryId ||
          (fwd.intended as { action?: string }).action !== 'correct'
        )
          throw new RepostError(
            'inverse names no applied forward repost of this entry',
            'blocked',
            'inverse_invalid',
          );
      }
      // Row locks only after the gate pair: ticket, then the sorted bins (cancel/submit lock the entry rows themselves).
      await run(
        tx,
        sql`select 1 from pos_tickets where org_id = ${ctx.tenantId} and id = ${m.ticketId}::uuid for update`,
      );
      const bins = await lockBinsInTx(tx, ctx, guard, [
        { itemId: m.fromItemId, warehouseId: m.warehouseId },
        { itemId: m.toItemId, warehouseId: m.warehouseId },
      ]);
      const f = await readGarmentFacts(tx, ctx, idsOf(m));
      const plan = planGarmentRepost(m, f.facts);
      if (!plan.eligible)
        throw new RepostError(
          `blocked: ${plan.code}`,
          plan.code === 'stale_fingerprint' ? 'stale' : 'blocked',
          plan.code,
        );
      if (!valuationMatches(m, f)) throw new RepostError('valuation boundary changed', 'stale');
      const policy = policyHash(await principalHash(tx, ctx, profile));
      if (previewHashOf(manifestSha256, f.facts.fingerprintSha256, policy) !== command.previewHash)
        throw new RepostError('preview is stale', 'stale');
      const postedAt = new Date(m.postedAt);
      const lineUom = f.entryLines[0]
        ? (
            await run(
              tx,
              sql`select uom from stk_entry_lines where org_id = ${ctx.tenantId} and entry_id = ${m.originalEntryId}::uuid`,
            )
          )[0]?.uom
        : null;
      await cancelEntryInTx(tx, ctx, guard, m.originalEntryId, actor, { bins, postedAt });
      const draft = await createEntryInTx(
        tx,
        ctx,
        guard,
        {
          type: 'issue',
          metadata: {
            source: 'pos',
            sourceId: m.ticketId,
            ticketId: m.ticketId,
            correctionOf: m.originalEntryId,
            correctionOperationKey: m.operationKey,
          },
          lines: [
            {
              itemId: m.toItemId,
              qty: Number(m.qty),
              uom: lineUom === null || lineUom === undefined ? undefined : String(lineUom),
              fromWarehouseId: m.warehouseId,
            },
          ],
        },
        actor,
      );
      const { entry } = await submitEntryInTx(tx, ctx, guard, draft.id, actor, { bins, postedAt });
      await run(
        tx,
        sql`update pos_tickets set stock_entry_id = ${entry.id}::uuid, stock_warning = null where org_id = ${ctx.tenantId} and id = ${m.ticketId}::uuid`,
      );
      // The replacement must keep the decoded `pos` source so a later compensation can be admitted.
      const dec = decodeStockEntrySource('issue', entry.metadata);
      if (dec.kind !== 'pos' || dec.id !== m.ticketId)
        throw new RepostError(
          'replacement source did not decode as the ticket',
          'invariant_failed',
        );
      const after = await readGarmentFacts(tx, ctx, { ...idsOf(m), originalEntryId: entry.id });
      const pay = f.facts.fingerprintSha256 !== after.facts.fingerprintSha256;
      void pay;
      const previewHash = command.previewHash;
      const payloadHash = payloadHashOf(ctx.tenantId, profile, manifestSha256, previewHash);
      const correctionId = crypto.randomUUID();
      const receipt: RepostReceipt = {
        correctionId,
        operationKey: m.operationKey,
        action: m.action,
        manifestSha256,
        previewHash,
        payloadHash,
        sourceEntryId: m.originalEntryId,
        replacementEntryId: entry.id,
        fingerprintBefore: f.facts.fingerprintSha256,
        fingerprintAfter: after.facts.fingerprintSha256,
        postedAt: m.postedAt,
      };
      await tx.insert(stkCorrections).values({
        id: correctionId,
        orgId: ctx.tenantId,
        operationKey: m.operationKey,
        kind: 'sale_stock_repost',
        sourceType: 'pos_ticket_line',
        sourceId: m.ticketLineId,
        sourceEntryId: m.originalEntryId,
        replacementEntryId: entry.id,
        payloadHash,
        previewHash,
        reason: m.reason,
        actorId: profile,
        before: {
          fingerprint: f.facts.fingerprintSha256,
          effects: plan.effects,
          valuation: m.valuation,
        },
        intended: {
          domain: 'sale_stock_repost',
          action: m.action,
          domainManifest: m,
          manifestSha256,
          previewHash,
          payloadHash,
        },
        after: { receipt, entryMap: { [m.originalEntryId]: entry.id } },
        appliedAt: postedAt,
      });
      await recordAuditInTx(tx, ctx, {
        refType: 'pos_ticket',
        refId: m.ticketId,
        op: 'workflow',
        changes: [
          { field: 'stock_repost', label: 'Stock repost', old: m.fromItemId, new: m.toItemId },
        ],
        actor,
      });
      return {
        schemaVersion: 1,
        domain: 'sale_stock_repost',
        outcome: 'applied',
        replayed: false,
        receipt,
      } as RepostApplyResult;
    });
  } catch (e) {
    if (sqlState(e) === '23505')
      throw new RepostError('another request holds this operation key', 'operation_conflict');
    throw e;
  }
}

async function principalHash(tx: CoreTx, ctx: CoreCtx, profile: string): Promise<string> {
  const rows = await readOperatorAuthorityForWriteInTx(tx, ctx.tenantId, profile);
  const selected = {
    orgId: ctx.tenantId,
    profileId: profile,
    membershipRole: rows.membershipRole,
    roleModel: rows.roleModel,
    defaultRoleKey: rows.defaultRoleKey,
    authorityRows: rows.authorityRows,
  };
  return createHash('sha256').update(JSON.stringify(selected)).digest('hex');
}

/** Nonlocking status by known key: the immutable receipt, or absent. Never retries a write. */
export async function getGarmentRepostStatus(
  ctx: CoreCtx,
  input: { operationKey: string; manifestSha256: Digest },
): Promise<{ outcome: 'applied'; receipt: RepostReceipt } | { outcome: 'absent' }> {
  const profile = profileOf(ctx);
  return readSnapshot(ctx, async (tx) => {
    await active(assertActiveOperatorPrincipalReadOnlyInTx(tx, ctx.tenantId, profile));
    admit(await active(resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile)));
    const [row] = await tx
      .select()
      .from(stkCorrections)
      .where(
        and(
          eq(stkCorrections.orgId, ctx.tenantId),
          eq(stkCorrections.operationKey, input.operationKey),
        ),
      );
    if (!row) return { outcome: 'absent' as const };
    const r =
      row.kind === 'sale_stock_repost'
        ? (row.after as { receipt?: RepostReceipt }).receipt
        : undefined;
    if (!r || r.manifestSha256 !== input.manifestSha256)
      throw new RepostError('operation key already used for another intent', 'key_reuse');
    return { outcome: 'applied' as const, receipt: r };
  });
}
void cmpStr;
