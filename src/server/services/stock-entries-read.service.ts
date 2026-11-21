/**
 * Read-only helpers for `/stock/entries`' outer list columns. Split out of
 * `stock.service.ts` (owned by another in-flight bundle) so a batched line
 * count + first-line warehouse pair costs ONE round trip for the whole page
 * instead of a `getEntry` per row.
 */
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { withOrgCore, withOrgCoreTransaction, type CoreTx } from '$server/db/with-org-core';
import { getOrgTransactionDb } from '$server/db/pg-client';
import { currentAmbientOrgTx } from '$server/db/ambient-org-tx';
import type { CoreCtx } from '$server/auth/core-ctx';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { partyReadScope } from '$server/auth/party-read-scope';
import { listPartyLabelsForReadInTx, type PartyReadScope } from '$server/services/party.service';
import { entryDocument, type EntryDocumentKind } from '$lib/components/stock/entry-document';
import { stkEntryLines } from '$server/db/pg-schema/stock';

export interface EntryLineSummary {
  lineCount: number;
  firstFromWarehouseId: string | null;
  firstToWarehouseId: string | null;
}

/**
 * One grouped count query + one ordered-by-lineNo scan (ids/warehouse ids
 * only, no qty/rate) to take the first line per entry. Org scale here is
 * hundreds of entries with a handful of lines each — cheap either way.
 * ponytail: a `DISTINCT ON` would do this in one query; two plain queries
 * keep this file boring. Revisit if entry line counts grow large.
 */
