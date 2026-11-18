import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import { canonicalIntentValue } from './audit.logic';
import { AuditIncompleteError, type ClosureFacts } from './audit.types';
import { clientKeySql } from './list';
import { requirePosCurrency, storedMoneyMinor } from '../money';
import { normalizeMethods } from '../settings';

/**
 * Bounded same-snapshot financial closure (contracts/evidence-and-proposals.md). Two supported shapes only:
 * A (no stored settlement anywhere in the complete known-identity closure) and B (one fully settled ordinary
 * one-service-line ticket). Everything else is an unsupported DTO with null settled/remainder. Read-only SELECTs
 * on the caller's CoreTx; query/runtime failure throws AuditIncompleteError, never an empty "successful" closure.
 */
export interface FinancialClosure {
  state:
    | 'none_stored'
    | 'fully_settled_one_line'
    | 'scope_incomplete'
    | 'identity_incomplete'
    | 'unsupported';
  currency: string | null;
  chargeMinor: string | null;
  settledMinor: string | null;
  remainderMinor: string | null;
  sourceRowsSha256: string | null;
  reasonCodes: string[];
}
export interface ClosureResult {
  financial: FinancialClosure;
  closure: ClosureFacts;
  identity: 'ok' | 'unresolved' | 'conflict';
  /** Known-zero one-line ticket with a proven-empty no-money closure (row L2). */
  zeroValueNoMoney: boolean;
  /** Payment ids of the proven ticket (shape B), for the settlement_allocation gate. */
  paymentIds: string[];
  ticketId: string | null;
  /** Product and quantity of the proven line (shape B). */
  line?: { productId: string | null; quantity: string };
}
export type ClosureSubject =
  | {
      kind: 'booking';
      id: string;
      historicalCharge: { amount: string; currency: string } | null;
      pairLineId?: string;
    }
  | { kind: 'paid_unscheduled_line'; id: string };

const ROW_BUDGET = 10_000;
const DOC_OK = (v: string | null) =>
  v !== null &&
  v.length > 0 &&
  Buffer.byteLength(v, 'utf8') <= 32 &&
  v === v.trim() &&
  !/[\u0000-\u001f\u007f]/.test(v);
const uniq = (xs: string[]) => [...new Set(xs)].sort();

class Budget {
  used = 0;
  take(rows: number) {
    this.used += rows;
    if (this.used > ROW_BUDGET) throw new AuditIncompleteError('closure_row_budget');
  }
}
async function rows<T extends Record<string, unknown>>(
  tx: CoreTx,
  budget: Budget,
  query: SQL,
): Promise<T[]> {
  const out = await tx.execute<T>(query);
  budget.take(out.length);
  return [...out] as unknown as T[];
}
const minor = (v: unknown, currency: string) => {
  try {
    requirePosCurrency(currency);
    return storedMoneyMinor(v);
  } catch {
    throw new AuditIncompleteError('invalid_stored_amount');
  }
};

const unsupported = (
  blockers: string[],
  identity: ClosureResult['identity'] = 'ok',
): ClosureResult => ({
  financial: {
    state: identity === 'ok' ? 'unsupported' : 'identity_incomplete',
    currency: null,
    chargeMinor: null,
    settledMinor: null,
    remainderMinor: null,
    sourceRowsSha256: null,
    reasonCodes: uniq(['settlement_shape_unsupported', ...blockers]),
  },
  closure: { shape: 'none', blockers: uniq(blockers) },
  identity,
  zeroValueNoMoney: false,
  paymentIds: [],
  ticketId: null,
});

