/**
 * Read-only source collection for the FACES stock diagnostic (contracts/report.md, source-explanation.md).
 * Every statement is org-qualified, key/ID-qualified and bounded (limit+1 => capacity); the caller owns the
 * REPEATABLE READ READ ONLY transaction and passes `exec`. Ledger ids are selected as text only.
 * TODO(handoff): `stk_corrections` rows are not read as `correction` source evidence and prior_correction refs are not resolved (see meta proposals/2026-11-17-hub-faces-stock-reconciliation-handoff.md).
 * No names, notes, phones, emails, payment metadata, status-log reasons or raw warning text are selected.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  UUID_RE,
  cmpLedgerId,
  cmpRef,
  cmpStr,
  decodeStockEntrySource,
  type BinRow,
  type ClassifierComponent,
  type DiagnosticCase,
  type DiagnosticEvidenceRef,
  type GraphEdge,
  type GraphNode,
  type LedgerMovement,
  type SourceEvidenceRow,
  type SourceRef,
  type TimelineRow,
  type WarningEvidence,
} from './faces-stock-reconciliation';

export type Row = Record<string, unknown>;
export type Exec = (query: SQL) => Promise<Row[]>;

export const LIMITS = {
  ledgerRows: 50_000,
  entries: 1_000,
  keys: 1_000,
  rowsPerTable: 10_000,
  statementMs: 12_000,
  totalMs: 60_000,
} as const;

export class ReadFailure extends Error {
  constructor(
    readonly code:
      'capacity' | 'timeout' | 'read_failed' | 'provenance_incomplete' | 'unsupported_numeric',
  ) {
    super(`diagnostic read failed: ${code}`);
    this.name = 'ReadFailure';
  }
}

const TS = (col: string) =>
  sql.raw(`to_char(${col} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
const HASH = sql.raw(`encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')`);
const uuids = (ids: readonly string[]) =>
  ids.length
    ? sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )
    : sql`null::uuid`;
const str = (v: unknown): string => String(v);
const nstr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const sortedUnique = (xs: Iterable<string>) => [...new Set(xs)].sort(cmpStr);

export interface Collected {
  tickets: Row[];
  lines: Row[];
  payments: Row[];
  bookings: Row[];
  bookingProducts: Row[];
  statusLog: Row[];
  invoices: Row[];
  accruals: Row[];
  grants: Row[];
  redemptions: Row[];
  entries: Row[];
  entryLines: Row[];
  ledgerRaw: Row[];
  bins: BinRow[];
  keys: { itemId: string; warehouseId: string }[];
  labels: {
    items: { itemId: string; name: string | null; code: string | null; uom: string | null }[];
    products: { productId: string; name: string | null }[];
    warehouses: { warehouseId: string; name: string | null }[];
  };
}

/** One bounded query: scan limit+1 so an overflow is a capacity failure, never a silent prefix. */
async function bounded(
  exec: Exec,
  query: SQL,
  limit: number,
  deadline: () => void,
): Promise<Row[]> {
  deadline();
  const rows = await exec(sql`${query} limit ${limit + 1}`);
  if (rows.length > limit) throw new ReadFailure('capacity');
  return rows;
}

export function makeDeadline(totalMs: number, now: () => number = Date.now): () => void {
  const start = now();
  return () => {
    if (now() - start > totalMs) throw new ReadFailure('timeout');
  };
}