export async function listEntryLineSummaries(
  ctx: CoreCtx,
  entryIds: string[],
): Promise<Map<string, EntryLineSummary>> {
  const unique = [...new Set(entryIds)];
  const result = new Map<string, EntryLineSummary>();
  if (!unique.length) return result;

  return withOrgCore(ctx, async (tx) => {
    const counts = await tx
      .select({ entryId: stkEntryLines.entryId, count: sql<number>`count(*)::int` })
      .from(stkEntryLines)
      .where(and(eq(stkEntryLines.orgId, ctx.tenantId), inArray(stkEntryLines.entryId, unique)))
      .groupBy(stkEntryLines.entryId);

    const lines = await tx
      .select({
        entryId: stkEntryLines.entryId,
        fromWarehouseId: stkEntryLines.fromWarehouseId,
        toWarehouseId: stkEntryLines.toWarehouseId,
      })
      .from(stkEntryLines)
      .where(and(eq(stkEntryLines.orgId, ctx.tenantId), inArray(stkEntryLines.entryId, unique)))
      .orderBy(asc(stkEntryLines.lineNo));

    const firstByEntry = new Map<
      string,
      { fromWarehouseId: string | null; toWarehouseId: string | null }
    >();
    for (const row of lines) {
      if (!firstByEntry.has(row.entryId)) firstByEntry.set(row.entryId, row);
    }
    const countByEntry = new Map(counts.map((c) => [c.entryId, c.count]));

    for (const id of unique) {
      const first = firstByEntry.get(id);
      result.set(id, {
        lineCount: countByEntry.get(id) ?? 0,
        firstFromWarehouseId: first?.fromWarehouseId ?? null,
        firstToWarehouseId: first?.toWarehouseId ?? null,
      });
    }
    return result;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Spec 125 — bounded, label-enriched movement readers (read-only).
// Wire shapes: specs/125-stock-readable-movements/contracts/wire.md.
// ─────────────────────────────────────────────────────────────────────────────

export const MOVEMENT_PAGE = 50;
export const RECENT_LIMIT = 20;
export const MAX_LINES = 10000;
export const MAX_STRING_OCTETS = 1048576;
export const MAX_OUTPUT_BYTES = 2097152;
export const MAX_STATEMENTS = 40;

export type MovementErrorCode =
  | 'invalid_cursor'
  | 'invalid_party'
  | 'movement_snapshot_unavailable'
  | 'movement_projection_inconsistent'
  | 'movement_statement_budget';

/** `status` maps 1:1 to the HTTP status a loader should answer. */
export class MovementError extends Error {
  constructor(
    readonly code: MovementErrorCode,
    readonly status: 400 | 503,
  ) {
    super(code);
  }
}

export type LabelState = 'available' | 'missing' | 'denied' | 'unavailable';
export type MovementKind = 'receipt' | 'issue' | 'transfer' | 'adjustment' | 'exchange';
export type SourceKind = EntryDocumentKind;
/** `label` is the raw admitted DB label (or null); the renderer applies the localized short-id fallback. */
export interface SourceLabel {
  kind: SourceKind;
  label: string | null;
  href: string;
}
export interface EntryIdentity {
  entryId: string;
  entryHref: string;
}
export interface LedgerIdentity extends EntryIdentity {
  ledgerId: string;
  itemId: string;
  warehouseId: string;
}
export interface GlobalBase extends EntryIdentity {
  type: MovementKind;
  status: 'draft' | 'submitted' | 'cancelled';
  createdAt: string;
  postedAt: string | null;
  lineCount: number;
  attachmentCount: number;
  firstFromWarehouseId: string | null;
  firstToWarehouseId: string | null;
}
export interface ItemLabel {
  itemId: string;
  name: string | null;
  code: string | null;
}
export interface LineWire {
  lineId: string;
  lineNo: number;
  itemId: string;
  qty: string;
  uom: string | null;
  rate: string | null;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
}
export interface EntryLabels {
  humanId: string | null;
  note: string | null;
  itemSummary: { first: ItemLabel | null; additionalItemCount: number };
  itemSearchText: string;
  lines: LineWire[];
  partyName: string | null;
  partyState: LabelState;
  document: SourceLabel | null;
  sourceState: LabelState;
}
export interface LedgerBase extends LedgerIdentity {
  postedAt: string;
  qtyDelta: string;
  qtyAfter: string;
  valuationRate: string;
  valueDelta: string;
}
export interface LedgerStockUnit {
  currentItemUom: string | null;
  currentState: 'available' | 'missing';
  historicalUom: null;
  historicalState: 'not_recorded';
}
export interface LedgerLabels {
  entryHumanId: string | null;
  movementKind: MovementKind | null;
  movementKindState: LabelState;
  item: ItemLabel | null;
  warehouseName: string | null;
  document: SourceLabel | null;
  sourceState: LabelState;
  counterpartyLabel: string | null;
  counterpartyState: LabelState;
  stockUnit: LedgerStockUnit;
}
interface Common<S extends string> {
  surface: S;
  nextCursor: string | null;
}
type Unavailable = { enrichmentAvailability: 'unavailable'; reason: 'capacity_limit' };
export type EntriesMovementResponse =
  | (Common<'entries'> & {
      projection: 'full';
      rows: (GlobalBase & EntryLabels)[];
      enrichmentAvailability: 'available';
      reason: null;
      itemsById: Record<string, { name: string | null; code: string | null }>;
      warehousesById: Record<string, string>;
    })
  | (Common<'entries'> & { projection: 'base_values_only'; rows: GlobalBase[] } & Unavailable)
  | (Common<'entries'> & { projection: 'identity_only'; rows: EntryIdentity[] } & Unavailable);
/** The overview card renders no rate/value column, so recent rows omit those two scalars. */
type LedgerBaseFor<S> = S extends 'recent'
  ? Omit<LedgerBase, 'valuationRate' | 'valueDelta'>
  : LedgerBase;
type LedgerResponse<S extends 'item_ledger' | 'recent'> =
  | (Common<S> & {
      projection: 'full';
      rows: (LedgerBaseFor<S> & LedgerLabels)[];
      enrichmentAvailability: 'available';
      reason: null;
    })
  | (Common<S> & { projection: 'base_values_only'; rows: LedgerBaseFor<S>[] } & Unavailable)
  | (Common<S> & { projection: 'identity_only'; rows: LedgerIdentity[] } & Unavailable);
export type ItemLedgerMovementResponse = LedgerResponse<'item_ledger'>;
export type RecentMovementResponse = LedgerResponse<'recent'>;

/** Server-internal; never serialized. */
export interface MovementAdmission {
  ctx: CoreCtx;
  source: Record<SourceKind, boolean>;
  crm: boolean;
  partyScope: PartyReadScope;
}

/**
 * Resolves every foreign dataset gate BEFORE the snapshot transaction opens.
 * TODO(handoff): spec 125 admission-snapshot.md also requires the native route/module
 * decision (isAppRouteBlocked + decideRouteAccess) per foreign link; only the dataset
 * `view` floor is applied here. See proposals/2026-11-16-faces-stock-cash-crm-meeting-followups.md.
 */
export async function resolveMovementAdmission(
  locals: App.Locals,
  ctx: CoreCtx,
): Promise<MovementAdmission> {
  const [pos, fin, sched, crm] = await Promise.all([
    datasetCtx(locals, 'pos'),
    datasetCtx(locals, 'finance'),
    datasetCtx(locals, 'scheduling'),
    datasetCtx(locals, 'crm'),
  ]);
  const crmOk = !isDenied(crm);
  return {
    ctx,
    source: {
      ticket: !isDenied(pos),
      invoice: !isDenied(fin),
      purchase: !isDenied(fin),
      booking: !isDenied(sched),
    },
    crm: crmOk,
    partyScope: crmOk ? await partyReadScope(locals) : {},
  };
}

/** Counted statement runner: the 41st statement is refused BEFORE it executes. */
export interface MovementQ {
  (query: SQL): Promise<Record<string, unknown>[]>;
  /** Count statements issued through a drizzle builder (e.g. the party batch). */
  bump(): void;
  readonly count: () => number;
}

export function makeMovementQ(
  exec: (query: SQL) => Promise<unknown>,
  initial = 0,
  max = MAX_STATEMENTS,
): MovementQ {
  let n = initial;
  const bump = () => {
    if (++n > max) throw new MovementError('movement_statement_budget', 503);
  };
  const q = (async (query: SQL) => {
    bump();
    return (await exec(query)) as Record<string, unknown>[];
  }) as MovementQ;
  q.bump = bump;
  (q as { count: () => number }).count = () => n;
  return q;
}

function sqlState(e: unknown): string | null {
  for (let cur = e, d = 0; cur && typeof cur === 'object' && d < 5; d++) {
    const c = cur as { code?: unknown; cause?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code)) return c.code;
    cur = c.cause;
  }
  return null;
}
/** 57014 statement timeout -> 503; 22008 impossible datetime in a cursor -> 400. */
async function mapSqlError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof MovementError) throw e;
    const code = sqlState(e);
    if (code === '57014') throw new MovementError('movement_snapshot_unavailable', 503);
    if (code === '22008') throw bad();
    throw e;
  }
}

