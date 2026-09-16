import { and, desc, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  posClientLedger,
  posPaymentPlans,
  posTicketLines,
  posTickets,
  type PosClientLedgerRow,
  type PosPaymentPlan,
} from '$server/db/pg-pos-schema';
import { parties } from '$server/db/pg-party-schema';
import { crmContacts } from '$server/db/pg-crm-schema';
import { schedBookings } from '$server/db/pg-scheduling-schema';
// Deliberate circular import, same rationale as pos-emission.service.ts:
// PosError (a class) and getPosSettings (a function) are only touched when a
// function actually runs, never at module-eval time, so ESM resolves this
// safely whichever module loads first. Keeping ONE PosError means every POS
// API route keeps mapping `err.code` the way it already does.
import { PosError, getPosSettings, type Actor } from './pos.service';
import {
  ledgerBalance,
  nextDueInstalment,
  planProgress,
  round2,
  type DueInstalment,
} from './pos-accounts.logic';

/**
 * Client accounts: the append-only stored-value ledger and instalment plans.
 *
 * Spec: specs/2026-09-13-pos-scheduling-packages-payment-plans-spec.md §2.1,
 * §2.2, §3.4, §3.5. Slice S1 — data layer only; the API routes, the `credit`
 * tender and the void reversal land in S2.
 *
 * Two invariants this file exists to protect:
 *   - the ledger is APPEND-ONLY. There is no update and no delete path here; a
 *     correction is a new opposing row, so `sum(amount)` is always the balance.
 *   - a plan's paid-to-date is DERIVED from its ticket lines over non-void
 *     tickets. Nothing stores a running total, so voiding an instalment ticket
 *     un-pays the plan with no extra bookkeeping.
 */

/**
 * How a client is addressed. Both facets are soft refs (party spine + CRM
 * contact) and at least one must be present — the rows carry the same pair, so
 * a lookup matches on EITHER.
 */
export interface ClientRef {
  partyId?: string | null;
  crmContactId?: string | null;
}