export async function collectEvidence(
  exec: Exec,
  orgId: string,
  cases: readonly DiagnosticCase[],
  assertedKeys: readonly { itemId: string; warehouseId: string }[],
  deadline: () => void,
): Promise<Collected> {
  const org = sql`${orgId}`;
  const seedTickets = sortedUnique(cases.flatMap((c) => c.ticketIds));
  const seedBookings = sortedUnique(cases.flatMap((c) => c.bookingIds));
  const seedItems = sortedUnique(cases.flatMap((c) => c.itemIds));
  const T = LIMITS.rowsPerTable;

  // 1. Expand the ticket/booking graph through exact stable links only (no name/date guessing).
  const linesBySeed = await bounded(
    exec,
    sql`select l.ticket_id::text as ticket_id, l.booking_id::text as booking_id from pos_ticket_lines l
        where l.org_id = ${org} and (l.ticket_id in (${uuids(seedTickets)}) or l.booking_id in (${uuids(seedBookings)}))`,
    T,
    deadline,
  );
  const ticketIds = sortedUnique([...seedTickets, ...linesBySeed.map((r) => str(r.ticket_id))]);
  const bookingIdsFromLines = linesBySeed
    .map((r) => nstr(r.booking_id))
    .filter((x): x is string => !!x);
  const lines = await bounded(
    exec,
    sql`select t.id::text as id, t.ticket_id::text as ticket_id, t.kind, t.fin_product_id::text as fin_product_id,
          t.booking_id::text as booking_id, t.qty::text as qty, t.unit_price::text as unit_price,
          t.discount::text as discount, t.total::text as total, t.line_no, t.plan_id::text as plan_id,
          t.redemption_id::text as redemption_id, ${HASH} as hash
        from pos_ticket_lines t where t.org_id = ${org} and t.ticket_id in (${uuids(ticketIds)})`,
    T,
    deadline,
  );
  const bookingIds = sortedUnique([
    ...seedBookings,
    ...bookingIdsFromLines,
    ...lines.map((r) => nstr(r.booking_id)).filter((x): x is string => !!x),
  ]);
  const tickets = await bounded(
    exec,
    sql`select t.id::text as id, t.status, ${TS('t.submitted_at')} as submitted_at, ${TS('t.voided_at')} as voided_at,
          t.currency, t.total::text as total, t.stock_entry_id::text as stock_entry_id,
          t.invoice_provider_ref as provider_ref,
          case when t.stock_warning is null then null else jsonb_typeof(t.stock_warning) end as warning_type,
          t.stock_warning->>'code' as warning_code, t.stock_warning->>'draftEntryId' as warning_draft,
          case when jsonb_typeof(t.stock_warning->'items') = 'array' then t.stock_warning->'items' else null end as warning_items,
          case when t.stock_warning is null then null else encode(sha256(convert_to(t.stock_warning::text,'UTF8')),'hex') end as warning_sha,
          ${HASH} as hash
        from pos_tickets t where t.org_id = ${org} and t.id in (${uuids(ticketIds)})`,
    T,
    deadline,
  );
  const payments = await bounded(
    exec,
    sql`select t.id::text as id, t.ticket_id::text as ticket_id, ${TS('t.paid_at')} as paid_at, t.amount::text as amount,
          t.method, p.currency, ${HASH} as hash
        from pos_payments t join pos_tickets p on p.id = t.ticket_id and p.org_id = ${org}
        where t.org_id = ${org} and t.ticket_id in (${uuids(ticketIds)})`,
    T,
    deadline,
  );
  const bookings = await bounded(
    exec,
    sql`select t.id::text as id, t.status, t.resource_id::text as resource_id, ${TS('t.start_time')} as start_time,
          ${TS('t.end_time')} as end_time, ${TS('t.created_at')} as created_at, ${TS('t.updated_at')} as updated_at,
          t.product_id::text as product_id, t.event_type_id::text as event_type_id,
          t.metadata->>'groupId' as group_id, t.rescheduled_from_id::text as rescheduled_from_id,
          t.invoice_id::text as invoice_id, t.package_grant_id::text as package_grant_id,
          t.payment_plan_id::text as payment_plan_id, ${HASH} as hash
        from sched_bookings t where t.org_id = ${org} and t.id in (${uuids(bookingIds)})`,
    T,
    deadline,
  );
  const invoiceIds = sortedUnique(
    bookings.map((r) => nstr(r.invoice_id)).filter((x): x is string => !!x),
  );
  const providerRefs = sortedUnique(
    tickets.map((r) => nstr(r.provider_ref)).filter((x): x is string => !!x),
  );
  const invoices = await bounded(
    exec,
    sql`select t.id::text as id, t.provider_ref, ${HASH} as hash from fin_invoices t
        where t.org_id = ${org} and (t.id in (${uuids(invoiceIds)})
          or t.provider_ref in (${
            providerRefs.length
              ? sql.join(
                  providerRefs.map((p) => sql`${p}`),
                  sql`, `,
                )
              : sql`null`
          }))`,
    T,
    deadline,
  );
  const bookingProducts = await bounded(
    exec,
    sql`select t.id::text as id, t.booking_id::text as booking_id, t.product_id::text as product_id, t.qty::text as qty,
          ${TS('t.created_at')} as created_at, ${TS('t.updated_at')} as updated_at, ${HASH} as hash
        from sched_booking_products t where t.org_id = ${org} and t.booking_id in (${uuids(bookingIds)})`,
    T,
    deadline,
  );
  // The log's free-text `reason` is deliberately never selected.
  const statusLog = await bounded(
    exec,
    sql`select t.id::text as id, t.booking_id::text as booking_id, t.from_status, t.to_status,
          t.changed_by::text as changed_by, ${TS('t.changed_at')} as changed_at, ${HASH} as hash
        from sched_booking_status_log t where t.org_id = ${org} and t.booking_id in (${uuids(bookingIds)})`,
    T,
    deadline,
  );
  const accruals = await bounded(
    exec,
    sql`select t.id::text as id, t.source, t.source_id::text as source_id, t.fin_product_id::text as fin_product_id,
          t.item_id::text as item_id, t.warehouse_id::text as warehouse_id, t.status, t.qty_consumption::text as qty_consumption,
          t.qty::text as qty, t.realized_entry_id::text as realized_entry_id, t.realized_qty::text as realized_qty,
          t.realized_value::text as realized_value, ${TS('t.created_at')} as created_at, ${TS('t.updated_at')} as updated_at,
          ${TS('t.realized_at')} as realized_at, ${TS('t.released_at')} as released_at, ${HASH} as hash
        from stk_accruals t where t.org_id = ${org}
          and (t.source_id in (${uuids([...bookingIds, ...ticketIds])}) or t.item_id in (${uuids(seedItems)}))`,
    T,
    deadline,
  );
  const grants = await bounded(
    exec,
    sql`select t.id::text as id, t.source_ticket_id::text as source_ticket_id, t.source_line_id::text as source_line_id,
          t.package_product_id::text as package_product_id, t.service_product_id::text as service_product_id,
          t.sessions_total, t.unit_value::text as unit_value, to_char(t.expires_at,'YYYY-MM-DD') as expires_at, t.status,
          ${TS('t.created_at')} as created_at, ${TS('t.cancelled_at')} as cancelled_at, ${HASH} as hash
        from pos_package_grants t where t.org_id = ${org} and t.source_ticket_id in (${uuids(ticketIds)})`,
    T,
    deadline,
  );
  const redemptions = await bounded(
    exec,
    sql`select t.id::text as id, t.grant_id::text as grant_id, t.booking_id::text as booking_id, t.ticket_id::text as ticket_id,
          t.ticket_line_id::text as ticket_line_id, ${TS('t.redeemed_at')} as redeemed_at, ${TS('t.reversed_at')} as reversed_at,
          ${HASH} as hash
        from pos_package_redemptions t where t.org_id = ${org}
          and (t.ticket_id in (${uuids(ticketIds)}) or t.booking_id in (${uuids(bookingIds)}))`,
    T,
    deadline,
  );

  // 2. Draft/provenance entries: ticket stamp, warning draft, accrual realization and source-owned lookups.
  const entryIds = sortedUnique(
    [
      ...tickets.map((r) => nstr(r.stock_entry_id)),
      ...tickets.map((r) => nstr(r.warning_draft)),
      ...accruals.map((r) => nstr(r.realized_entry_id)),
    ].filter((x): x is string => !!x && UUID_RE.test(x)),
  );
  const sourceOwned = await bounded(
    exec,
    sql`select t.id::text as id from stk_entries t where t.org_id = ${org}
        and (t.metadata->>'sourceId' in (${sql.join([...ticketIds, ...bookingIds].map((i) => sql`${i}`).concat(sql`'-'`), sql`, `)})
          or lower(btrim(t.metadata->>'invoiceId')) in (${sql.join(invoiceIds.map((i) => sql`${i}`).concat(sql`'-'`), sql`, `)}))`,
    LIMITS.entries,
    deadline,
  );
  const seedEntryIds = sortedUnique([...entryIds, ...sourceOwned.map((r) => str(r.id))]);

  // 3. Affected item/warehouse keys: asserted components, accruals, and entry lines of the seed entries.
  const seedLines = await bounded(
    exec,
    sql`select t.item_id::text as item_id, t.from_warehouse_id::text as from_wh, t.to_warehouse_id::text as to_wh
        from stk_entry_lines t where t.org_id = ${org} and t.entry_id in (${uuids(seedEntryIds)})`,
    T,
    deadline,
  );
  const keySet = new Map<string, { itemId: string; warehouseId: string }>();
  const addKey = (itemId: string | null, wh: string | null) => {
    if (itemId && wh) keySet.set(`${itemId}:${wh}`, { itemId, warehouseId: wh });
  };
  for (const k of assertedKeys) addKey(k.itemId, k.warehouseId);
  for (const a of accruals) addKey(nstr(a.item_id), nstr(a.warehouse_id));
  for (const l of seedLines) {
    addKey(nstr(l.item_id), nstr(l.from_wh));
    addKey(nstr(l.item_id), nstr(l.to_wh));
  }
  const itemOnly = sortedUnique([...seedItems, ...[...keySet.values()].map((k) => k.itemId)]);
  // Item-only history: every warehouse that holds a ledger row or a bin for those items.
  const itemWh = await bounded(
    exec,
    sql`select distinct x.item_id::text as item_id, x.warehouse_id::text as warehouse_id from (
          select item_id, warehouse_id from stk_ledger where org_id = ${org} and item_id in (${uuids(itemOnly)})
          union select item_id, warehouse_id from stk_bins where org_id = ${org} and item_id in (${uuids(itemOnly)})) x`,
    LIMITS.keys,
    deadline,
  );
  for (const r of itemWh) addKey(str(r.item_id), str(r.warehouse_id));
  if (keySet.size > LIMITS.keys) throw new ReadFailure('capacity');
  const keys = [...keySet.values()].sort(
    (a, b) => cmpStr(a.itemId, b.itemId) || cmpStr(a.warehouseId, b.warehouseId),
  );

  // 4. Full history of every admitted key (opening included), text ids only.
  const keyPredicate = keys.length
    ? sql.join(
        keys.map(
          (k) => sql`(l.item_id = ${k.itemId}::uuid and l.warehouse_id = ${k.warehouseId}::uuid)`,
        ),
        sql` or `,
      )
    : sql`false`;
  const ledgerRaw = await bounded(
    exec,
    sql`select l.id::text as id, l.entry_id::text as entry_id, l.item_id::text as item_id, l.warehouse_id::text as warehouse_id,
          l.qty_delta::text as qty_delta, l.value_delta::text as value_delta, l.qty_after::text as qty_after,
          l.valuation_rate::text as valuation_rate, ${TS('l.posted_at')} as posted_at
        from stk_ledger l where l.org_id = ${org} and (${keyPredicate}) order by l.id`,
    LIMITS.ledgerRows,
    deadline,
  );
  const binPredicate = keys.length
    ? sql.join(
        keys.map(
          (k) => sql`(l.item_id = ${k.itemId}::uuid and l.warehouse_id = ${k.warehouseId}::uuid)`,
        ),
        sql` or `,
      )
    : sql`false`;
  const binRows = await bounded(
    exec,
    sql`select l.item_id::text as item_id, l.warehouse_id::text as warehouse_id, l.qty::text as qty, l.valuation_rate::text as rate
        from stk_bins l where l.org_id = ${org} and (${binPredicate})`,
    LIMITS.keys,
    deadline,
  );
  const allEntryIds = sortedUnique([...seedEntryIds, ...ledgerRaw.map((r) => str(r.entry_id))]);
  if (allEntryIds.length > LIMITS.entries + LIMITS.ledgerRows) throw new ReadFailure('capacity');
  const entries = await bounded(
    exec,
    sql`select t.id::text as id, t.type, t.status, t.metadata, encode(sha256(convert_to(t.metadata::text,'UTF8')),'hex') as metadata_sha,
          ${TS('t.created_at')} as created_at, ${TS('t.updated_at')} as updated_at, ${TS('t.posted_at')} as posted_at, ${HASH} as hash
        from stk_entries t where t.org_id = ${org} and t.id in (${uuids(allEntryIds)})`,
    LIMITS.entries + LIMITS.ledgerRows,
    deadline,
  );
  const entryLines = await bounded(
    exec,
    sql`select t.id::text as id, t.entry_id::text as entry_id, t.item_id::text as item_id, t.qty::text as qty, t.uom,
          t.rate::text as rate, t.from_warehouse_id::text as from_wh, t.to_warehouse_id::text as to_wh, t.line_no, ${HASH} as hash
        from stk_entry_lines t where t.org_id = ${org} and t.entry_id in (${uuids(allEntryIds)})`,
    T * 5,
    deadline,
  );
  const labelItems = sortedUnique([...keys.map((k) => k.itemId)]);
  const labelWh = sortedUnique(keys.map((k) => k.warehouseId));
  const labelProducts = sortedUnique(
    [
      ...lines.map((r) => nstr(r.fin_product_id)),
      ...bookings.map((r) => nstr(r.product_id)),
    ].filter((x): x is string => !!x),
  );
  const itemLabels = await bounded(
    exec,
    sql`select id::text as id, name, code, uom from stk_items where org_id = ${org} and id in (${uuids(labelItems)})`,
    LIMITS.keys,
    deadline,
  );
  const whLabels = await bounded(
    exec,
    sql`select id::text as id, name from stk_warehouses where org_id = ${org} and id in (${uuids(labelWh)})`,
    LIMITS.keys,
    deadline,
  );
  const productLabels = await bounded(
    exec,
    sql`select id::text as id, name from fin_products where org_id = ${org} and id in (${uuids(labelProducts)})`,
    T,
    deadline,
  );
  return {
    tickets,
    lines,
    payments,
    bookings,
    bookingProducts,
    statusLog,
    invoices,
    accruals,
    grants,
    redemptions,
    entries,
    entryLines,
    ledgerRaw,
    bins: binRows.map((r) => ({
      itemId: str(r.item_id),
      warehouseId: str(r.warehouse_id),
      qty: str(r.qty),
      rate: str(r.rate),
    })),
    keys,
    labels: {
      items: itemLabels.map((r) => ({
        itemId: str(r.id),
        name: nstr(r.name),
        code: nstr(r.code),
        uom: nstr(r.uom),
      })),
      products: productLabels.map((r) => ({ productId: str(r.id), name: nstr(r.name) })),
      warehouses: whLabels.map((r) => ({ warehouseId: str(r.id), name: nstr(r.name) })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Pure mapping from rows to evidence (no I/O): decoders, SourceEvidenceRow, timeline, graph
// ---------------------------------------------------------------------------------------------
const warningOf = (t: Row): WarningEvidence => {
  if (t.warning_type === null || t.warning_type === undefined)
    return { state: 'none', code: null, sourceSha256: null, draftEntryId: null, items: [] };
  const code =
    typeof t.warning_code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(t.warning_code)
      ? t.warning_code
      : null;
  const draft =
    typeof t.warning_draft === 'string' && UUID_RE.test(t.warning_draft) ? t.warning_draft : null;
  if (t.warning_type !== 'object' || code === null)
    return {
      state: 'unavailable',
      code: null,
      sourceSha256: nstr(t.warning_sha),
      draftEntryId: null,
      items: [],
    };
  const items = (Array.isArray(t.warning_items) ? t.warning_items : [])
    .filter((i): i is Row => !!i && typeof i === 'object')
    .map((i) => ({ itemId: i.itemId, requested: i.requested, available: i.available }))
    .filter(
      (i) =>
        typeof i.itemId === 'string' &&
        UUID_RE.test(i.itemId) &&
        /^-?\d+(\.\d+)?$/.test(String(i.requested)) &&
        /^-?\d+(\.\d+)?$/.test(String(i.available)),
    )
    .slice(0, 1000)
    .map((i) => ({
      itemId: String(i.itemId),
      requested: String(i.requested),
      available: String(i.available),
    }));
  return { state: 'present', code, sourceSha256: nstr(t.warning_sha), draftEntryId: draft, items };
};

export interface Derived {
  sourceEvidence: SourceEvidenceRow[];
  timeline: TimelineRow[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  ledger: LedgerMovement[];
  entrySource: Map<string, ReturnType<typeof decodeStockEntrySource>>;
}

export function deriveEvidence(c: Collected, observedAt: string): Derived {
  const ev = new Map<string, SourceEvidenceRow>();
  const timeline: TimelineRow[] = [];
  const edges: GraphEdge[] = [];
  const add = (
    ref: SourceRef,
    hash: unknown,
    value: Record<string, unknown> & { kind: string },
    times: [string, unknown][],
  ) => {
    ev.set(`${ref.kind}:${ref.id}`, { ref, state: 'available', rowSha256: str(hash), value });
    if (!times.length) times = [['state_observed', null]];
    for (const [field, at] of times)
      timeline.push({
        ref,
        field,
        at: field === 'state_observed' ? observedAt : nstr(at),
        meaning:
          field === 'state_observed'
            ? 'current_state_observation'
            : at === null || at === undefined
              ? 'timestamp_unavailable'
              : 'stored_source_time',
      });
  };
  const link = (from: SourceRef, to: SourceRef, relation: GraphEdge['relation']) =>
    edges.push({ from, to, relation });
  for (const t of c.tickets) {
    const ref: SourceRef = { kind: 'pos_ticket', id: str(t.id) };
    add(
      ref,
      t.hash,
      {
        kind: 'ticket',
        status: str(t.status),
        submittedAt: str(t.submitted_at),
        voidedAt: nstr(t.voided_at),
        currency: str(t.currency),
        total: str(t.total),
        stockEntryId: nstr(t.stock_entry_id),
        warning: warningOf(t),
      },
      [
        ['submitted_at', t.submitted_at],
        ['voided_at', t.voided_at],
      ],
    );
    if (t.stock_entry_id) link(ref, { kind: 'stock_entry', id: str(t.stock_entry_id) }, 'links');
  }
  for (const l of c.lines) {
    const ref: SourceRef = { kind: 'pos_ticket_line', id: str(l.id) };
    add(
      ref,
      l.hash,
      {
        kind: 'sale_line',
        ticketId: str(l.ticket_id),
        lineKind: str(l.kind),
        finProductId: nstr(l.fin_product_id),
        bookingId: nstr(l.booking_id),
        qty: str(l.qty),
        unitPrice: str(l.unit_price),
        discount: str(l.discount),
        total: str(l.total),
        lineNo: Number(l.line_no),
        planId: nstr(l.plan_id),
        redemptionId: nstr(l.redemption_id),
      },
      [],
    );
    link({ kind: 'pos_ticket', id: str(l.ticket_id) }, ref, 'owns');
    if (l.booking_id) link(ref, { kind: 'booking', id: str(l.booking_id) }, 'links');
  }
  for (const p of c.payments) {
    const ref: SourceRef = { kind: 'payment', id: str(p.id) };
    add(
      ref,
      p.hash,
      {
        kind: 'payment',
        ticketId: str(p.ticket_id),
        paidAt: str(p.paid_at),
        amount: str(p.amount),
        method: str(p.method),
        currency: str(p.currency),
      },
      [['paid_at', p.paid_at]],
    );
    link({ kind: 'pos_ticket', id: str(p.ticket_id) }, ref, 'owns');
  }
  // Booking groups: same resource AND byte-equal groupId (never the groupId alone).
  const groups = new Map<string, { resourceId: string; groupId: string; members: Row[] }>();
  for (const b of c.bookings) {
    const ref: SourceRef = { kind: 'booking', id: str(b.id) };
    add(
      ref,
      b.hash,
      {
        kind: 'booking',
        status: str(b.status),
        resourceId: str(b.resource_id),
        startTime: str(b.start_time),
        endTime: str(b.end_time),
        createdAt: str(b.created_at),
        updatedAt: str(b.updated_at),
        productId: nstr(b.product_id),
        eventTypeId: str(b.event_type_id),
        groupId: nstr(b.group_id),
        rescheduledFromId: nstr(b.rescheduled_from_id),
        invoiceId: nstr(b.invoice_id),
        packageGrantId: nstr(b.package_grant_id),
        paymentPlanId: nstr(b.payment_plan_id),
      },
      [
        ['start_time', b.start_time],
        ['end_time', b.end_time],
        ['created_at', b.created_at],
        ['updated_at', b.updated_at],
      ],
    );
    if (b.invoice_id) link(ref, { kind: 'invoice', id: str(b.invoice_id) }, 'links');
    if (
      typeof b.group_id === 'string' &&
      b.group_id.length > 0 &&
      Buffer.byteLength(b.group_id) <= 256
    ) {
      const key = `${b.resource_id}/${b.group_id}`;
      const g = groups.get(key) ?? {
        resourceId: str(b.resource_id),
        groupId: b.group_id,
        members: [],
      };
      g.members.push(b);
      groups.set(key, g);
    }
  }
  for (const [key, g] of groups) {
    const ref: SourceRef = { kind: 'booking_group', id: key };
    const memberIds = g.members.map((m) => str(m.id)).sort(cmpStr);
    const hash = `${memberIds.join()}`; // replaced below by canonical digest in the CLI assembler
    add(
      ref,
      hash.length
        ? sha(
            JSON.stringify({
              resourceId: g.resourceId,
              groupId: g.groupId,
              memberRows: g.members
                .map((m) => ({ id: str(m.id), rowSha256: str(m.hash) }))
                .sort((a, b) => cmpStr(a.id, b.id)),
            }),
          )
        : '',
      { kind: 'booking_group', resourceId: g.resourceId, groupId: g.groupId, memberIds },
      [],
    );
    for (const m of memberIds) link(ref, { kind: 'booking', id: m }, 'owns');
  }
  for (const r of c.bookingProducts) {
    const ref: SourceRef = { kind: 'booking_product', id: str(r.id) };
    add(
      ref,
      r.hash,
      {
        kind: 'booking_product',
        bookingId: str(r.booking_id),
        productId: str(r.product_id),
        qty: str(r.qty),
        createdAt: str(r.created_at),
        updatedAt: str(r.updated_at),
      },
      [
        ['created_at', r.created_at],
        ['updated_at', r.updated_at],
      ],
    );
    link({ kind: 'booking', id: str(r.booking_id) }, ref, 'owns');
  }
  for (const r of c.statusLog) {
    const ref: SourceRef = { kind: 'booking_status', id: str(r.id) };
    add(
      ref,
      r.hash,
      {
        kind: 'booking_status',
        bookingId: str(r.booking_id),
        fromStatus: nstr(r.from_status),
        toStatus: str(r.to_status),
        changedBy: nstr(r.changed_by),
        changedAt: str(r.changed_at),
      },
      [['changed_at', r.changed_at]],
    );
    link({ kind: 'booking', id: str(r.booking_id) }, ref, 'owns');
  }
  for (const r of c.invoices)
    add(
      { kind: 'invoice', id: str(r.id) },
      r.hash,
      { kind: 'invoice', providerRef: nstr(r.provider_ref) },
      [],
    );
  for (const r of c.accruals) {
    const ref: SourceRef = { kind: 'accrual', id: str(r.id) };
    add(
      ref,
      r.hash,
      {
        kind: 'accrual',
        source: str(r.source),
        sourceId: str(r.source_id),
        finProductId: nstr(r.fin_product_id),
        itemId: str(r.item_id),
        warehouseId: str(r.warehouse_id),
        status: str(r.status),
        qtyConsumption: str(r.qty_consumption),
        qty: str(r.qty),
        realizedEntryId: nstr(r.realized_entry_id),
        realizedQty: nstr(r.realized_qty),
        realizedValue: nstr(r.realized_value),
        createdAt: str(r.created_at),
        updatedAt: str(r.updated_at),
        realizedAt: nstr(r.realized_at),
        releasedAt: nstr(r.released_at),
      },
      [
        ['created_at', r.created_at],
        ['updated_at', r.updated_at],
        ['realized_at', r.realized_at],
        ['released_at', r.released_at],
      ],
    );
    if (r.realized_entry_id)
      link(ref, { kind: 'stock_entry', id: str(r.realized_entry_id) }, 'realizes');
  }
  for (const r of c.grants) {
    const ref: SourceRef = { kind: 'grant', id: str(r.id) };
    add(
      ref,
      r.hash,
      {
        kind: 'grant',
        sourceTicketId: str(r.source_ticket_id),
        sourceLineId: str(r.source_line_id),
        packageProductId: str(r.package_product_id),
        serviceProductId: str(r.service_product_id),
        sessionsTotal: Number(r.sessions_total),
        unitValue: str(r.unit_value),
        expiresAt: nstr(r.expires_at),
        status: str(r.status),
        createdAt: str(r.created_at),
        cancelledAt: nstr(r.cancelled_at),
      },
      [
        ['created_at', r.created_at],
        ['cancelled_at', r.cancelled_at],
      ],
    );
  }
  for (const r of c.redemptions) {
    const ref: SourceRef = { kind: 'redemption', id: str(r.id) };
    add(
      ref,
      r.hash,
      {
        kind: 'redemption',
        grantId: str(r.grant_id),
        bookingId: nstr(r.booking_id),
        ticketId: nstr(r.ticket_id),
        ticketLineId: nstr(r.ticket_line_id),
        redeemedAt: str(r.redeemed_at),
        reversedAt: nstr(r.reversed_at),
      },
      [
        ['redeemed_at', r.redeemed_at],
        ['reversed_at', r.reversed_at],
      ],
    );
  }
  const entrySource = new Map<string, ReturnType<typeof decodeStockEntrySource>>();
  const entryInfo = new Map<string, Row>();
  for (const e of c.entries) {
    const source = decodeStockEntrySource(str(e.type), e.metadata, str(e.metadata_sha));
    entrySource.set(str(e.id), source);
    entryInfo.set(str(e.id), e);
    const ref: SourceRef = { kind: 'stock_entry', id: str(e.id) };
    add(
      ref,
      e.hash,
      {
        kind: 'stock_entry',
        type: str(e.type),
        status: str(e.status),
        createdAt: str(e.created_at),
        updatedAt: str(e.updated_at),
        postedAt: nstr(e.posted_at),
        source,
      },
      [
        ['created_at', e.created_at],
        ['updated_at', e.updated_at],
        ['posted_at', e.posted_at],
      ],
    );
    // Edges exist only for pos, booking and invoice sources.
    if (source.kind === 'pos') link(ref, { kind: 'pos_ticket', id: source.id }, 'links');
    if (source.kind === 'booking') link(ref, { kind: 'booking', id: source.id }, 'links');
    if (source.kind === 'invoice') link(ref, { kind: 'invoice', id: source.id }, 'links');
  }
  for (const l of c.entryLines) {
    const ref: SourceRef = { kind: 'stock_line', id: str(l.id) };
    add(
      ref,
      l.hash,
      {
        kind: 'stock_line',
        entryId: str(l.entry_id),
        itemId: str(l.item_id),
        qty: str(l.qty),
        uom: nstr(l.uom),
        rate: nstr(l.rate),
        fromWarehouseId: nstr(l.from_wh),
        toWarehouseId: nstr(l.to_wh),
        lineNo: Number(l.line_no),
      },
      [],
    );
    link({ kind: 'stock_entry', id: str(l.entry_id) }, ref, 'owns');
  }
  const ledger: LedgerMovement[] = c.ledgerRaw.map((r) => {
    const e = entryInfo.get(str(r.entry_id));
    const source = entrySource.get(str(r.entry_id)) ?? {
      kind: 'unknown' as const,
      metadataSha256: '0'.repeat(64),
    };
    return {
      ledgerId: str(r.id),
      entryId: str(r.entry_id),
      entryState: e ? (str(e.status) as 'draft') : 'unavailable',
      entryType: e ? (str(e.type) as 'issue') : 'unavailable',
      itemId: str(r.item_id),
      warehouseId: str(r.warehouse_id),
      qtyDelta: str(r.qty_delta),
      valueDelta: str(r.value_delta),
      qtyAfter: str(r.qty_after),
      valuationRate: str(r.valuation_rate),
      postedAt: str(r.posted_at),
      source,
    };
  });
  for (const m of ledger)
    timeline.push({
      ref: { kind: 'ledger', id: m.ledgerId },
      field: 'posted_at',
      at: m.postedAt,
      meaning: 'stored_source_time',
    });
  // Referenced-but-absent rows become explicit missing nodes, never silent zeroes.
  const nodes = new Map<string, GraphNode>();
  for (const e of ev.values())
    nodes.set(`${e.ref.kind}:${e.ref.id}`, {
      ref: e.ref,
      state: 'available',
      rowSha256: e.rowSha256,
    });
  for (const m of ledger)
    nodes.set(`ledger:${m.ledgerId}`, {
      ref: { kind: 'ledger', id: m.ledgerId },
      state: 'available',
      rowSha256: null,
    });
  for (const edge of edges)
    for (const ref of [edge.from, edge.to]) {
      const k = `${ref.kind}:${ref.id}`;
      if (!nodes.has(k)) nodes.set(k, { ref, state: 'missing_or_unavailable', rowSha256: null });
    }
  const uniqEdges = [
    ...new Map(
      edges.map((e) => [`${e.from.kind}:${e.from.id}>${e.to.kind}:${e.to.id}>${e.relation}`, e]),
    ).values(),
  ];
  return {
    sourceEvidence: [...ev.values()].sort((a, b) => cmpRef(a.ref, b.ref)),
    timeline: timeline.sort((a, b) => {
      if (a.at === null || b.at === null) return a.at === b.at ? 0 : a.at === null ? 1 : -1;
      return cmpStr(a.at, b.at) || cmpRef(a.ref, b.ref) || cmpStr(a.field, b.field);
    }),
    nodes: [...nodes.values()].sort((a, b) => cmpRef(a.ref, b.ref)),
    edges: uniqEdges.sort(
      (a, b) => cmpRef(a.from, b.from) || cmpRef(a.to, b.to) || cmpStr(a.relation, b.relation),
    ),
    ledger: ledger.sort((a, b) => cmpLedgerId(a.ledgerId, b.ledgerId)),
    entrySource,
  };
}
import { createHash } from 'node:crypto';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Components from owner-verified assertions only (today's mapping is never historical intent). */
export function componentsFromAssertions(
  refs: readonly DiagnosticEvidenceRef[],
  derived: Derived,
  c: Collected,
): { components: ClassifierComponent[]; conflict: boolean } {
  const lineTicket = new Map(c.lines.map((l) => [str(l.id), str(l.ticket_id)]));
  const ticketBookings = new Map<string, Set<string>>();
  for (const l of c.lines)
    if (l.booking_id) {
      const s = ticketBookings.get(str(l.ticket_id)) ?? new Set();
      s.add(str(l.booking_id));
      ticketBookings.set(str(l.ticket_id), s);
    }
  const asserted = refs.flatMap((r) =>
    r.assertion?.kind === 'expected_component' ? [{ r, a: r.assertion.component }] : [],
  );
  const seen = new Map<string, string>();
  let conflict = false;
  const out: ClassifierComponent[] = [];
  const bookingsAsserted = new Set(
    asserted.filter((x) => x.a.source.kind === 'booking').map((x) => x.a.source.id),
  );
  for (const { r, a } of asserted) {
    const key = `${a.source.kind}:${a.source.id}:${a.itemId}:${a.warehouseId}`;
    const sig = `${a.intendedStockQty}|${a.stockUom}|${a.fulfilled}|${a.trueUpCoverage}`;
    if (seen.has(key) && seen.get(key) !== sig) conflict = true;
    if (seen.has(key)) continue;
    seen.set(key, sig);
    let attribution: ClassifierComponent['attribution'];
    let sharedUnallocated = false;
    if (a.source.kind === 'pos_ticket') attribution = { kind: 'pos', id: a.source.id };
    else if (a.source.kind === 'pos_ticket_line')
      attribution = { kind: 'pos', id: lineTicket.get(a.source.id) ?? a.source.id };
    else {
      const owners = [...ticketBookings].filter(([, bs]) => bs.has(a.source.id)).map(([t]) => t);
      if (owners.length === 1) {
        attribution = { kind: 'pos', id: owners[0] };
        sharedUnallocated = [...(ticketBookings.get(owners[0]) ?? [])].some(
          (b) => !bookingsAsserted.has(b),
        );
      } else attribution = { kind: 'booking', id: a.source.id };
    }
    out.push({
      source: a.source,
      attribution,
      itemId: a.itemId,
      warehouseId: a.warehouseId,
      intendedStockQty: a.intendedStockQty,
      stockUom: a.stockUom,
      fulfilled: a.fulfilled,
      trueUpCoverage: a.trueUpCoverage,
      intentSource: 'owner_assertion',
      sharedUnallocated,
      evidenceReferenceIds: [r.referenceId],
    });
  }
  void derived;
  return { components: out, conflict };
}
