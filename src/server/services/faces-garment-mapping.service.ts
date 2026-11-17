/**
 * Faja M mapping correction (minion-meta spec 122, contracts/mapping-envelope.md): owning preview / apply / status and the
 * read-only manifest producer. Apply is ONE gated transaction: recipe delete+insert, immutable `product_mapping` receipt
 * and one audit commit together or not at all. It never writes stock, ledger, bins, tickets or payments and never calls
 * the separately committing setConsumption/deleteConsumption wrappers.
 *
 * TODO(handoff): production apply needs F3 rollout/drain evidence and the owner's exact-manifest approval (owner action);
 * `updateSellable` and the raw-SQL stk_consumption scripts are not part of the gate pair (review F1-R6-codebase-details-07).
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCoreTransaction, withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { stkConsumption, stkCorrections } from '$server/db/pg-schema/stock';
import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
import {
  OperatorAuthorityError,
  assertActiveOperatorPrincipalReadOnlyInTx,
} from '$server/auth/active-operator-principal';
import {
  resolveFreshCapabilitiesReadOnlyInTransaction,
  resolveFreshOperatorCapabilitiesForWriteInTransaction,
  type FreshCapabilitySnapshot,
} from './rbac.service';
import { recordAuditInTx } from './activity.service';
import {
  assertStockModulesEnabledInTx,
  lockStockWrite,
  type Actor,
  type StockWriteGuard,
} from './stock.service';
import {
  censusStateSha256,
  decodeMappingCommand,
  decodeMappingManifestV1,
  decodeMappingStatusInput,
  mappingManifestSha256,
  mappingStateSha256,
  payloadHashOf,
  planMapping,
  previewHashOf,
  unchangedFactsDigest,
  type CensusRow,
  type ItemUom,
  type MappingCommand,
  type MappingManifestV1,
  type MappingState,
  type MappingStatusInput,
  type RowRef,
  type UnchangedFacts,
  type UnchangedTable,
} from '../../../scripts/lib/faces-garment-mapping';
import {
  UUID_RE,
  canonicalSha256,
  cmpStr,
  decodeStockEntrySource,
  type Digest,
  type StockEntrySource,
} from '../../../scripts/lib/faces-stock-reconciliation';

export type MappingErrorCode =
  | 'invalid_request'
  | 'forbidden'
  | 'stale'
  | 'blocked'
  | 'key_reuse'
  | 'operation_conflict'
  | 'incomplete'
  | 'invariant_failed';
export class MappingError extends Error {
  constructor(
    message: string,
    readonly code: MappingErrorCode,
  ) {
    super(message);
    this.name = 'MappingError';
  }
}

const LIMIT = 1_000;
const LEDGER_LIMIT = 50_000;
const ROW_LIMIT = 10_000;
const HASH = sql.raw(`encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')`);
const uuidList = (ids: readonly string[]) =>
  ids.length
    ? sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )
    : sql`null::uuid`;
type Rows = Record<string, unknown>[];
const run = (tx: CoreTx, q: ReturnType<typeof sql>) => tx.execute(q) as unknown as Promise<Rows>;
const str = (v: unknown) => String(v);

// ── authority ────────────────────────────────────────────────────────────────────────────

async function active<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof OperatorAuthorityError) throw new MappingError('not allowed', 'forbidden');
    throw e;
  }
}
/** Real owner membership plus the stock:manage / POS / finance-tier matrix (stock has no field tier of its own). */
function admit(c: FreshCapabilitySnapshot, ctx: CoreCtx): void {
  const k = c.capabilities;
  if (
    c.membershipRole !== 'owner' ||
    !k.can('stock', 'manage') ||
    !k.can('pos', 'view') ||
    !k.can('finance', 'view') ||
    k.fieldLevel('finance') < SENSITIVE_FIELD_LEVEL
  )
    throw new MappingError('not allowed', 'forbidden');
  void ctx;
}
function requireProfile(ctx: CoreCtx): string {
  if (!ctx.profileId || !UUID_RE.test(ctx.profileId))
    throw new MappingError('an authenticated profile is required', 'forbidden');
  return ctx.profileId;
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

/** READ ONLY REPEATABLE READ snapshot: no advisory lock, no row lock, no write. */
function readSnapshot<T>(ctx: CoreCtx, fn: (tx: CoreTx) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    await tx.execute(sql`set local time zone 'UTC'`);
    return withOrgCoreTransaction(ctx, tx as unknown as CoreTx, fn);
  });
}
function writeTransaction<T>(
  ctx: CoreCtx,
  fn: (tx: CoreTx, guard: StockWriteGuard) => Promise<T>,
): Promise<T> {
  return withOrgCore(ctx, async (tx) => {
    await tx.execute(sql`set local lock_timeout = '1000ms'`);
    await tx.execute(sql`set local statement_timeout = '12000ms'`);
    await tx.execute(sql`set local time zone 'UTC'`);
    return fn(tx, await lockStockWrite(tx, ctx));
  });
}

// ── fresh state readers (shared by preview, apply, status, draft) ───────────────────────────

export interface MappingIdentity {
  productId: string;
  preservedLProductId: string;
  fromItemId: string;
  toItemId: string;
}