/** One owned REPEATABLE READ READ ONLY transaction for every count and fetch of a request. */
export async function withMovementSnapshot<T>(
  ctx: CoreCtx,
  fn: (q: MovementQ, tx: CoreTx) => Promise<T>,
): Promise<T> {
  const ambient = currentAmbientOrgTx();
  if (ambient && !ambient.closed) throw new MovementError('movement_snapshot_unavailable', 503);
  const db = getOrgTransactionDb(ctx.db);
  return mapSqlError(() =>
    db.transaction(
      (tx) =>
        withOrgCoreTransaction(ctx, tx, async (t) => {
          // capture + apply + restore of withOrgCoreTransaction, plus the check below
          const q = makeMovementQ((query) => t.execute(query), 4);
          const [mode] = await q(
            sql`select current_setting('transaction_isolation') as iso,
            current_setting('transaction_read_only') as ro,
            set_config('statement_timeout','2000',true), set_config('lock_timeout','1000',true)`,
          );
          if (mode?.iso !== 'repeatable read' || mode?.ro !== 'on')
            throw new MovementError('movement_snapshot_unavailable', 503);
          return fn(q, t);
        }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    ),
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MAX_BIGINT = 9223372036854775807n;
const TS_FMT = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
/** Canonical UTC text with six fractional digits; ISO-8601, so `new Date()` parses it. */
const ts = (col: string) => sql.raw(`to_char(${col} at time zone 'UTC', ${TS_FMT})`);
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const inList = (ids: string[]) =>
  sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  );
const entryHref = (id: string) => `/stock/entries/${id}`;
const bad = () => new MovementError('invalid_cursor', 400);

function encodeCursor(v: object): string {
  return Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
}
function decodeCursor(raw: string, keys: string[]): Record<string, string | null> {
  if (Buffer.byteLength(raw) > 342) throw bad();
  let o: unknown;
  try {
    const text = Buffer.from(raw, 'base64url').toString('utf8');
    o = JSON.parse(text);
  } catch {
    throw bad();
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad();
  const rec = o as Record<string, unknown>;
  const k = Object.keys(rec);
  if (k.length !== keys.length || !keys.every((x) => k.includes(x))) throw bad();
  for (const v of Object.values(rec)) if (v !== null && typeof v !== 'string') throw bad();
  return rec as Record<string, string | null>;
}
/** Regex + round-trip: Date normalizes Feb 30 to Mar 2, so a changed prefix means an impossible date. */
const validTs = (v: unknown): v is string =>
  typeof v === 'string' &&
  TS_RE.test(v) &&
  new Date(`${v.slice(0, 23)}Z`).toISOString().slice(0, 19) === v.slice(0, 19);
const validUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

type EntryHead = { id: string; type: string; partyId: string | null; md: unknown };

/** Source + party states for a set of entries, one statement per source kind plus one party batch. */
async function resolveEntryContext(
  q: MovementQ,
  tx: CoreTx,
  adm: MovementAdmission,
  heads: EntryHead[],
) {
  const org = adm.ctx.tenantId;
  const docs = new Map(heads.map((h) => [h.id, entryDocument(h.type, h.md)]));
  const byKind = new Map<SourceKind, string[]>();
  for (const d of docs.values()) {
    if (!d || !adm.source[d.kind] || !validUuid(d.id)) continue;
    byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d.id]);
  }
  const labels = new Map<string, string | null>();
  const lookups: Record<SourceKind, (ids: string[]) => SQL> = {
    ticket: (ids) =>
      sql`select id, human_id as label from pos_tickets where org_id=${org} and id in (${inList(ids)})`,
    invoice: (ids) =>
      sql`select id, coalesce(document_id, number) as label from fin_invoices where org_id=${org} and id in (${inList(ids)})`,
    purchase: (ids) =>
      sql`select id, case when coalesce(serie,'')<>'' and coalesce(numero,'')<>'' then serie||'-'||numero else provider_ref end as label from fin_purchases where org_id=${org} and id in (${inList(ids)})`,
    booking: (ids) =>
      sql`select id, null::text as label from sched_bookings where org_id=${org} and id in (${inList(ids)})`,
  };
  for (const [kind, ids] of byKind) {
    for (const r of await q(lookups[kind]([...new Set(ids)])))
      labels.set(`${kind}:${r.id as string}`, (r.label as string | null) ?? null);
  }
  const partyIds = heads.map((h) => h.partyId).filter((x): x is string => !!x);
  let parties = new Map<string, string | null>();
  if (adm.crm && partyIds.length) {
    q.bump();
    parties = await listPartyLabelsForReadInTx(tx, adm.ctx, partyIds, adm.partyScope);
  }
  return new Map(
    heads.map((h) => {
      const d = docs.get(h.id) ?? null;
      let document: SourceLabel | null = null;
      let sourceState: LabelState = 'missing';
      if (d) {
        const key = `${d.kind}:${d.id}`;
        if (!adm.source[d.kind]) sourceState = 'denied';
        else if (labels.has(key)) {
          sourceState = 'available';
          document = { kind: d.kind, label: labels.get(key) ?? null, href: d.href };
        } else sourceState = 'unavailable';
      }
      let partyState: LabelState = 'missing';
      let partyName: string | null = null;
      if (h.partyId) {
        if (!adm.crm) partyState = 'denied';
        else if (parties.get(h.partyId)) {
          partyState = 'available';
          partyName = parties.get(h.partyId) ?? null;
        } else partyState = 'unavailable';
      }
      return [h.id, { document, sourceState, partyName, partyState }] as const;
    }),
  );
}

const MD_PROJECTION =
  sql.raw(`jsonb_build_object('source', metadata->'source', 'ticketId', metadata->'ticketId',
  'sourceId', metadata->'sourceId', 'invoiceId', metadata->'invoiceId', 'purchaseId', metadata->'purchaseId')`);

async function octets(q: MovementQ, query: SQL): Promise<number> {
  const [r] = await q(query);
  return Number(r?.n ?? 0);
}

// ── global entries ───────────────────────────────────────────────────────────

export async function listEntriesPage(
  ctx: CoreCtx,
  adm: MovementAdmission,
  opts: { cursor?: string | null; partyId?: string | null } = {},
): Promise<{ movements: EntriesMovementResponse; warehouseCount: number }> {
  const partyId = opts.partyId ?? null;
  if (partyId !== null && !validUuid(partyId)) throw new MovementError('invalid_party', 400);
  let after: { createdAt: string; id: string } | null = null;
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor, ['createdAt', 'id', 'partyId']);
    if (!validTs(c.createdAt) || !validUuid(c.id) || (c.partyId ?? null) !== partyId) throw bad();
    after = { createdAt: c.createdAt, id: c.id };
  }
  return withMovementSnapshot(ctx, (q, tx) => buildEntriesPage(q, tx, adm, { after, partyId }));
}