export async function loadAuditFinancialClosure(
  tx: CoreTx,
  orgId: string,
  subject: ClosureSubject,
  coverage: 'organization_all_date' | 'approved_scope',
): Promise<ClosureResult> {
  if (coverage !== 'organization_all_date') {
    // Finite U never issues an all-date closure query.
    return {
      financial: {
        state: 'scope_incomplete',
        currency: null,
        chargeMinor: null,
        settledMinor: null,
        remainderMinor: null,
        sourceRowsSha256: null,
        reasonCodes: ['settlement_scope_incomplete'],
      },
      closure: { shape: 'none', blockers: [] },
      identity: 'ok',
      zeroValueNoMoney: false,
      paymentIds: [],
      ticketId: null,
    };
  }
  const budget = new Budget();
  // Subject identity and direct funding facets.
  let clientKey: string | null = null;
  let bookingFunding = false;
  let directTicketId: string | null = null;
  let explicitInvoice: string | null = null;
  let lineId: string | null = null;
  let bookingId: string | null = null;
  if (subject.kind === 'booking') {
    bookingId = subject.id;
    const [b] = await rows<{
      client_key: string | null;
      funded: boolean;
      invoice: string | null;
      party_conflict: boolean;
    }>(
      tx,
      budget,
      sql`
      select case when b.party_id is not null or b.crm_contact_id is not null then ${clientKeySql('b')} end as client_key,
             (b.package_grant_id is not null or b.payment_plan_id is not null) as funded, b.invoice_id::text as invoice,
             (b.party_id is not null and c.party_id is not null and c.deleted_at is null and c.party_id <> b.party_id) as party_conflict
      from public.sched_bookings b left join public.crm_contacts c on c.id = b.crm_contact_id and c.org_id = b.org_id
      where b.org_id = ${orgId} and b.id = ${subject.id}::uuid`,
    );
    if (!b) return unsupported(['settlement_identity_incomplete'], 'unresolved');
    if (b.party_conflict) return unsupported(['identity_conflict'], 'conflict');
    clientKey = b.client_key;
    bookingFunding = b.funded;
    explicitInvoice = b.invoice;
    if (subject.pairLineId) lineId = subject.pairLineId;
  } else {
    lineId = subject.id;
  }
  if (lineId) {
    const [l] = await rows<{
      client_key: string | null;
      ticket_id: string;
      party_conflict: boolean;
    }>(
      tx,
      budget,
      sql`
      select case when t.party_id is not null or t.crm_contact_id is not null then ${clientKeySql('t')} end as client_key,
             t.id::text as ticket_id,
             (t.party_id is not null and c.party_id is not null and c.deleted_at is null and c.party_id <> t.party_id) as party_conflict
      from public.pos_ticket_lines tl join public.pos_tickets t on t.id = tl.ticket_id and t.org_id = tl.org_id
      left join public.crm_contacts c on c.id = t.crm_contact_id and c.org_id = t.org_id
      where tl.org_id = ${orgId} and tl.id = ${lineId}::uuid`,
    );
    if (!l) return unsupported(['settlement_identity_incomplete'], 'unresolved');
    if (l.party_conflict) return unsupported(['identity_conflict'], 'conflict');
    if (subject.kind === 'paid_unscheduled_line') clientKey = l.client_key;
    else if (clientKey !== l.client_key) return unsupported(['identity_conflict'], 'conflict');
    directTicketId = l.ticket_id;
  }
  if (!clientKey?.startsWith('party:'))
    return unsupported(['settlement_identity_incomplete'], 'unresolved');
  const partyId = clientKey.slice(6);
  const [party] = await rows<{ type: string; doc_type: string | null; doc_number: string | null }>(
    tx,
    budget,
    sql`
    select type, doc_type, doc_number from public.parties where org_id = ${orgId} and id = ${partyId}::uuid`,
  );
  if (
    !party ||
    !['person', 'company'].includes(party.type) ||
    !DOC_OK(party.doc_type) ||
    !DOC_OK(party.doc_number)
  ) {
    return unsupported(['settlement_identity_incomplete'], 'unresolved');
  }

  // Same-client collections (every status/kind/date/currency; nothing filtered to qualify a positive case).
  const tickets = await rows<{
    id: string;
    status: string;
    currency: string;
    total: string;
    provider_ref: string | null;
  }>(
    tx,
    budget,
    sql`
    select t.id::text as id, t.status, t.currency, t.total::text as total, nullif(t.invoice_provider_ref,'') as provider_ref
    from public.pos_tickets t left join public.crm_contacts c on c.id = t.crm_contact_id and c.org_id = t.org_id
    where t.org_id = ${orgId} and (t.party_id is not null or t.crm_contact_id is not null) and ${clientKeySql('t')} = ${clientKey}
    order by t.id`,
  );
  const ticketIds = uniq([
    ...tickets.map((t) => t.id),
    ...(directTicketId ? [directTicketId] : []),
  ]);
  const ticketArray = sql.raw(
    `array[${ticketIds.map((i) => `'${i}'`).join(',') || 'null'}]::uuid[]`,
  );
  const lines = ticketIds.length
    ? await rows<{
        id: string;
        ticket_id: string;
        kind: string;
        booking_id: string | null;
        plan_id: string | null;
        redemption_id: string | null;
        product: string | null;
        qty: string;
        total: string;
      }>(
        tx,
        budget,
        sql`
        select id::text, ticket_id::text, kind, booking_id::text, plan_id::text, redemption_id::text, fin_product_id::text as product, qty::text, total::text
        from public.pos_ticket_lines where org_id = ${orgId} and ticket_id = any(${ticketArray}) order by id`,
      )
    : [];
  const payments = ticketIds.length
    ? await rows<{
        id: string;
        ticket_id: string;
        method: string;
        amount: string;
        kind: string | null;
      }>(
        tx,
        budget,
        sql`
        select id::text, ticket_id::text, method, amount::text, metadata->>'kind' as kind
        from public.pos_payments where org_id = ${orgId} and ticket_id = any(${ticketArray}) order by id`,
      )
    : [];
  const emissions = ticketIds.length
    ? await rows<{ id: string }>(
        tx,
        budget,
        sql`select id::text from public.pos_emissions where org_id = ${orgId} and ticket_id = any(${ticketArray}) order by id`,
      )
    : [];
  const plans = await rows<{ id: string }>(
    tx,
    budget,
    sql`
    select p.id::text as id from public.pos_payment_plans p left join public.crm_contacts c on c.id = p.crm_contact_id and c.org_id = p.org_id
    where p.org_id = ${orgId} and (p.party_id is not null or p.crm_contact_id is not null) and ${clientKeySql('p')} = ${clientKey} order by p.id`,
  );
  const grants = await rows<{ id: string }>(
    tx,
    budget,
    sql`
    select g.id::text as id from public.pos_package_grants g left join public.crm_contacts c on c.id = g.crm_contact_id and c.org_id = g.org_id
    where g.org_id = ${orgId} and (g.party_id is not null or g.crm_contact_id is not null) and ${clientKeySql('g')} = ${clientKey} order by g.id`,
  );
  const redemptions = grants.length
    ? await rows<{ id: string }>(
        tx,
        budget,
        sql`select id::text from public.pos_package_redemptions where org_id = ${orgId} and grant_id = any(${sql.raw(`array[${grants.map((g) => `'${g.id}'`).join(',')}]::uuid[]`)}) order by id`,
      )
    : [];
  const ledger = await rows<{ id: string }>(
    tx,
    budget,
    sql`
    select l.id::text as id from public.pos_client_ledger l left join public.crm_contacts c on c.id = l.crm_contact_id and c.org_id = l.org_id
    where l.org_id = ${orgId} and (l.party_id is not null or l.crm_contact_id is not null) and ${clientKeySql('l')} = ${clientKey} order by l.id`,
  );
  // Finance identity: bound fin_clients, document probes, and every reached invoice with its payments.
  const finClients = await rows<{ id: string; doc_type: string | null; doc_number: string | null }>(
    tx,
    budget,
    sql`
    select id::text, doc_type, doc_number from public.fin_clients where org_id = ${orgId} and party_id = ${partyId}::uuid order by id`,
  );
  const probeClients = await rows<{ id: string }>(
    tx,
    budget,
    sql`
    select id::text from public.fin_clients where org_id = ${orgId} and doc_number = ${party.doc_number} and (party_id is distinct from ${partyId}::uuid) order by id`,
  );
  const clientArray = finClients.length
    ? sql.raw(`array[${finClients.map((c) => `'${c.id}'`).join(',')}]::uuid[]`)
    : null;
  const clientInvoices = clientArray
    ? await rows<{ id: string }>(
        tx,
        budget,
        sql`select id::text from public.fin_invoices where org_id = ${orgId} and client_id = any(${clientArray}) order by id`,
      )
    : [];
  const probeInvoices = await rows<{ id: string }>(
    tx,
    budget,
    sql`
    select id::text from public.fin_invoices where org_id = ${orgId} and client_doc_number = ${party.doc_number}
      and (client_id is null or ${clientArray ? sql`not (client_id = any(${clientArray}))` : sql`true`}) order by id`,
  );
  const providerRefs = uniq(
    tickets.map((t) => t.provider_ref).filter((r): r is string => r !== null),
  );
  const providerInvoices = providerRefs.length
    ? await rows<{ id: string }>(
        tx,
        budget,
        sql`select id::text from public.fin_invoices where org_id = ${orgId} and provider_ref = any(${sql.raw(`array[${providerRefs.map((r) => `'${r.replaceAll("'", "''")}'`).join(',')}]::text[]`)}) order by id`,
      )
    : [];
  let explicitMissing = false;
  const explicitInvoices: { id: string }[] = [];
  if (explicitInvoice) {
    explicitInvoices.push(
      ...(await rows<{ id: string }>(
        tx,
        budget,
        sql`select id::text from public.fin_invoices where org_id = ${orgId} and id = ${explicitInvoice}::uuid`,
      )),
    );
    explicitMissing = explicitInvoices.length === 0;
  }
  const invoiceIds = uniq(
    [...clientInvoices, ...probeInvoices, ...providerInvoices, ...explicitInvoices].map(
      (i) => i.id,
    ),
  );
  const finPayments = invoiceIds.length
    ? await rows<{ id: string }>(
        tx,
        budget,
        sql`select id::text from public.fin_payments where org_id = ${orgId} and invoice_id = any(${sql.raw(`array[${invoiceIds.map((i) => `'${i}'`).join(',')}]::uuid[]`)}) order by id`,
      )
    : [];

  const sourceRowsSha256 = createHash('sha256')
    .update(
      canonicalIntentValue({
        tickets: ticketIds,
        lines: lines.map((l) => l.id),
        payments: payments.map((p) => p.id),
        emissions: emissions.map((e) => e.id),
        plans: plans.map((p) => p.id),
        grants: grants.map((g) => g.id),
        redemptions: redemptions.map((r) => r.id),
        ledger: ledger.map((l) => l.id),
        finClients: finClients.map((c) => c.id),
        probeClients: probeClients.map((c) => c.id),
        invoices: invoiceIds,
        finPayments: finPayments.map((p) => p.id),
      }),
    )
    .digest('hex');

  // Blockers (specific, closed codes).
  const blockers: string[] = [];
  const refund = payments.some((p) => p.kind !== null || Number(p.amount) <= 0);
  if (refund) blockers.push('refund_or_correction_unsupported');
  if (ledger.length) blockers.push('wallet_allocation_unsupported');
  if (
    plans.length ||
    grants.length ||
    redemptions.length ||
    bookingFunding ||
    lines.some((l) => l.plan_id || l.redemption_id)
  )
    blockers.push('funding_allocation_unsupported');
  if (invoiceIds.length || finPayments.length || providerRefs.length)
    blockers.push('invoice_settlement_unsupported');
  if (providerRefs.length && providerInvoices.length === 0)
    blockers.push('invoice_link_unresolved');
  if (explicitMissing) blockers.push('invoice_link_unresolved');
  if (emissions.length) blockers.push('fiscal_evidence_unsupported');
  if (
    probeClients.length ||
    probeInvoices.length ||
    finClients.some(
      (c) =>
        (c.doc_number !== null && c.doc_number !== party.doc_number) ||
        (c.doc_type !== null && c.doc_type !== party.doc_type),
    )
  ) {
    blockers.push('finance_identity_probe_unresolved');
  }
  const base = {
    identity: 'ok' as const,
    zeroValueNoMoney: false,
    paymentIds: [] as string[],
    ticketId: null as string | null,
  };
  const finish = (
    state: FinancialClosure['state'],
    shape: ClosureFacts['shape'],
    extra: Partial<FinancialClosure>,
    bl: string[],
  ): ClosureResult => ({
    ...base,
    financial: {
      state,
      currency: null,
      chargeMinor: null,
      settledMinor: null,
      remainderMinor: null,
      sourceRowsSha256,
      reasonCodes: uniq(
        bl.length
          ? ['settlement_shape_unsupported', ...bl]
          : [shape === 'A' ? 'no_stored_settlement' : 'stored_one_line_ticket_fully_settled'],
      ),
      ...extra,
    },
    closure: { shape, blockers: uniq(bl) },
  });

  const subjectLine = lineId ? lines.find((l) => l.id === lineId) : undefined;
  const wantsB =
    subject.kind === 'paid_unscheduled_line' ||
    (subject.kind === 'booking' && !!subject.pairLineId);
  if (wantsB) {
    if (!subjectLine)
      return finish('unsupported', 'none', {}, [...blockers, 'ticket_allocation_unsupported']);
    const ticket = tickets.find((t) => t.id === subjectLine.ticket_id);
    const ticketLines = lines.filter((l) => l.ticket_id === subjectLine.ticket_id);
    const ticketPayments = payments.filter((p) => p.ticket_id === subjectLine.ticket_id);
    // L2: known-zero one-line ticket with a proven-empty no-money closure.
    const zero =
      !!ticket &&
      ticket.status === 'submitted' &&
      tickets.length === 1 &&
      ticketLines.length === 1 &&
      minor(subjectLine.total, ticket.currency) === 0n &&
      minor(ticket.total, ticket.currency) === 0n &&
      payments.length === 0 &&
      blockers.length === 0 &&
      subject.kind === 'paid_unscheduled_line';
    const bl = [...blockers];
    let ok = !!ticket && blockers.length === 0;
    if (!ticket || ticket.status !== 'submitted' || tickets.length !== 1) {
      bl.push('ticket_allocation_unsupported');
      ok = false;
    }
    if (
      ticketLines.length !== 1 ||
      subjectLine.kind !== 'service' ||
      subjectLine.booking_id ||
      subjectLine.plan_id ||
      subjectLine.redemption_id ||
      !subjectLine.product ||
      Number(subjectLine.qty) <= 0
    ) {
      bl.push('ticket_allocation_unsupported');
      ok = false;
    }
    let total = 0n;
    if (ticket && ok) {
      const lineMinor = minor(subjectLine.total, ticket.currency);
      total = minor(ticket.total, ticket.currency);
      const sum = ticketPayments.reduce((s, p) => s + minor(p.amount, ticket.currency), 0n);
      if (
        lineMinor <= 0n ||
        total !== lineMinor ||
        ticketPayments.length < 1 ||
        ticketPayments.length > 20 ||
        sum !== total ||
        payments.length !== ticketPayments.length
      ) {
        bl.push('partial_or_excess_settlement_unsupported');
        ok = false;
      }
    }
    if (ticket && ok) {
      // Methods resolve uniquely in this snapshot's stored settings; never DEFAULT_POS_SETTINGS.
      const [settings] = await rows<{ methods: unknown }>(
        tx,
        budget,
        sql`select methods from public.pos_settings where org_id = ${orgId}`,
      );
      let methods: ReturnType<typeof normalizeMethods> = [];
      try {
        methods = settings ? normalizeMethods(settings.methods) : [];
      } catch {
        methods = [];
      }
      const good = ticketPayments.every(
        (p) =>
          methods.filter((m) => m.id === p.method).length === 1 &&
          methods.find((m) => m.id === p.method)!.drawsOnCredit === false &&
          methods.find((m) => m.id === p.method)!.requiresCreditDecision === false,
      );
      if (!good) {
        bl.push('payment_method_unverified');
        ok = false;
      }
    }
    if (ok && ticket) {
      const result = finish(
        'fully_settled_one_line',
        'B',
        {
          currency: ticket.currency,
          chargeMinor: total.toString(),
          settledMinor: total.toString(),
          remainderMinor: '0',
        },
        [],
      );
      result.paymentIds = ticketPayments.map((p) => p.id).sort();
      result.ticketId = ticket.id;
      result.line = { productId: subjectLine.product, quantity: subjectLine.qty };
      result.financial.currency = ticket.currency;
      if (subject.kind === 'booking') {
        // The booking may use this proof only when its admitted charge equals this one line exactly.
        const h = subject.historicalCharge;
        if (!h || h.currency !== ticket.currency || minor(h.amount, h.currency) !== total)
          return finish('unsupported', 'none', {}, [
            'settlement_shape_unsupported',
            'ticket_allocation_unsupported',
          ]);
      }
      return result;
    }
    const out = finish(
      uniq(bl).includes('settlement_identity_incomplete') ? 'identity_incomplete' : 'unsupported',
      'none',
      {},
      bl,
    );
    out.zeroValueNoMoney = zero;
    return out;
  }
  // Booking shape A needs an admitted positive charge and a completely empty closure.
  if (subject.kind === 'booking') {
    const h = subject.historicalCharge;
    if (!h) return finish('unsupported', 'none', {}, [...blockers]);
    if (tickets.length || payments.length)
      blockers.push(
        payments.length
          ? 'partial_or_excess_settlement_unsupported'
          : 'ticket_allocation_unsupported',
      );
    if (blockers.length === 0) {
      const charge = minor(h.amount, h.currency);
      if (charge <= 0n) return finish('unsupported', 'none', {}, ['settlement_shape_unsupported']);
      return finish(
        'none_stored',
        'A',
        {
          currency: h.currency,
          chargeMinor: charge.toString(),
          settledMinor: '0',
          remainderMinor: charge.toString(),
        },
        [],
      );
    }
    return finish('unsupported', 'none', {}, blockers);
  }
  return finish('unsupported', 'none', {}, blockers);
}