async function rowRefs(tx: CoreTx, org: string, id: MappingIdentity): Promise<RowRef[]> {
  const items = [id.fromItemId, id.toItemId];
  const prods = [id.productId, id.preservedLProductId];
  const parts: [RowRef['table'], Rows][] = [
    [
      'fin_products',
      await run(
        tx,
        sql`select t.id::text as k, ${HASH} as h from fin_products t where t.org_id = ${org} and t.id in (${uuidList(prods)})`,
      ),
    ],
    [
      'stk_items',
      await run(
        tx,
        sql`select t.id::text as k, ${HASH} as h from stk_items t where t.org_id = ${org} and t.id in (${uuidList(items)})`,
      ),
    ],
    [
      'stk_consumption',
      await run(
        tx,
        sql`select t.id::text as k, ${HASH} as h from stk_consumption t where t.org_id = ${org} and t.fin_product_id in (${uuidList(prods)})`,
      ),
    ],
    [
      'stk_item_components',
      await run(
        tx,
        sql`select t.id::text as k, ${HASH} as h from stk_item_components t where t.org_id = ${org} and (t.parent_item_id in (${uuidList(items)}) or t.child_item_id in (${uuidList(items)}))`,
      ),
    ],
  ];
  return parts.flatMap(([table, rows]) =>
    rows.map((r) => ({ table, key: [str(r.k)] as [string], rowSha256: str(r.h) })),
  );
}

export async function readMappingState(
  tx: CoreTx,
  org: string,
  id: MappingIdentity,
): Promise<MappingState> {
  const [product] = await run(
    tx,
    sql`select ${HASH} as h from fin_products t where t.org_id = ${org} and t.id = ${id.productId}::uuid`,
  );
  if (!product) throw new MappingError('product unavailable', 'incomplete');
  const bridge = await run(
    tx,
    sql`select t.id::text as id from stk_items t where t.org_id = ${org} and t.fin_product_id = ${id.productId}::uuid`,
  );
  const recipe = await run(
    tx,
    sql`select t.id::text as row_id, t.item_id::text as item_id, t.qty_per_unit::text as qty, t.note, ${HASH} as h
        from stk_consumption t where t.org_id = ${org} and t.fin_product_id = ${id.productId}::uuid`,
  );
  const lRows = await run(
    tx,
    sql`select t.id::text as k, ${HASH} as h from stk_consumption t where t.org_id = ${org} and t.fin_product_id = ${id.preservedLProductId}::uuid order by t.id`,
  );
  const refs = await rowRefs(tx, org, id);
  if (recipe.length > LIMIT || refs.length > LIMIT)
    throw new MappingError('too many rows', 'incomplete');
  return {
    productId: id.productId,
    productRowSha256: str(product.h),
    directBridgeItemId: bridge.length ? str(bridge[0].id) : null,
    recipe: recipe
      .map((r) => ({
        rowId: str(r.row_id),
        itemId: str(r.item_id),
        qtyPerUnit: str(r.qty),
        note: r.note === null ? null : str(r.note),
        rowSha256: str(r.h),
      }))
      .sort((a, b) => cmpStr(`${a.itemId}/${a.rowId}`, `${b.itemId}/${b.rowId}`)),
    ruleRows: refs.sort((a, b) => cmpStr(`${a.table}/${a.key[0]}`, `${b.table}/${b.key[0]}`)),
    preservedLProductId: id.preservedLProductId,
    preservedLMappingSha256: canonicalSha256(lRows.map((r) => ({ k: str(r.k), h: str(r.h) }))),
  };
}

async function readItemUoms(
  tx: CoreTx,
  org: string,
  ids: string[],
): Promise<Map<string, ItemUom & { id: string }>> {
  const rows = await run(
    tx,
    sql`select t.id::text as id, t.uom, t.consumption_uom, t.units_per_stock_uom::text as units from stk_items t where t.org_id = ${org} and t.id in (${uuidList(ids)})`,
  );
  return new Map(
    rows.map((r) => [
      str(r.id),
      {
        id: str(r.id),
        uom: str(r.uom),
        consumptionUom: r.consumption_uom === null ? null : str(r.consumption_uom),
        unitsPerStockUom: r.units === null ? null : str(r.units),
      },
    ]),
  );
}

/**
 * Census predicates (decisions for review F1-R6-IR-03):
 *  - pendingDrafts: DRAFT issue entries holding the OLD item whose decoded source is a ticket with a line for the M product
 *    or a booking carrying the M product. An undecodable (`unknown`) source blocks as incomplete evidence.
 *  - openAccruals: OPEN stk_accruals with fin_product_id = M (by product, never by item).
 *  - submittedIssues: SUBMITTED issue entries on the same predicate; evidence only, never a blocker.
 *  - ledgerHighWater: max(stk_ledger.id) over the old and new item (org-wide for those two items), text.
 */