export async function buildEntriesPage(
  q: MovementQ,
  tx: CoreTx,
  adm: MovementAdmission,
  { after, partyId }: { after: { createdAt: string; id: string } | null; partyId: string | null },
): Promise<{ movements: EntriesMovementResponse; warehouseCount: number }> {
  const org = adm.ctx.tenantId;
  const rows =
    await q(sql`select id, type, status, party_id as "partyId", ${ts('created_at')} as "createdAt",
      ${ts('posted_at')} as "postedAt", coalesce(octet_length(note),0)+coalesce(octet_length(human_id),0) as octets,
      ${MD_PROJECTION} as md
    from stk_entries where org_id=${org}
      ${partyId ? sql`and party_id=${partyId}::uuid` : sql``}
      ${after ? sql`and (created_at, id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)` : sql``}
    order by created_at desc, id desc limit ${MOVEMENT_PAGE + 1}`);
  const [wh] = await q(
    sql`select count(*)::int as n from stk_warehouses where org_id=${org} and archived_at is null`,
  );
  const warehouseCount = Number(wh?.n ?? 0);
  const page = rows.slice(0, MOVEMENT_PAGE);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > MOVEMENT_PAGE && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id, partyId })
      : null;
  if (!page.length)
    return {
      warehouseCount,
      movements: {
        surface: 'entries',
        projection: 'full',
        rows: [],
        nextCursor,
        enrichmentAvailability: 'available',
        reason: null,
        itemsById: {},
        warehousesById: {},
      },
    };
  const ids = page.map((r) => r.id as string);
  const sums = await q(sql`select entry_id as "entryId", count(*)::int as n,
      (array_agg(from_warehouse_id order by line_no, id))[1] as "from",
      (array_agg(to_warehouse_id order by line_no, id))[1] as "to",
      coalesce(sum(octet_length(uom)),0)::bigint as uom
    from stk_entry_lines where org_id=${org} and entry_id in (${inList(ids)}) group by entry_id`);
  const attach = await q(sql`select object_id as "id", count(*)::int as n from attachment_links
    where org_id=${org} and object_type='stk_entry' and object_id in (${inList(ids)}) group by object_id`);
  const sumBy = new Map(sums.map((s) => [s.entryId as string, s]));
  const attBy = new Map(attach.map((a) => [a.id as string, Number(a.n)]));
  const base: GlobalBase[] = page.map((r) => {
    const s = sumBy.get(r.id as string);
    return {
      entryId: r.id as string,
      entryHref: entryHref(r.id as string),
      type: r.type as MovementKind,
      status: r.status as GlobalBase['status'],
      createdAt: r.createdAt as string,
      postedAt: (r.postedAt as string | null) ?? null,
      lineCount: Number(s?.n ?? 0),
      attachmentCount: attBy.get(r.id as string) ?? 0,
      firstFromWarehouseId: (s?.from as string | null) ?? null,
      firstToWarehouseId: (s?.to as string | null) ?? null,
    };
  });
  const fallback = (): { movements: EntriesMovementResponse; warehouseCount: number } => {
    const b: EntriesMovementResponse = {
      surface: 'entries',
      projection: 'base_values_only',
      rows: base,
      nextCursor,
      enrichmentAvailability: 'unavailable',
      reason: 'capacity_limit',
    };
    if (bytes(b) <= MAX_OUTPUT_BYTES) return { movements: b, warehouseCount };
    return {
      warehouseCount,
      movements: {
        surface: 'entries',
        projection: 'identity_only',
        rows: base.map(({ entryId, entryHref: h }) => ({ entryId, entryHref: h })),
        nextCursor,
        enrichmentAvailability: 'unavailable',
        reason: 'capacity_limit',
      },
    };
  };
  const totalLines = sums.reduce((a, s) => a + Number(s.n), 0);
  const stringOctets =
    page.reduce((a, r) => a + Number(r.octets), 0) + sums.reduce((a, s) => a + Number(s.uom), 0);
  if (totalLines > MAX_LINES || stringOctets > MAX_STRING_OCTETS) return fallback();

  const lines = totalLines
    ? await q(sql`select id, entry_id as "entryId", line_no as "lineNo", item_id as "itemId", qty::text as qty, uom,
        rate::text as rate, from_warehouse_id as "from", to_warehouse_id as "to"
      from stk_entry_lines where org_id=${org} and entry_id in (${inList(ids)})
      order by entry_id, line_no, id limit ${MAX_LINES + 1}`)
    : [];
  if (lines.length !== totalLines) throw new MovementError('movement_projection_inconsistent', 503);
  const itemIds = [...new Set(lines.map((l) => l.itemId as string))];
  const whIds = [...new Set(lines.flatMap((l) => [l.from, l.to]).filter((x): x is string => !!x))];
  const labelOctets =
    (itemIds.length
      ? await octets(
          q,
          sql`select coalesce(sum(octet_length(name)+octet_length(code)),0)::bigint as n from stk_items where org_id=${org} and id in (${inList(itemIds)})`,
        )
      : 0) +
    (whIds.length
      ? await octets(
          q,
          sql`select coalesce(sum(octet_length(name)),0)::bigint as n from stk_warehouses where org_id=${org} and id in (${inList(whIds)})`,
        )
      : 0);
  if (stringOctets + labelOctets > MAX_STRING_OCTETS) return fallback();
  const items = itemIds.length
    ? await q(
        sql`select id, code, name from stk_items where org_id=${org} and id in (${inList(itemIds)})`,
      )
    : [];
  const whs = whIds.length
    ? await q(
        sql`select id, name from stk_warehouses where org_id=${org} and id in (${inList(whIds)})`,
      )
    : [];
  const itemsById: Record<string, { name: string | null; code: string | null }> = {};
  for (const i of items)
    itemsById[i.id as string] = { name: i.name as string, code: i.code as string };
  const warehousesById: Record<string, string> = {};
  for (const w of whs) warehousesById[w.id as string] = w.name as string;
  const ctxBy = await resolveEntryContext(
    q,
    tx,
    adm,
    page.map((r) => ({
      id: r.id as string,
      type: r.type as string,
      partyId: (r.partyId as string | null) ?? null,
      md: r.md,
    })),
  );
  const hdr = await q(
    sql`select id, human_id as "humanId", note from stk_entries where org_id=${org} and id in (${inList(ids)})`,
  );
  const hdrBy = new Map(hdr.map((h) => [h.id as string, h]));
  const linesBy = new Map<string, LineWire[]>();
  for (const l of lines) {
    const w: LineWire = {
      lineId: l.id as string,
      lineNo: Number(l.lineNo),
      itemId: l.itemId as string,
      qty: l.qty as string,
      uom: (l.uom as string | null) ?? null,
      rate: (l.rate as string | null) ?? null,
      fromWarehouseId: (l.from as string | null) ?? null,
      toWarehouseId: (l.to as string | null) ?? null,
    };
    linesBy.set(l.entryId as string, [...(linesBy.get(l.entryId as string) ?? []), w]);
  }
  const full = base.map((b) => {
    const ls = linesBy.get(b.entryId) ?? [];
    const distinct = [...new Set(ls.map((l) => l.itemId))];
    const label = (id: string): ItemLabel => ({
      itemId: id,
      name: itemsById[id]?.name ?? null,
      code: itemsById[id]?.code ?? null,
    });
    const c = ctxBy.get(b.entryId)!;
    const h = hdrBy.get(b.entryId);
    return {
      ...b,
      humanId: (h?.humanId as string | null) ?? null,
      note: (h?.note as string | null) ?? null,
      itemSummary: {
        first: distinct[0] ? label(distinct[0]) : null,
        additionalItemCount: Math.max(0, distinct.length - 1),
      },
      itemSearchText: distinct
        .map((id) => `${itemsById[id]?.code ?? ''} ${itemsById[id]?.name ?? ''}`)
        .join(' ')
        .trim(),
      lines: ls,
      ...c,
    };
  });
  const out: EntriesMovementResponse = {
    surface: 'entries',
    projection: 'full',
    rows: full,
    nextCursor,
    enrichmentAvailability: 'available',
    reason: null,
    itemsById,
    warehousesById,
  };
  return bytes(out) <= MAX_OUTPUT_BYTES ? { movements: out, warehouseCount } : fallback();
}