export const LEDGER_KINDS = ['topup', 'deposit', 'redemption', 'refund', 'adjustment'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const PLAN_STATUSES = ['open', 'settled', 'cancelled'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface LedgerEntryInput {
  client: ClientRef;
  kind: LedgerKind;
  /** SIGNED: positive adds credit, negative consumes it. Never 0. */
  amount: number;
  currency?: string;
  ticketId?: string | null;
  planId?: string | null;
  bookingId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  actor?: Actor;
}

export interface PlanInput {
  client: ClientRef;
  title: string;
  totalAmount: number;
  currency?: string;
  productId?: string | null;
  bookingId?: string | null;
  /** Advisory `[{ dueOn: 'YYYY-MM-DD', amount }]` — nothing auto-charges. */
  dueSchedule?: { dueOn: string; amount: number }[] | null;
  note?: string | null;
  actor?: Actor;
}

export interface PlanDetail {
  plan: PosPaymentPlan;
  /** Sum of this plan's ticket lines over non-void tickets. */
  paidToDate: number;
  remaining: number;
  isPaid: boolean;
  /** The next instalment of the advisory `due_schedule` that `paidToDate` does
   *  not cover (spec §4.1). Null with no schedule, or when it is all paid. */
  nextDue: DueInstalment | null;
}

/** Assemble a PlanDetail — one place, so every read carries the same facets. */
function planDetail(
  plan: PosPaymentPlan,
  paidLines: { total: string | number | null }[],
): PlanDetail {
  const progress = planProgress(plan.totalAmount, paidLines);
  return { plan, ...progress, nextDue: nextDueInstalment(plan.dueSchedule, progress.paidToDate) };
}

/** Throws unless the ref carries at least one identity. */
function requireClient(client: ClientRef): ClientRef {
  if (!client?.partyId && !client?.crmContactId)
    throw new PosError('partyId or crmContactId is required', 'client_required');
  return client;
}

/**
 * Match rows belonging to one client. OR, not AND: rows written when only the
 * CRM facet was known must still be found once the party spine is attached.
 */
export interface ClientColumns {
  partyId: PgColumn;
  crmContactId: PgColumn;
}

/**
 * Fill in the facet the caller did not supply, so a lookup by EITHER identity
 * finds rows recorded under the other.
 *
 * A client can exist as a bare party (POS quick-add writes only the party
 * spine) or as a CRM contact, and `crm_contacts.party_id` is the bridge between
 * them. Without this widening a read keyed on one facet silently misses every
 * row stamped with the other — a package sold to a POS-created client, looked
 * up later by CRM contact, would come back empty and the sessions would be
 * unreachable. Resolving once here fixes it for every caller instead of leaving
 * each read to remember.
 *
 * Fail-soft: no bridge row just means the ref stays as it came in, which is the
 * old behaviour. Org-scoped, so a foreign id widens to nothing.
 */
export async function widenClient(
  tx: CoreTx,
  orgId: string,
  client: ClientRef,
): Promise<ClientRef> {
  requireClient(client);
  if (client.partyId && client.crmContactId) return client;
  if (client.crmContactId) {
    const [hit] = await tx
      .select({ partyId: crmContacts.partyId })
      .from(crmContacts)
      .where(and(eq(crmContacts.orgId, orgId), eq(crmContacts.id, client.crmContactId)))
      .limit(1);
    return hit?.partyId ? { ...client, partyId: hit.partyId } : client;
  }
  const [hit] = await tx
    .select({ id: crmContacts.id })
    .from(crmContacts)
    .where(and(eq(crmContacts.orgId, orgId), eq(crmContacts.partyId, client.partyId!)))
    .limit(1);
  return hit?.id ? { ...client, crmContactId: hit.id } : client;
}

export function clientMatch(client: ClientRef, cols: ClientColumns): SQL {
  requireClient(client);
  const preds: SQL[] = [];
  if (client.partyId) preds.push(eq(cols.partyId, client.partyId));
  if (client.crmContactId) preds.push(eq(cols.crmContactId, client.crmContactId));
  // preds is non-empty (requireClient), so the `or` result is never undefined.
  return preds.length === 1 ? preds[0] : (or(...preds) as SQL);
}

/**
 * Stable URL key for one client account: the CRM facet when known, else the
 * party spine. `contact:<uuid>` / `party:<uuid>` — prefixed so the detail route
 * knows which column to match without guessing.
 *
 * TODO(handoff): accounts are GROUPED by this key, so a client whose older rows
 * carry only the party facet and whose newer rows carry both shows up as two
 * accounts until the facets are backfilled. Every write path in this slice
 * stamps both facets when the ticket carries both; a party→contact resolution
 * pass is the upgrade if real data needs it.
 */
export function clientKeyOf(client: ClientRef): string {
  requireClient(client);
  return client.crmContactId ? `contact:${client.crmContactId}` : `party:${client.partyId}`;
}

export function parseClientKey(key: string): ClientRef {
  const [kind, id] = key.split(':', 2);
  if (kind === 'contact' && id) return { crmContactId: id };
  if (kind === 'party' && id) return { partyId: id };
  throw new PosError('client key must be contact:<id> or party:<id>', 'invalid_client_key');
}

/** One row of the /pos/accounts list. */
export interface ClientAccountSummary {
  clientKey: string;
  partyId: string | null;
  crmContactId: string | null;
  balance: number;
  /** Grants whose STORED status is still 'active' — expiry/exhaustion are
   *  derived per grant on the detail read, not here. */
  activeGrants: number;
  openPlans: number;
  /** Σ total_amount of the open plans (not the outstanding balance). */
  openPlanTotal: number;
  /** CRM contact name, else the party spine's — null when neither row exists. */
  displayName: string | null;
  /** Service lines this client has PAID FOR but not yet booked — DERIVED from
   *  `pos_ticket_lines.booking_id is null` on a non-void ticket, never a status
   *  column (a booking attached later, or a void, must not leave a stale flag). */
  pendingScheduling: number;
  /** Most recent ticket carrying one, so the row can resume scheduling at
   *  `/pos/sell?step=schedule&ticket=<id>`. Null when nothing is pending.
   *  TODO(handoff): a client with SEVERAL pending tickets only gets a link to
   *  the newest; the older ones are reachable only by finding the ticket. A
   *  per-ticket breakdown in ClientAccountDrawer is the upgrade. See meta
   *  proposals/2026-09-13-pos-packages-plans-s1-followups.md §31. */
  pendingTicketId: string | null;
}

/**
 * Every client holding credit, a live package, an open plan, or a service they
 * paid for and have not booked yet.
 *
 * One query rather than four-plus-a-merge in JS: each table is grouped on its
 * own, their keys are unioned, and the groupings are left-joined back onto that
 * union — a client may appear in any subset of them. A client whose ONLY open
 * item is an unscheduled service still shows up (that is why `s` joins the
 * union, not just the left-join list).
 */
export async function listClientAccounts(
  ctx: CoreCtx,
  opts: { limit?: number } = {},
): Promise<ClientAccountSummary[]> {
  const limit = Math.min(opts.limit ?? 200, 500);
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      with l as (
        select coalesce('contact:' || crm_contact_id::text, 'party:' || party_id::text) as k,
               max(party_id::text) as party_id, max(crm_contact_id::text) as crm_contact_id,
               sum(amount) as balance
          from pos_client_ledger where org_id = ${ctx.tenantId} group by 1
      ), g as (
        select coalesce('contact:' || crm_contact_id::text, 'party:' || party_id::text) as k,
               max(party_id::text) as party_id, max(crm_contact_id::text) as crm_contact_id,
               count(*)::int as active_grants
          from pos_package_grants
         where org_id = ${ctx.tenantId} and status = 'active' group by 1
      ), p as (
        select coalesce('contact:' || crm_contact_id::text, 'party:' || party_id::text) as k,
               max(party_id::text) as party_id, max(crm_contact_id::text) as crm_contact_id,
               count(*)::int as open_plans, sum(total_amount) as plan_total
          from pos_payment_plans
         where org_id = ${ctx.tenantId} and status = 'open' group by 1
      ), s as (
        -- TODO(handoff): this counts EVERY historical service line without a
        -- booking, so on first deploy the column lights up for the whole back
        -- catalogue (services sold before the scheduling step existed, and
        -- services that never needed one). A cutoff date or a per-org opt-in is
        -- the fix if the noise is real. See meta
        -- proposals/2026-09-13-pos-packages-plans-s1-followups.md §30.
        -- "Pending scheduling": a service line with no booking, on a live
        -- ticket, for an identified client. Walk-ins (no party AND no contact)
        -- are excluded on purpose — there is nobody to list the row under.
        select coalesce('contact:' || t.crm_contact_id::text, 'party:' || t.party_id::text) as k,
               max(t.party_id::text) as party_id, max(t.crm_contact_id::text) as crm_contact_id,
               count(*)::int as pending_scheduling,
               (array_agg(t.id::text order by t.submitted_at desc))[1] as pending_ticket_id
          from pos_ticket_lines tl
          join pos_tickets t on t.id = tl.ticket_id and t.org_id = tl.org_id
         where tl.org_id = ${ctx.tenantId}
           and tl.kind = 'service'
           and tl.booking_id is null
           -- An INSTALMENT rides as kind='service' with a null booking (it is
           -- money against a plan, not a treatment), so without this the till
           -- offers a payment for scheduling. plan_id is the discriminator;
           -- a real service line never carries one. Mirrors the same rule in
           -- $lib/components/pos/schedule-lines.ts.
           and tl.plan_id is null
           and t.status <> 'void'
           and (t.party_id is not null or t.crm_contact_id is not null)
         group by 1
      ), keys as (
        select k from l union select k from g union select k from p union select k from s
      )
      select keys.k as client_key,
             coalesce(l.party_id, g.party_id, p.party_id, s.party_id) as party_id,
             coalesce(l.crm_contact_id, g.crm_contact_id, p.crm_contact_id, s.crm_contact_id) as crm_contact_id,
             coalesce(l.balance, 0) as balance,
             coalesce(g.active_grants, 0) as active_grants,
             coalesce(p.open_plans, 0) as open_plans,
             coalesce(p.plan_total, 0) as plan_total,
             coalesce(s.pending_scheduling, 0) as pending_scheduling,
             s.pending_ticket_id as pending_ticket_id,
             -- Without a name the /pos/accounts list is a column of uuids; the
             -- CRM facet wins because that is the name the front desk uses.
             coalesce(cc.display_name, pt.name) as display_name
        from keys
        left join l on l.k = keys.k
        left join g on g.k = keys.k
        left join p on p.k = keys.k
        left join s on s.k = keys.k
        left join crm_contacts cc
          on cc.org_id = ${ctx.tenantId}
         and cc.id = coalesce(l.crm_contact_id, g.crm_contact_id, p.crm_contact_id, s.crm_contact_id)::uuid
        left join parties pt
          on pt.org_id = ${ctx.tenantId}
         and pt.id = coalesce(l.party_id, g.party_id, p.party_id, s.party_id)::uuid
       where keys.k is not null
       order by coalesce(s.pending_scheduling, 0) desc, coalesce(l.balance, 0) desc, keys.k
       limit ${limit}`),
  )) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    clientKey: String(r.client_key),
    partyId: r.party_id == null ? null : String(r.party_id),
    crmContactId: r.crm_contact_id == null ? null : String(r.crm_contact_id),
    balance: round2(Number(r.balance ?? 0)),
    activeGrants: Number(r.active_grants ?? 0),
    openPlans: Number(r.open_plans ?? 0),
    openPlanTotal: round2(Number(r.plan_total ?? 0)),
    displayName: r.display_name == null ? null : String(r.display_name),
    pendingScheduling: Number(r.pending_scheduling ?? 0),
    pendingTicketId: r.pending_ticket_id == null ? null : String(r.pending_ticket_id),
  }));
}

/**
 * Resolve ONE client key that the account list has no row for.
 *
 * `listClientAccounts` lists MOVEMENTS, not parties: a client with no credit, no
 * grant, no open plan and nothing pending simply is not in it. The customer
 * card's `?client=party:<id>` deep link therefore used to land on the plain list
 * with an anonymous, empty drawer (§32.2). This resolves the key straight off
 * the party spine / CRM contact instead, so the link always opens THAT client's
 * account — with zeroed counters, which is the truth for them.
 *
 * Returns null when the key names nothing in this org, so a forged id opens
 * nothing (no existence leak).
 *
 * ponytail: the counters are zeros, not a re-aggregation — callers use this only
 * when the list had no row. A client who has rows but fell outside the list's
 * limit gets zeros here too; the drawer's own detail read is the authority for
 * every number it shows.
 */
export async function resolveClientAccount(
  ctx: CoreCtx,
  clientKey: string,
): Promise<ClientAccountSummary | null> {
  const client = parseClientKey(clientKey);
  const found = await withOrgCore(ctx, async (tx) => {
    if (client.crmContactId) {
      const [row] = await tx
        .select({ id: crmContacts.id, name: crmContacts.displayName, partyId: crmContacts.partyId })
        .from(crmContacts)
        .where(and(eq(crmContacts.orgId, ctx.tenantId), eq(crmContacts.id, client.crmContactId)))
        .limit(1);
      return row
        ? { partyId: row.partyId ?? null, crmContactId: row.id, displayName: row.name ?? null }
        : null;
    }
    const [row] = await tx
      .select({ id: parties.id, name: parties.name })
      .from(parties)
      .where(and(eq(parties.orgId, ctx.tenantId), eq(parties.id, client.partyId!)))
      .limit(1);
    return row ? { partyId: row.id, crmContactId: null, displayName: row.name ?? null } : null;
  });
  if (!found) return null;
  return {
    // The requested key, NOT clientKeyOf(found): the caller matched the URL on
    // it, and re-deriving would flip `party:` to `contact:` for a linked party.
    clientKey,
    partyId: found.partyId,
    crmContactId: found.crmContactId,
    displayName: found.displayName,
    balance: 0,
    activeGrants: 0,
    openPlans: 0,
    openPlanTotal: 0,
    pendingScheduling: 0,
    pendingTicketId: null,
  };
}

// ---- ledger ----

/**
 * Current stored-value balance. Summed in JS through the pure helper rather
 * than in SQL so the one balance rule lives in one tested place; a client's
 * ledger is tens of rows, not millions.
 */
export async function creditBalance(ctx: CoreCtx, client: ClientRef): Promise<number> {
  const rows = await withOrgCore(ctx, async (tx) => {
    const ref = await widenClient(tx, ctx.tenantId, client);
    return tx
      .select({ amount: posClientLedger.amount })
      .from(posClientLedger)
      .where(and(eq(posClientLedger.orgId, ctx.tenantId), clientMatch(ref, posClientLedger)));
  });
  return ledgerBalance(rows);
}

export function listLedger(
  ctx: CoreCtx,
  client: ClientRef,
  opts: { limit?: number } = {},
): Promise<PosClientLedgerRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const ref = await widenClient(tx, ctx.tenantId, client);
    return tx
      .select()
      .from(posClientLedger)
      .where(and(eq(posClientLedger.orgId, ctx.tenantId), clientMatch(ref, posClientLedger)))
      .orderBy(desc(posClientLedger.createdAt))
      .limit(opts.limit ?? 200);
  });
}

/**
 * Append one ledger row inside a caller's transaction — the form `submitTicket`
 * / `voidTicket` need (S2), where the row must commit with the money that
 * caused it. `currency` is required here: the caller already holds settings.
 */
export async function addLedgerEntryInTx(
  tx: CoreTx,
  orgId: string,
  input: LedgerEntryInput & { currency: string },
): Promise<PosClientLedgerRow> {
  requireClient(input.client);
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount === 0)
    throw new PosError('ledger amount must be a non-zero number', 'invalid_amount');
  const [row] = await tx
    .insert(posClientLedger)
    .values({
      orgId,
      partyId: input.client.partyId ?? null,
      crmContactId: input.client.crmContactId ?? null,
      kind: input.kind,
      amount: String(amount),
      currency: input.currency,
      ticketId: input.ticketId ?? null,
      planId: input.planId ?? null,
      bookingId: input.bookingId ?? null,
      note: input.note ?? null,
      createdBy: input.actor?.id ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();
  return row;
}

/** Standalone append (a manual top-up, a refund to credit). */
export async function addLedgerEntry(
  ctx: CoreCtx,
  input: LedgerEntryInput,
): Promise<PosClientLedgerRow> {
  const currency = input.currency ?? (await getPosSettings(ctx)).currency;
  return withOrgCore(ctx, (tx) => addLedgerEntryInTx(tx, ctx.tenantId, { ...input, currency }));
}

// ---- payment plans ----

export async function createPlan(ctx: CoreCtx, input: PlanInput): Promise<PosPaymentPlan> {
  requireClient(input.client);
  if (!input.title?.trim()) throw new PosError('plan needs a title', 'invalid_title');
  const total = round2(input.totalAmount);
  if (!(total > 0)) throw new PosError('plan total must be > 0', 'invalid_amount');
  if (input.dueSchedule) {
    for (const d of input.dueSchedule) {
      if (!(d.amount > 0)) throw new PosError('due amount must be > 0', 'invalid_due_schedule');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dueOn))
        throw new PosError('dueOn must be YYYY-MM-DD', 'invalid_due_schedule');
    }
  }
  const currency = input.currency ?? (await getPosSettings(ctx)).currency;
  const [row] = await withOrgCore(ctx, async (tx) => {
    const [plan] = await tx
      .insert(posPaymentPlans)
      .values({
        orgId: ctx.tenantId,
        partyId: input.client.partyId ?? null,
        crmContactId: input.client.crmContactId ?? null,
        title: input.title.trim(),
        totalAmount: String(total),
        currency,
        status: 'open',
        productId: input.productId ?? null,
        bookingId: input.bookingId ?? null,
        dueSchedule: input.dueSchedule ?? null,
        note: input.note ?? null,
        createdBy: input.actor?.id ?? null,
      })
      .returning();

    // The link is TWO columns and they must agree: `pos_payment_plans.booking_id`
    // is how the plan finds its treatment, `sched_bookings.payment_plan_id` is
    // what `getBookingDetail` reads to render "paying in instalments". Writing
    // only the first left every booking looking unfunded in the drawer. Same
    // transaction, so a plan can never exist half-linked.
    //
    // Org-scoped and `is null`-guarded: a foreign booking id is simply not
    // updated (never someone else's row), and a booking already funded by
    // another plan keeps its first plan rather than being silently re-pointed.
    if (plan.bookingId) {
      const linked = await tx
        .update(schedBookings)
        .set({ paymentPlanId: plan.id, updatedAt: new Date() })
        .where(
          and(
            eq(schedBookings.orgId, ctx.tenantId),
            eq(schedBookings.id, plan.bookingId),
            isNull(schedBookings.paymentPlanId),
          ),
        )
        .returning({ id: schedBookings.id });
      if (!linked.length) {
        const [exists] = await tx
          .select({ paymentPlanId: schedBookings.paymentPlanId })
          .from(schedBookings)
          .where(and(eq(schedBookings.orgId, ctx.tenantId), eq(schedBookings.id, plan.bookingId)))
          .limit(1);
        // Rolls the plan insert back with it — both throws leave no orphan.
        if (!exists) throw new PosError('booking not found', 'not_found');
        throw new PosError('booking already has a payment plan', 'booking_already_planned');
      }
    }
    return [plan];
  });
  return row;
}

export function listPlans(
  ctx: CoreCtx,
  opts: {
    client?: ClientRef;
    status?: PlanStatus;
    bookingId?: string;
    limit?: number;
  } = {},
): Promise<PosPaymentPlan[]> {
  return withOrgCore(ctx, async (tx) => {
    const conds = [eq(posPaymentPlans.orgId, ctx.tenantId)];
    if (opts.client)
      conds.push(clientMatch(await widenClient(tx, ctx.tenantId, opts.client), posPaymentPlans));
    if (opts.status) conds.push(eq(posPaymentPlans.status, opts.status));
    if (opts.bookingId) conds.push(eq(posPaymentPlans.bookingId, opts.bookingId));
    return tx
      .select()
      .from(posPaymentPlans)
      .where(and(...conds))
      .orderBy(desc(posPaymentPlans.createdAt))
      .limit(opts.limit ?? 100);
  });
}

/**
 * Paid-to-date: the plan's ticket lines, excluding lines on voided tickets.
 * Derived on every read — that is the whole point (spec §2.2).
 */
async function paidLinesInTx(
  tx: CoreTx,
  orgId: string,
  planId: string,
): Promise<{ total: string | null }[]> {
  return tx
    .select({ total: posTicketLines.total })
    .from(posTicketLines)
    .innerJoin(posTickets, eq(posTickets.id, posTicketLines.ticketId))
    .where(
      and(
        eq(posTicketLines.orgId, orgId),
        eq(posTicketLines.planId, planId),
        ne(posTickets.status, 'void'),
      ),
    );
}

export async function getPlan(ctx: CoreCtx, id: string): Promise<PlanDetail | null> {
  return withOrgCore(ctx, async (tx) => {
    const [plan] = await tx
      .select()
      .from(posPaymentPlans)
      .where(and(eq(posPaymentPlans.id, id), eq(posPaymentPlans.orgId, ctx.tenantId)))
      .limit(1);
    if (!plan) return null;
    const lines = await paidLinesInTx(tx, ctx.tenantId, id);
    return planDetail(plan, lines);
  });
}

export async function cancelPlan(ctx: CoreCtx, id: string, actor?: Actor): Promise<PosPaymentPlan> {
  const [row] = await withOrgCore(ctx, async (tx) => {
    const [plan] = await tx
      .select()
      .from(posPaymentPlans)
      .where(and(eq(posPaymentPlans.id, id), eq(posPaymentPlans.orgId, ctx.tenantId)))
      .limit(1);
    if (!plan) throw new PosError('plan not found', 'not_found');
    if (plan.status === 'settled') throw new PosError('plan is settled', 'plan_settled');
    if (plan.status === 'cancelled') return [plan];
    // TODO(handoff): cancelling a plan leaves its already-paid instalment lines
    // untouched — no credit is written back to pos_client_ledger, because the
    // refund policy (credit vs void the tickets) is not decided. The money is
    // still fully traceable through the lines carrying plan_id. See meta
    // proposals/2026-09-13-pos-packages-plans-s1-followups.md.
    return tx
      .update(posPaymentPlans)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: actor?.id ?? null })
      .where(and(eq(posPaymentPlans.id, id), eq(posPaymentPlans.orgId, ctx.tenantId)))
      .returning();
  });
  return row;
}

/**
 * Flip an open plan to `settled` once its lines cover the total. Idempotent and
 * safe to call after every instalment — the `status = 'open'` predicate in the
 * UPDATE means two concurrent instalment tickets can never both settle it.
 */
export async function settlePlanIfPaid(ctx: CoreCtx, id: string): Promise<PlanDetail> {
  return withOrgCore(ctx, async (tx) => {
    const [plan] = await tx
      .select()
      .from(posPaymentPlans)
      .where(and(eq(posPaymentPlans.id, id), eq(posPaymentPlans.orgId, ctx.tenantId)))
      .limit(1);
    if (!plan) throw new PosError('plan not found', 'not_found');
    const lines = await paidLinesInTx(tx, ctx.tenantId, id);
    const detail = planDetail(plan, lines);
    if (plan.status !== 'open' || !detail.isPaid) return detail;
    const [settled] = await tx
      .update(posPaymentPlans)
      .set({ status: 'settled', settledAt: new Date() })
      .where(
        and(
          eq(posPaymentPlans.id, id),
          eq(posPaymentPlans.orgId, ctx.tenantId),
          eq(posPaymentPlans.status, 'open'),
          isNull(posPaymentPlans.settledAt),
        ),
      )
      .returning();
    return { ...detail, plan: settled ?? plan };
  });
}