export async function readCensus(tx: CoreTx, org: string, id: MappingIdentity) {
  const entries = await run(
    tx,
    sql`select t.id::text as id, t.type, t.status, t.metadata, encode(sha256(convert_to(t.metadata::text,'UTF8')),'hex') as msha, ${HASH} as h
        from stk_entries t where t.org_id = ${org} and t.type = 'issue' and t.status in ('draft','submitted')
          and exists (select 1 from stk_entry_lines l where l.org_id = ${org} and l.entry_id = t.id and l.item_id = ${id.fromItemId}::uuid)
        limit ${ROW_LIMIT + 1}`,
  );
  if (entries.length > ROW_LIMIT) throw new MappingError('census capacity', 'incomplete');
  const decoded = entries.map((e) => ({
    e,
    src: decodeStockEntrySource(str(e.type), e.metadata, str(e.msha)),
  }));
  const ticketIds = decoded.flatMap(({ src }) => (src.kind === 'pos' ? [src.id] : []));
  const bookingIds = decoded.flatMap(({ src }) => (src.kind === 'booking' ? [src.id] : []));
  const mTickets = new Set(
    (
      await run(
        tx,
        sql`select distinct ticket_id::text as id from pos_ticket_lines where org_id = ${org} and fin_product_id = ${id.productId}::uuid and ticket_id in (${uuidList(ticketIds)})`,
      )
    ).map((r) => str(r.id)),
  );
  const mBookings = new Set(
    (
      await run(
        tx,
        sql`select b.id::text as id from sched_bookings b where b.org_id = ${org} and b.id in (${uuidList(bookingIds)})
          and (b.product_id = ${id.productId}::uuid or exists (select 1 from sched_booking_products p where p.org_id = ${org} and p.booking_id = b.id and p.product_id = ${id.productId}::uuid))`,
      )
    ).map((r) => str(r.id)),
  );
  const pending: CensusRow[] = [];
  const submitted: CensusRow[] = [];
  for (const { e, src } of decoded) {
    if (src.kind === 'unknown') throw new MappingError('entry source undecodable', 'incomplete');
    const sourceType =
      src.kind === 'pos' ? 'pos_ticket' : src.kind === 'booking' ? 'booking' : null;
    if (!sourceType) continue;
    const hit =
      src.kind === 'pos'
        ? mTickets.has((src as { id: string }).id)
        : mBookings.has((src as { id: string }).id);
    if (!hit) continue;
    const row: CensusRow = {
      sourceType,
      sourceId: (src as { id: string }).id,
      entryId: str(e.id),
      accrualId: null,
      state: e.status === 'draft' ? 'draft' : 'submitted',
      rowSha256: str(e.h),
    };
    (e.status === 'draft' ? pending : submitted).push(row);
  }
  const accruals = await run(
    tx,
    sql`select t.id::text as id, t.source, t.source_id::text as source_id, ${HASH} as h from stk_accruals t
        where t.org_id = ${org} and t.status = 'open' and t.fin_product_id = ${id.productId}::uuid limit ${ROW_LIMIT + 1}`,
  );
  if (accruals.length > ROW_LIMIT) throw new MappingError('census capacity', 'incomplete');
  const open: CensusRow[] = accruals.map((a) => {
    if (a.source !== 'booking') throw new MappingError('unsupported accrual source', 'incomplete');
    return {
      sourceType: 'booking',
      sourceId: str(a.source_id),
      entryId: null,
      accrualId: str(a.id),
      state: 'open',
      rowSha256: str(a.h),
    };
  });
  const [hw] = await run(
    tx,
    sql`select max(id)::text as hw from stk_ledger where org_id = ${org} and item_id in (${uuidList([id.fromItemId, id.toItemId])})`,
  );
  const base = {
    pendingDrafts: pending,
    openAccruals: open,
    submittedIssues: submitted,
    ledgerHighWater: hw?.hw === null || hw?.hw === undefined ? null : str(hw.hw),
  };
  return { ...base, complete: true as const, stateSha256: censusStateSha256(base) };
}