// ── item ledger + recent ─────────────────────────────────────────────────────

export async function listItemLedgerPage(
  ctx: CoreCtx,
  adm: MovementAdmission,
  opts: { itemId: string; cursor?: string | null },
): Promise<ItemLedgerMovementResponse> {
  if (!validUuid(opts.itemId)) throw bad();
  let after: { postedAt: string; seq: string } | null = null;
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor, ['postedAt', 'seq', 'itemId']);
    if (
      !validTs(c.postedAt) ||
      typeof c.seq !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(c.seq) ||
      BigInt(c.seq) > MAX_BIGINT ||
      c.itemId !== opts.itemId
    )
      throw bad();
    after = { postedAt: c.postedAt, seq: c.seq };
  }
  return withMovementSnapshot(ctx, (q, tx) =>
    buildLedgerPage(q, tx, adm, { surface: 'item_ledger', itemId: opts.itemId, after }),
  ) as Promise<ItemLedgerMovementResponse>;
}

export function listRecentMovementRows(
  ctx: CoreCtx,
  adm: MovementAdmission,
): Promise<RecentMovementResponse> {
  return withMovementSnapshot(ctx, (q, tx) =>
    buildLedgerPage(q, tx, adm, { surface: 'recent', itemId: null, after: null }),
  ) as Promise<RecentMovementResponse>;
}