export interface StockFacet {
  availability: 'available' | 'unavailable';
  entries: { id: string; type: string; status: string }[];
  ledger: { id: string; entryId: string; itemId: string; qtyDelta: string }[];
  accruals: {
    id: string;
    source: string;
    sourceId: string;
    qty: string;
    status: string;
    realizedEntryId: string | null;
  }[];
  fingerprint: string | null;
}
const STOCK_CAP = 1000;

/**
 * Stock source evidence for one pair (R6 decision IR-08): entries by the ticket's stock_entry_id or metadata.sourceId
 * equal to the ticket/booking id, ledger rows by those entries, accruals by (source, source_id). Reads nothing and
 * reports `unavailable` when the caller lacks enabled stock + stock:view + unrestricted scope.
 */
export async function loadAuditStockFacet(
  tx: CoreTx,
  orgId: string,
  ref: { ticketId: string; bookingId: string },
  allowed: boolean,
): Promise<StockFacet> {
  if (!allowed)
    return {
      availability: 'unavailable',
      entries: [],
      ledger: [],
      accruals: [],
      fingerprint: null,
    };
  const take = <T>(list: T[]) => {
    if (list.length > STOCK_CAP) throw new AuditIncompleteError('stock_facet_limit');
    return list;
  };
  const entries = take([
    ...(await tx.execute<{ id: string; type: string; status: string }>(sql`
    select e.id::text as id, e.type, e.status from public.stk_entries e
    where e.org_id = ${orgId} and (e.id = (select stock_entry_id from public.pos_tickets where org_id = ${orgId} and id = ${ref.ticketId}::uuid)
       or e.metadata->>'sourceId' in (${ref.ticketId}, ${ref.bookingId}))
    order by e.id limit ${STOCK_CAP + 1}`)),
  ] as unknown as { id: string; type: string; status: string }[]);
  const ledger = entries.length
    ? take([
        ...(await tx.execute<{
          id: string;
          entry_id: string;
          item_id: string;
          qty_delta: string;
        }>(sql`
        select id::text, entry_id::text, item_id::text, qty_delta::text from public.stk_ledger
        where org_id = ${orgId} and entry_id = any(${sql.raw(`array[${entries.map((e) => `'${e.id}'`).join(',')}]::uuid[]`)})
        order by posted_at, id limit ${STOCK_CAP + 1}`)),
      ] as unknown as { id: string; entry_id: string; item_id: string; qty_delta: string }[])
    : [];
  const accruals = take([
    ...(await tx.execute<{
      id: string;
      source: string;
      source_id: string;
      qty: string;
      status: string;
      realized_entry_id: string | null;
    }>(sql`
    select id::text, source, source_id::text, qty::text, status, realized_entry_id::text from public.stk_accruals
    where org_id = ${orgId} and ((source = 'booking' and source_id = ${ref.bookingId}::uuid) or (source = 'pos' and source_id = ${ref.ticketId}::uuid))
    order by id limit ${STOCK_CAP + 1}`)),
  ] as unknown as {
    id: string;
    source: string;
    source_id: string;
    qty: string;
    status: string;
    realized_entry_id: string | null;
  }[]);
  const facet = {
    entries,
    ledger: ledger.map((l) => ({
      id: l.id,
      entryId: l.entry_id,
      itemId: l.item_id,
      qtyDelta: l.qty_delta,
    })),
    accruals: accruals.map((a) => ({
      id: a.id,
      source: a.source,
      sourceId: a.source_id,
      qty: a.qty,
      status: a.status,
      realizedEntryId: a.realized_entry_id,
    })),
  };
  return {
    availability: 'available',
    ...facet,
    fingerprint: createHash('sha256').update(canonicalIntentValue(facet)).digest('hex'),
  };
}