/** Unchanged stock/payment facts (unchanged-facts.md). Finance rows the sync delete-replaces are hashed as a stable subset. */
export async function readUnchangedFacts(
  tx: CoreTx,
  org: string,
  id: MappingIdentity,
  census: Awaited<ReturnType<typeof readCensus>>,
): Promise<UnchangedFacts> {
  const items = [id.fromItemId, id.toItemId];
  const prods = [id.productId, id.preservedLProductId];
  const tables: UnchangedFacts['tables'] = [];
  const put = (table: UnchangedTable, rows: Rows, key: (r: Rows[number]) => string[]) =>
    tables.push({ table, rows: rows.map((r) => ({ key: key(r), rowSha256: str(r.h) })) });
  const bounded = async (q: ReturnType<typeof sql>, limit: number) => {
    const rows = await run(tx, sql`${q} limit ${limit + 1}`);
    if (rows.length > limit) throw new MappingError('unchanged-facts capacity', 'incomplete');
    return rows;
  };
  put(
    'fin_products',
    await bounded(
      sql`select t.id::text as k, ${HASH} as h from fin_products t where t.org_id = ${org} and t.id in (${uuidList(prods)})`,
      ROW_LIMIT,
    ),
    (r) => [str(r.k)],
  );
  put(
    'stk_items',
    await bounded(
      sql`select t.id::text as k, ${HASH} as h from stk_items t where t.org_id = ${org} and t.id in (${uuidList(items)})`,
      ROW_LIMIT,
    ),
    (r) => [str(r.k)],
  );
  const ledger = await bounded(
    sql`select t.id::text as k, t.entry_id::text as entry_id, t.item_id::text as item_id, t.warehouse_id::text as wh, ${HASH} as h from stk_ledger t where t.org_id = ${org} and t.item_id in (${uuidList(items)}) order by t.id`,
    LEDGER_LIMIT,
  );
  put('stk_ledger', ledger, (r) => [str(r.k)]);
  const bins = await bounded(
    sql`select t.item_id::text as item_id, t.warehouse_id::text as wh, ${HASH} as h from stk_bins t where t.org_id = ${org} and t.item_id in (${uuidList(items)})`,
    LIMIT,
  );
  put('stk_bins', bins, (r) => [str(r.item_id), str(r.wh)]);
  const binKeys = new Map<string, [string, string]>();
  for (const r of [...ledger.map((x) => ({ item_id: x.item_id, wh: x.wh })), ...bins])
    binKeys.set(`${r.item_id}/${r.wh}`, [str(r.item_id), str(r.wh)]);
  const entryIds = [...new Set(ledger.map((r) => str(r.entry_id)))].sort(cmpStr);
  if (entryIds.length > LIMIT) throw new MappingError('unchanged-facts capacity', 'incomplete');
  const entries = await bounded(
    sql`select t.id::text as k, t.type, t.metadata, encode(sha256(convert_to(t.metadata::text,'UTF8')),'hex') as msha, ${HASH} as h from stk_entries t where t.org_id = ${org} and t.id in (${uuidList(entryIds)})`,
    LIMIT,
  );
  put('stk_entries', entries, (r) => [str(r.k)]);
  put(
    'stk_entry_lines',
    await bounded(
      sql`select t.id::text as k, ${HASH} as h from stk_entry_lines t where t.org_id = ${org} and t.entry_id in (${uuidList(entryIds)})`,
      ROW_LIMIT,
    ),
    (r) => [str(r.k)],
  );
  const sources: StockEntrySource[] = entries.map((e) =>
    decodeStockEntrySource(str(e.type), e.metadata, str(e.msha)),
  );
  if (sources.some((s) => s.kind === 'unknown'))
    throw new MappingError('entry source undecodable', 'incomplete');
  const censusTickets = [...census.pendingDrafts, ...census.submittedIssues]
    .filter((c) => c.sourceType === 'pos_ticket')
    .map((c) => c.sourceId);
  const censusBookings = [
    ...census.pendingDrafts,
    ...census.openAccruals,
    ...census.submittedIssues,
  ]
    .filter((c) => c.sourceType === 'booking')
    .map((c) => c.sourceId);
  const productTickets = await bounded(
    sql`select distinct ticket_id::text as id from pos_ticket_lines where org_id = ${org} and fin_product_id in (${uuidList(prods)})`,
    LIMIT,
  );
  const ticketIds = [
    ...new Set([
      ...sources.flatMap((s) => (s.kind === 'pos' ? [s.id] : [])),
      ...censusTickets,
      ...productTickets.map((r) => str(r.id)),
    ]),
  ].sort(cmpStr);
  const lines = await bounded(
    sql`select t.id::text as k, t.booking_id::text as booking_id, ${HASH} as h from pos_ticket_lines t where t.org_id = ${org} and t.ticket_id in (${uuidList(ticketIds)})`,
    ROW_LIMIT,
  );
  put('pos_ticket_lines', lines, (r) => [str(r.k)]);
  const bookingIds = [
    ...new Set([
      ...sources.flatMap((s) => (s.kind === 'booking' ? [s.id] : [])),
      ...censusBookings,
      ...lines.flatMap((r) => (r.booking_id ? [str(r.booking_id)] : [])),
    ]),
  ].sort(cmpStr);
  const tickets = await bounded(
    sql`select t.id::text as k, t.invoice_provider_ref as ref, ${HASH} as h from pos_tickets t where t.org_id = ${org} and t.id in (${uuidList(ticketIds)})`,
    LIMIT,
  );
  put('pos_tickets', tickets, (r) => [str(r.k)]);
  put(
    'pos_payments',
    await bounded(
      sql`select t.id::text as k, ${HASH} as h from pos_payments t where t.org_id = ${org} and t.ticket_id in (${uuidList(ticketIds)})`,
      ROW_LIMIT,
    ),
    (r) => [str(r.k)],
  );
  const bookings = await bounded(
    sql`select t.id::text as k, t.invoice_id::text as invoice_id, ${HASH} as h from sched_bookings t where t.org_id = ${org} and t.id in (${uuidList(bookingIds)})`,
    LIMIT,
  );
  put('sched_bookings', bookings, (r) => [str(r.k)]);
  put(
    'stk_accruals',
    await bounded(
      sql`select t.id::text as k, ${HASH} as h from stk_accruals t where t.org_id = ${org} and ((t.source = 'booking' and t.source_id in (${uuidList(bookingIds)})) or t.realized_entry_id in (${uuidList(entryIds)}))`,
      ROW_LIMIT,
    ),
    (r) => [str(r.k)],
  );
  const refs = tickets
    .map((r) => (r.ref === null ? null : str(r.ref)))
    .filter((x): x is string => !!x);
  const invoiceDirect = [
    ...sources.flatMap((s) => (s.kind === 'invoice' ? [s.id] : [])),
    ...bookings.flatMap((r) => (r.invoice_id ? [str(r.invoice_id)] : [])),
  ];
  const refList = refs.length
    ? sql.join(
        refs.map((x) => sql`${x}`),
        sql`, `,
      )
    : sql`null`;
  // fin_invoices.synced_at is rewritten by every finance sync: excluded from the hash, like row ids below.
  const invoices = await bounded(
    sql`select t.id::text as k, encode(sha256(convert_to((to_jsonb(t) - 'synced_at')::text,'UTF8')),'hex') as h from fin_invoices t
        where t.org_id = ${org} and (t.id in (${uuidList(invoiceDirect)}) or t.provider_ref in (${refList}))`,
    LIMIT,
  );
  put('fin_invoices', invoices, (r) => [str(r.k)]);
  const invoiceIds = invoices.map((r) => str(r.k)).sort(cmpStr);
  const stableAgg = (table: 'fin_invoice_items' | 'fin_payments') =>
    bounded(
      sql`select i.id::text as k, encode(sha256(convert_to(coalesce((select jsonb_agg(to_jsonb(x) - 'id' - 'created_at' - 'synced_at' order by (to_jsonb(x) - 'id' - 'created_at' - 'synced_at')::text)
              from ${sql.raw(table)} x where x.org_id = ${org} and x.invoice_id = i.id), '[]'::jsonb)::text,'UTF8')),'hex') as h
          from fin_invoices i where i.org_id = ${org} and i.id in (${uuidList(invoiceIds)})`,
      LIMIT,
    );
  put('fin_invoice_items', await stableAgg('fin_invoice_items'), (r) => [str(r.k)]);
  put('fin_payments', await stableAgg('fin_payments'), (r) => [str(r.k)]);
  put(
    'pos_client_ledger',
    await bounded(
      sql`select t.id::text as k, ${HASH} as h from pos_client_ledger t where t.org_id = ${org} and (t.ticket_id in (${uuidList(ticketIds)}) or t.booking_id in (${uuidList(bookingIds)}))`,
      ROW_LIMIT,
    ),
    (r) => [str(r.k)],
  );
  return {
    orgId: org,
    scope: {
      productIds: prods,
      itemIds: items,
      binKeys: [...binKeys.values()],
      entryIds,
      ticketIds,
      bookingIds,
      invoiceIds,
    },
    tables,
  };
}