export async function buildLedgerPage(
  q: MovementQ,
  tx: CoreTx,
  adm: MovementAdmission,
  o: {
    surface: 'item_ledger' | 'recent';
    itemId: string | null;
    after: { postedAt: string; seq: string } | null;
  },
): Promise<ItemLedgerMovementResponse | RecentMovementResponse> {
  const org = adm.ctx.tenantId;
  const limit = o.surface === 'recent' ? RECENT_LIMIT : MOVEMENT_PAGE;
  const rows =
    await q(sql`select id::text as "ledgerId", entry_id as "entryId", item_id as "itemId",
      warehouse_id as "warehouseId", ${ts('posted_at')} as "postedAt", qty_delta::text as "qtyDelta",
      qty_after::text as "qtyAfter"${o.surface === 'recent' ? sql`` : sql`, valuation_rate::text as "valuationRate", value_delta::text as "valueDelta"`}
    from stk_ledger where org_id=${org}
      ${o.itemId ? sql`and item_id=${o.itemId}::uuid` : sql``}
      ${o.after ? sql`and (posted_at, id) < (${o.after.postedAt}::timestamptz, ${o.after.seq}::bigint)` : sql``}
    order by posted_at desc, id desc limit ${o.surface === 'recent' ? limit : limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    o.surface === 'item_ledger' && rows.length > limit && last
      ? encodeCursor({ postedAt: last.postedAt, seq: last.ledgerId, itemId: o.itemId })
      : null;
  const base = page.map((r) => ({
    ledgerId: r.ledgerId as string,
    entryId: r.entryId as string,
    entryHref: entryHref(r.entryId as string),
    itemId: r.itemId as string,
    warehouseId: r.warehouseId as string,
    postedAt: r.postedAt as string,
    qtyDelta: r.qtyDelta as string,
    qtyAfter: r.qtyAfter as string,
    ...(o.surface === 'recent'
      ? {}
      : { valuationRate: r.valuationRate as string, valueDelta: r.valueDelta as string }),
  })) as LedgerBase[];
  const wrap = (projection: string, rs: unknown[], avail: boolean) =>
    ({
      surface: o.surface,
      projection,
      rows: rs,
      nextCursor,
      enrichmentAvailability: avail ? 'available' : 'unavailable',
      reason: avail ? null : 'capacity_limit',
    }) as ItemLedgerMovementResponse & RecentMovementResponse;
  const fallback = () =>
    bytes(wrap('base_values_only', base, false)) <= MAX_OUTPUT_BYTES
      ? wrap('base_values_only', base, false)
      : wrap(
          'identity_only',
          base.map(({ ledgerId, entryId, entryHref: h, itemId, warehouseId }) => ({
            ledgerId,
            entryId,
            entryHref: h,
            itemId,
            warehouseId,
          })),
          false,
        );
  if (!page.length) return wrap('full', [], true);
  const entryIds = [...new Set(base.map((b) => b.entryId))];
  const itemIds = [...new Set(base.map((b) => b.itemId))];
  const whIds = [...new Set(base.map((b) => b.warehouseId))];
  const n =
    (await octets(
      q,
      sql`select coalesce(sum(coalesce(octet_length(human_id),0)),0)::bigint as n from stk_entries where org_id=${org} and id in (${inList(entryIds)})`,
    )) +
    (await octets(
      q,
      sql`select coalesce(sum(octet_length(name)+octet_length(code)+octet_length(uom)),0)::bigint as n from stk_items where org_id=${org} and id in (${inList(itemIds)})`,
    )) +
    (await octets(
      q,
      sql`select coalesce(sum(octet_length(name)),0)::bigint as n from stk_warehouses where org_id=${org} and id in (${inList(whIds)})`,
    ));
  if (n > MAX_STRING_OCTETS) return fallback();
  const heads =
    await q(sql`select id, human_id as "humanId", type, party_id as "partyId", ${MD_PROJECTION} as md
    from stk_entries where org_id=${org} and id in (${inList(entryIds)})`);
  const items = await q(
    sql`select id, code, name, uom from stk_items where org_id=${org} and id in (${inList(itemIds)})`,
  );
  const whs = await q(
    sql`select id, name from stk_warehouses where org_id=${org} and id in (${inList(whIds)})`,
  );
  const ctxBy = await resolveEntryContext(
    q,
    tx,
    adm,
    heads.map((h) => ({
      id: h.id as string,
      type: h.type as string,
      partyId: (h.partyId as string | null) ?? null,
      md: h.md,
    })),
  );
  const headBy = new Map(heads.map((h) => [h.id as string, h]));
  const itemBy = new Map(items.map((i) => [i.id as string, i]));
  const whBy = new Map(whs.map((w) => [w.id as string, w.name as string]));
  const full = base.map((b): LedgerBase & LedgerLabels => {
    const h = headBy.get(b.entryId);
    const it = itemBy.get(b.itemId);
    const c = ctxBy.get(b.entryId);
    return {
      ...b,
      entryHumanId: (h?.humanId as string | null) ?? null,
      movementKind: h ? (h.type as MovementKind) : null,
      movementKindState: h ? 'available' : 'unavailable',
      item: {
        itemId: b.itemId,
        name: (it?.name as string) ?? null,
        code: (it?.code as string) ?? null,
      },
      warehouseName: whBy.get(b.warehouseId) ?? null,
      document: c?.document ?? null,
      sourceState: c?.sourceState ?? 'unavailable',
      counterpartyLabel: c?.partyName ?? null,
      counterpartyState: c?.partyState ?? 'unavailable',
      stockUnit: {
        currentItemUom: (it?.uom as string | null) ?? null,
        currentState: it ? 'available' : 'missing',
        historicalUom: null,
        historicalState: 'not_recorded',
      },
    };
  });
  const out = wrap('full', full, true);
  return bytes(out) <= MAX_OUTPUT_BYTES ? out : fallback();
}