// ── shared observation ────────────────────────────────────────────────────────────────────

const identityOf = (m: MappingManifestV1): MappingIdentity => ({
  productId: m.before.productId,
  preservedLProductId: m.before.preservedLProductId,
  fromItemId: m.before.recipe[0]?.itemId ?? m.intended.itemId,
  toItemId: m.intended.itemId,
});

async function observe(tx: CoreTx, ctx: CoreCtx, id: MappingIdentity) {
  const state = await readMappingState(tx, ctx.tenantId, id);
  const census = await readCensus(tx, ctx.tenantId, id);
  const facts = await readUnchangedFacts(tx, ctx.tenantId, id, census);
  const uoms = await readItemUoms(tx, ctx.tenantId, [id.fromItemId, id.toItemId]);
  return { state, census, unchanged: unchangedFactsDigest(facts), uoms };
}

function policyHash(principalStateHash: string, caps: FreshCapabilitySnapshot): Digest {
  return canonicalSha256({ principalStateHash, membershipRole: caps.membershipRole });
}

export type MappingBlockCode =
  'cutover_pending_sources' | 'unsupported_scope' | 'rollout_unverified' | 'incomplete_evidence';
export type MappingPreview =
  | {
      schemaVersion: 1;
      domain: 'product_mapping';
      outcome: 'preview';
      eligible: true;
      manifestSha256: Digest;
      planSha256: Digest;
      previewHash: Digest;
      payloadHash: Digest;
      beforeStateSha256: Digest;
      censusStateSha256: Digest;
      policyStateSha256: Digest;
      intended: MappingManifestV1['intended'];
    }
  | {
      schemaVersion: 1;
      domain: 'product_mapping';
      outcome: 'blocked';
      eligible: false;
      code: MappingBlockCode;
    };

/** Compare the manifest to fresh state; any difference is stale (never silently refreshed). */
function matchOrBlock(
  m: MappingManifestV1,
  fresh: Awaited<ReturnType<typeof observe>>,
): MappingBlockCode | 'stale' | null {
  if (mappingStateSha256(fresh.state) !== mappingStateSha256(m.before)) return 'stale';
  if (fresh.census.stateSha256 !== m.census.stateSha256) return 'stale';
  if (fresh.unchanged !== m.unchangedStockPaymentSha256) return 'stale';
  const from = fresh.uoms.get(identityOf(m).fromItemId);
  const to = fresh.uoms.get(m.intended.itemId);
  if (!from || !to) return 'incomplete_evidence';
  const plan = planMapping(m, { fromItem: from, toItem: to });
  return plan.eligible ? null : plan.code;
}

export async function previewMappingCorrection(
  ctx: CoreCtx,
  input: MappingManifestV1,
): Promise<MappingPreview> {
  const profile = requireProfile(ctx);
  const m = decodeMappingManifestV1(input);
  if (m.orgId !== ctx.tenantId || m.actorProfileId !== profile)
    throw new MappingError('manifest does not match the principal', 'forbidden');
  return readSnapshot(ctx, async (tx) => {
    const principal = await active(
      assertActiveOperatorPrincipalReadOnlyInTx(tx, ctx.tenantId, profile),
    );
    const caps = await active(
      resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile),
    );
    admit(caps, ctx);
    const fresh = await observe(tx, ctx, identityOf(m));
    const verdict = matchOrBlock(m, fresh);
    if (verdict === 'stale')
      throw new MappingError('manifest is stale against fresh state', 'stale');
    if (verdict)
      return {
        schemaVersion: 1,
        domain: 'product_mapping',
        outcome: 'blocked',
        eligible: false,
        code: verdict,
      } as MappingPreview;
    const manifestSha256 = mappingManifestSha256(m);
    const beforeStateSha256 = mappingStateSha256(fresh.state);
    const policyStateSha256 = policyHash(principal.principalStateHash, caps);
    const previewHash = previewHashOf({
      manifestSha256,
      beforeStateSha256,
      censusStateSha256: fresh.census.stateSha256,
      policyStateSha256,
    });
    return {
      schemaVersion: 1,
      domain: 'product_mapping',
      outcome: 'preview',
      eligible: true,
      manifestSha256,
      planSha256: manifestSha256,
      previewHash,
      payloadHash: payloadHashOf({
        orgId: ctx.tenantId,
        actorProfileId: profile,
        manifestSha256,
        previewHash,
      }),
      beforeStateSha256,
      censusStateSha256: fresh.census.stateSha256,
      policyStateSha256,
      intended: m.intended,
    } as MappingPreview;
  });
}

// ── manifest producer (read-only; review F1-R6-IR-02) ───────────────────────────────────────

export interface MappingDraftInput {
  target: MappingManifestV1['target'];
  actorProfileId: string;
  operationKey: string;
  rowId: string;
  productId: string;
  preservedLProductId: string;
  fromItemId: string;
  toItemId: string;
  stockUom: string;
  sourceCodeSha: string;
  rollout: MappingManifestV1['rollout'];
  reason: string;
  ownerApprovalReference: string;
}
/** Candidate `correct` manifest with fresh database-derived values; unapproved, never executable on its own. */
export async function draftMappingManifest(
  ctx: CoreCtx,
  d: MappingDraftInput,
): Promise<MappingManifestV1> {
  const profile = requireProfile(ctx);
  if (d.actorProfileId !== profile)
    throw new MappingError('draft actor must be the principal', 'forbidden');
  return readSnapshot(ctx, async (tx) => {
    await active(assertActiveOperatorPrincipalReadOnlyInTx(tx, ctx.tenantId, profile));
    const caps = await active(
      resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile),
    );
    admit(caps, ctx);
    const id: MappingIdentity = {
      productId: d.productId,
      preservedLProductId: d.preservedLProductId,
      fromItemId: d.fromItemId,
      toItemId: d.toItemId,
    };
    const fresh = await observe(tx, ctx, id);
    const note = fresh.state.recipe[0]?.note ?? null;
    return decodeMappingManifestV1({
      schemaVersion: 1,
      kind: 'product_mapping',
      action: 'correct',
      target: d.target,
      sourceCodeSha: d.sourceCodeSha,
      operationKey: d.operationKey,
      orgId: ctx.tenantId,
      actorProfileId: profile,
      before: fresh.state,
      intended: {
        rowId: d.rowId,
        productId: d.productId,
        itemId: d.toItemId,
        qtyPerUnit: '1.0000',
        stockUom: d.stockUom,
        note,
      },
      census: fresh.census,
      unchangedStockPaymentSha256: fresh.unchanged,
      rollout: d.rollout,
      reason: d.reason,
      ownerApprovalReference: d.ownerApprovalReference,
    });
  });
}

// ── apply ───────────────────────────────────────────────────────────────────────────────

export interface MappingReceipt {
  correctionId: string;
  operationKey: string;
  action: 'correct' | 'compensate';
  inverseOfOperationId: string | null;
  manifestSha256: Digest;
  previewHash: Digest;
  payloadHash: Digest;
  originalRecipeRowId: string;
  replacementRecipeRowId: string;
  beforeStateSha256: Digest;
  afterStateSha256: Digest;
  censusStateSha256: Digest;
  unchangedStockPaymentSha256: Digest;
}
export type MappingApplyResult = {
  schemaVersion: 1;
  domain: 'product_mapping';
  outcome: 'applied';
  replayed: boolean;
  receipt: MappingReceipt;
};

function receiptFromRow(row: typeof stkCorrections.$inferSelect): MappingReceipt {
  const r = (row.after as { receipt?: MappingReceipt }).receipt;
  if (!r) throw new MappingError('stored receipt is malformed', 'invariant_failed');
  return r;
}

export async function applyMappingCorrection(
  ctx: CoreCtx,
  input: MappingCommand,
  actor: Actor,
): Promise<MappingApplyResult> {
  const profile = requireProfile(ctx);
  if (actor.id !== profile)
    throw new MappingError('actor must be the signed-in profile', 'forbidden');
  const command = decodeMappingCommand(input);
  const m = command.manifest;
  if (m.orgId !== ctx.tenantId || m.actorProfileId !== profile)
    throw new MappingError('manifest does not match the principal', 'forbidden');
  await readSnapshot(ctx, async (tx) => {
    await active(assertActiveOperatorPrincipalReadOnlyInTx(tx, ctx.tenantId, profile));
    admit(
      await active(resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile)),
      ctx,
    );
  });
  const manifestSha256 = mappingManifestSha256(m);
  try {
    return await writeTransaction(ctx, async (tx, guard) => {
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
        const r = existing.kind === 'product_mapping' ? receiptFromRow(existing) : null;
        if (
          !r ||
          r.manifestSha256 !== manifestSha256 ||
          r.previewHash !== command.previewHash ||
          existing.actorId !== profile
        )
          throw new MappingError('operation key already used for another intent', 'key_reuse');
        return {
          schemaVersion: 1,
          domain: 'product_mapping',
          outcome: 'applied',
          replayed: true,
          receipt: r,
        } as MappingApplyResult;
      }
      const caps = await active(
        resolveFreshOperatorCapabilitiesForWriteInTransaction(tx, ctx.tenantId, profile),
      );
      admit(caps, ctx);
      await assertStockModulesEnabledInTx(tx, ctx, guard, ['stock', 'pos', 'finances']);
      const id = identityOf(m);
      // Row locks only after the gate pair: product rows, then the recipe rows of both products.
      await run(
        tx,
        sql`select 1 from fin_products where org_id = ${ctx.tenantId} and id in (${uuidList([id.productId, id.preservedLProductId])}) order by id for update`,
      );
      await run(
        tx,
        sql`select 1 from stk_consumption where org_id = ${ctx.tenantId} and fin_product_id in (${uuidList([id.productId, id.preservedLProductId])}) order by id for update`,
      );
      if (m.action === 'compensate') await assertInverseAdmissible(tx, ctx, m);
      const fresh = await observe(tx, ctx, id);
      const verdict = matchOrBlock(m, fresh);
      if (verdict === 'stale')
        throw new MappingError('manifest is stale against fresh state', 'stale');
      if (verdict) throw new MappingError(`blocked: ${verdict}`, 'blocked');
      const [clash] = await run(
        tx,
        sql`select 1 from stk_consumption where org_id = ${ctx.tenantId} and id = ${m.intended.rowId}::uuid`,
      );
      if (clash) throw new MappingError('replacement row id already exists', 'blocked');
      const beforeStateSha256 = mappingStateSha256(fresh.state);
      const policyStateSha256 = policyHash(
        (await assertActiveOperatorPrincipalReadOnlyInTxSafe(tx, ctx, profile)) ?? '',
        caps,
      );
      const previewHash = previewHashOf({
        manifestSha256,
        beforeStateSha256,
        censusStateSha256: fresh.census.stateSha256,
        policyStateSha256,
      });
      // Authority/module/period projection is part of the approved preview: a different one is stale.
      if (previewHash !== command.previewHash) throw new MappingError('preview is stale', 'stale');
      const old = m.before.recipe[0];
      await tx
        .delete(stkConsumption)
        .where(and(eq(stkConsumption.orgId, ctx.tenantId), eq(stkConsumption.id, old.rowId)));
      await tx.insert(stkConsumption).values({
        id: m.intended.rowId,
        orgId: ctx.tenantId,
        finProductId: m.intended.productId,
        itemId: m.intended.itemId,
        qtyPerUnit: m.intended.qtyPerUnit,
        note: m.intended.note,
      });
      const after = await observe(tx, ctx, id);
      if (after.unchanged !== m.unchangedStockPaymentSha256)
        throw new MappingError('unchanged stock/payment facts changed', 'invariant_failed');
      const afterOk =
        after.state.recipe.length === 1 &&
        after.state.recipe[0].rowId === m.intended.rowId &&
        after.state.recipe[0].itemId === m.intended.itemId &&
        after.state.preservedLMappingSha256 === fresh.state.preservedLMappingSha256 &&
        after.state.directBridgeItemId === null;
      if (!afterOk)
        throw new MappingError(
          'post-write mapping state is not the intended one',
          'invariant_failed',
        );
      const payloadHash = payloadHashOf({
        orgId: ctx.tenantId,
        actorProfileId: profile,
        manifestSha256,
        previewHash,
      });
      const appliedAt = new Date();
      const receiptBase = {
        operationKey: m.operationKey,
        action: m.action,
        inverseOfOperationId: m.action === 'compensate' ? m.inverseOfOperationId : null,
        manifestSha256,
        previewHash,
        payloadHash,
        originalRecipeRowId: old.rowId,
        replacementRecipeRowId: m.intended.rowId,
        beforeStateSha256,
        afterStateSha256: mappingStateSha256(after.state),
        censusStateSha256: fresh.census.stateSha256,
        unchangedStockPaymentSha256: m.unchangedStockPaymentSha256,
      };
      const correctionId = crypto.randomUUID();
      const receipt: MappingReceipt = { correctionId, ...receiptBase };
      await tx.insert(stkCorrections).values({
        id: correctionId,
        orgId: ctx.tenantId,
        operationKey: m.operationKey,
        kind: 'product_mapping',
        sourceType: 'fin_product',
        sourceId: m.intended.productId,
        sourceEntryId: null,
        replacementEntryId: null,
        payloadHash,
        previewHash,
        reason: m.reason,
        actorId: profile,
        before: {
          mappingState: fresh.state,
          census: m.census,
          unchangedStockPaymentSha256: m.unchangedStockPaymentSha256,
          policyStateSha256,
        },
        intended: {
          domain: 'product_mapping',
          action: m.action,
          inverseOfOperationId: receiptBase.inverseOfOperationId,
          domainManifest: m,
          manifestSha256,
          previewHash,
          payloadHash,
        },
        after: {
          mappingState: after.state,
          receipt,
          unchangedStockPaymentSha256: m.unchangedStockPaymentSha256,
        },
        appliedAt,
      });
      await recordAuditInTx(tx, ctx, {
        refType: 'fin_product',
        refId: m.intended.productId,
        op: 'workflow',
        changes: [
          {
            field: 'stock_mapping',
            label: 'Stock mapping',
            old: old.itemId,
            new: m.intended.itemId,
          },
        ],
        actor,
      });
      return {
        schemaVersion: 1,
        domain: 'product_mapping',
        outcome: 'applied',
        replayed: false,
        receipt,
      } as MappingApplyResult;
    });
  } catch (e) {
    if (sqlState(e) === '23505')
      throw new MappingError('another request holds this operation key', 'operation_conflict');
    throw e;
  }
}

// The principal state hash inside the write transaction comes from the bridge's locking mode, which has no read-only twin
// here; the preview hash binds only the read-only projection, so re-read it through the same nonlocking helper's shape.
async function assertActiveOperatorPrincipalReadOnlyInTxSafe(
  tx: CoreTx,
  ctx: CoreCtx,
  profile: string,
): Promise<string | null> {
  const { readOperatorAuthorityForWriteInTx } =
    await import('$server/auth/active-operator-principal');
  const rows = await readOperatorAuthorityForWriteInTx(tx, ctx.tenantId, profile);
  // Same preimage and key order as assertActiveOperatorPrincipalReadOnlyInTx so preview and apply compare equal.
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

/** compensate: names one applied same-org `correct` receipt, current recipe equals its after-state, nothing intervened. */
async function assertInverseAdmissible(
  tx: CoreTx,
  ctx: CoreCtx,
  m: MappingManifestV1,
): Promise<void> {
  if (m.action !== 'compensate') return;
  const [fwd] = await tx
    .select()
    .from(stkCorrections)
    .where(
      and(
        eq(stkCorrections.orgId, ctx.tenantId),
        eq(stkCorrections.operationKey, m.inverseOfOperationId),
      ),
    );
  const r = fwd && fwd.kind === 'product_mapping' ? receiptFromRow(fwd) : null;
  const intended = fwd?.intended as { action?: string } | undefined;
  if (!fwd || !r || intended?.action !== 'correct' || fwd.sourceId !== m.intended.productId)
    throw new MappingError('inverse names no applied correct receipt', 'blocked');
  const later = await run(
    tx,
    sql`select 1 from stk_corrections where org_id = ${ctx.tenantId} and kind = 'product_mapping' and source_id = ${m.intended.productId}::uuid and id <> ${fwd.id}::uuid and created_at >= ${fwd.createdAt.toISOString()}::timestamptz limit 1`,
  );
  if (later.length) throw new MappingError('a later mapping operation exists', 'blocked');
  const beforeState = (fwd.before as { mappingState: MappingState }).mappingState;
  const restored = beforeState.recipe[0];
  if (!restored || restored.itemId !== m.intended.itemId || m.intended.note !== restored.note)
    throw new MappingError('inverse must restore the receipt before-state', 'blocked');
  const afterState = (fwd.after as { mappingState: MappingState }).mappingState;
  if (mappingStateSha256(afterState) !== mappingStateSha256(m.before))
    throw new MappingError('current mapping is not the receipt after-state', 'blocked');
}

// ── status ───────────────────────────────────────────────────────────────────────────────

export type MappingStatusResult =
  | {
      schemaVersion: 1;
      domain: 'product_mapping';
      outcome: 'applied';
      receipt: MappingReceipt;
      currentState: 'matches' | 'changed' | 'compensated' | 'unavailable';
    }
  | {
      schemaVersion: 1;
      domain: 'product_mapping';
      outcome: 'absent_before_unchanged' | 'unknown';
      receipt: null;
    };

/** Nonlocking: takes no advisory lock and no row lock, writes nothing, never re-runs a gate-held census. */
export async function getMappingCorrectionStatus(
  ctx: CoreCtx,
  raw: MappingStatusInput,
): Promise<MappingStatusResult> {
  const profile = requireProfile(ctx);
  const input = decodeMappingStatusInput(raw);
  if (input.actorProfileId !== profile || input.orgId !== ctx.tenantId)
    throw new MappingError('not allowed', 'forbidden');
  return readSnapshot(ctx, async (tx) => {
    await active(assertActiveOperatorPrincipalReadOnlyInTx(tx, ctx.tenantId, profile));
    admit(
      await active(resolveFreshCapabilitiesReadOnlyInTransaction(tx, ctx.tenantId, profile)),
      ctx,
    );
    const [row] = await tx
      .select()
      .from(stkCorrections)
      .where(
        and(
          eq(stkCorrections.orgId, ctx.tenantId),
          eq(stkCorrections.operationKey, input.operationKey),
        ),
      );
    const id = identityOf(input.manifest);
    if (row) {
      const r = row.kind === 'product_mapping' ? receiptFromRow(row) : null;
      if (
        !r ||
        r.action !== input.action ||
        r.manifestSha256 !== input.manifestSha256 ||
        r.payloadHash !== input.expectedPayloadHash
      )
        throw new MappingError('operation key already used for another intent', 'key_reuse');
      let currentState: 'matches' | 'changed' | 'compensated' | 'unavailable' = 'unavailable';
      try {
        const [inverse] = await run(
          tx,
          sql`select 1 as x from stk_corrections where org_id = ${ctx.tenantId} and intended->>'inverseOfOperationId' = ${row.operationKey} limit 1`,
        );
        const current = await readMappingState(tx, ctx.tenantId, id);
        const afterState = (row.after as { mappingState: MappingState }).mappingState;
        currentState = inverse
          ? 'compensated'
          : mappingStateSha256(current) === mappingStateSha256(afterState)
            ? 'matches'
            : 'changed';
      } catch {
        currentState = 'unavailable';
      }
      return {
        schemaVersion: 1,
        domain: 'product_mapping',
        outcome: 'applied',
        receipt: r,
        currentState,
      };
    }
    try {
      const fresh = await observe(tx, ctx, id);
      const same =
        mappingStateSha256(fresh.state) === mappingStateSha256(input.manifest.before) &&
        fresh.census.stateSha256 === input.manifest.census.stateSha256;
      return {
        schemaVersion: 1,
        domain: 'product_mapping',
        outcome: same ? 'absent_before_unchanged' : 'unknown',
        receipt: null,
      };
    } catch {
      return { schemaVersion: 1, domain: 'product_mapping', outcome: 'unknown', receipt: null };
    }
  });
}
