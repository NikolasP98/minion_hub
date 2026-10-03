import { and, desc, eq, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
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
import { schedBookings } from '$server/db/pg-scheduling-schema';
import { getPosSettingsInTx } from './pos/settings';
import type { Actor } from './pos/actor';
import { admitPlanOperation } from './pos/plan-operation';
import { PosError } from './pos/errors';
import { checkedLedger, checkedPlan } from './pos/read-money';
import { minorToDecimal } from '$lib/money/decimal';
import {
  moneyMinor,
  moneyNumber,
  requirePosCurrency,
  storedMoneyMinor,
  storedMinorNumber,
} from './pos/money';
import { readDueSchedule, validateDueSchedule, type ScheduleIssue } from './pos-accounts.logic';
import {
  lockCanonicalWallet,
  canonicalWalletClientKey,
  resolveWalletIdentity,
  walletOwnedPredicate,
  type CanonicalWalletIdentity,
} from './pos/wallet-identity';
import { clientKeyOf, requireClient, type ClientRef } from './pos/accounts/identity-key';
import { planDetail, type PlanDetail } from './pos/accounts/plan-detail';
import type { CurrencyBalance } from './pos/accounts/types';
export { clientKeyOf, parseClientKey, type ClientRef } from './pos/accounts/identity-key';
export { type PlanDetail } from './pos/accounts/plan-detail';
export {
  type ClientAccountDetail,
  type ClientAccountSummary,
  type CurrencyBalance,
  type CurrencyPlanBucket,
  type WalletIdentityStatus,
} from './pos/accounts/types';
export { listClientAccounts } from './pos/accounts/list';
export { resolveClientAccount } from './pos/accounts/resolve';
export { getClientAccountDetail } from './pos/accounts/detail';

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
  operationId?: string;
  /** Version-2 canonical identity frozen before durable operation admission. */
  clientKey?: string;
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

// ---- ledger ----

/** Current stored-value balances grouped by currency in the locked SQL projection. */
async function balancesInTx(
  tx: CoreTx,
  orgId: string,
  identity: CanonicalWalletIdentity,
): Promise<CurrencyBalance[]> {
  const rows = await tx
    .select({
      currency: posClientLedger.currency,
      balance: sql<string>`sum(${posClientLedger.amount})`,
    })
    .from(posClientLedger)
    .where(
      and(eq(posClientLedger.orgId, orgId), walletOwnedPredicate(orgId, identity, posClientLedger)),
    )
    .groupBy(posClientLedger.currency)
    .orderBy(posClientLedger.currency);
  return rows.map((row) => ({
    currency: requirePosCurrency(row.currency),
    balance: storedMinorNumber(storedMoneyMinor(row.balance)),
  }));
}

export async function creditBalances(ctx: CoreCtx, client: ClientRef): Promise<CurrencyBalance[]> {
  return withOrgCore(ctx, async (tx) => {
    const settings = await getPosSettingsInTx(tx, ctx.tenantId);
    const identity = await resolveWalletIdentity(tx, ctx.tenantId, client);
    const balances = await balancesInTx(tx, ctx.tenantId, identity);
    // The settings read is intentional: it serializes the compatibility currency.
    requirePosCurrency(settings.currency);
    return balances;
  });
}

export async function creditBalance(ctx: CoreCtx, client: ClientRef): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const settings = await getPosSettingsInTx(tx, ctx.tenantId);
    const identity = await resolveWalletIdentity(tx, ctx.tenantId, client);
    const balances = await balancesInTx(tx, ctx.tenantId, identity);
    return balances.find((row) => row.currency === settings.currency)?.balance ?? 0;
  });
}

export function listLedger(
  ctx: CoreCtx,
  client: ClientRef,
  opts: { limit?: number } = {},
): Promise<PosClientLedgerRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const identity = await resolveWalletIdentity(tx, ctx.tenantId, client);
    const rows = await tx
      .select()
      .from(posClientLedger)
      .where(
        and(
          eq(posClientLedger.orgId, ctx.tenantId),
          walletOwnedPredicate(ctx.tenantId, identity, posClientLedger),
        ),
      )
      .orderBy(desc(posClientLedger.createdAt))
      .limit(opts.limit ?? 200);
    return rows.map(checkedLedger);
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
  options: {
    identity?: CanonicalWalletIdentity;
    walletAlreadyLocked?: boolean;
    preservePersistedIdentity?: boolean;
  } = {},
): Promise<PosClientLedgerRow> {
  requireClient(input.client);
  const amount = moneyMinor(input.amount, { numeric12: true });
  const currency = requirePosCurrency(input.currency);
  if (amount === 0n)
    throw new PosError('ledger amount must be a non-zero number', 'invalid_amount');
  const identity = options.preservePersistedIdentity
    ? {
        partyId: input.client.partyId ?? null,
        crmContactId: input.client.crmContactId ?? null,
        clientKey: clientKeyOf(input.client),
        identityStatus: 'active' as const,
      }
    : (options.identity ?? (await resolveWalletIdentity(tx, orgId, input.client)));
  if (!options.walletAlreadyLocked) await lockCanonicalWallet(tx, orgId, identity, currency);
  const [row] = await tx
    .insert(posClientLedger)
    .values({
      orgId,
      partyId: identity.partyId,
      crmContactId: identity.crmContactId,
      kind: input.kind,
      amount: minorToDecimal(amount),
      currency,
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
  return withOrgCore(ctx, async (tx) => {
    const currency = input.currency ?? (await getPosSettingsInTx(tx, ctx.tenantId)).currency;
    return addLedgerEntryInTx(tx, ctx.tenantId, { ...input, currency });
  });
}

// ---- payment plans ----

export async function createPlan(ctx: CoreCtx, input: PlanInput): Promise<PosPaymentPlan> {
  requireClient(input.client);
  if (!input.title?.trim()) throw new PosError('plan needs a title', 'invalid_title');
  const total = moneyNumber(input.totalAmount, { numeric12: true });
  if (!(total > 0)) throw new PosError('plan total must be > 0', 'invalid_amount');
  const dueSchedule = validateDueSchedule(input.dueSchedule, total);
  const [row] = await withOrgCore(ctx, async (tx) => {
    const operation = await admitPlanOperation(tx, ctx, input, { total, dueSchedule });
    if (operation?.existing) return [operation.existing];
    const settings = await getPosSettingsInTx(tx, ctx.tenantId);
    const identity = await resolveWalletIdentity(tx, ctx.tenantId, input.client);
    if (operation && canonicalWalletClientKey(input.clientKey) !== identity.clientKey)
      throw new PosError('Wallet identity changed.', 'wallet_identity_changed');
    const currency = requirePosCurrency(input.currency ?? settings.currency);
    await lockCanonicalWallet(tx, ctx.tenantId, identity, currency);
    const [plan] = await tx
      .insert(posPaymentPlans)
      .values({
        orgId: ctx.tenantId,
        partyId: identity.partyId,
        crmContactId: identity.crmContactId,
        title: input.title.trim(),
        totalAmount: minorToDecimal(moneyMinor(total)),
        currency,
        status: 'open',
        productId: input.productId ?? null,
        bookingId: input.bookingId ?? null,
        dueSchedule,
        note: input.note ?? null,
        createdBy: operation?.actorId ?? input.actor?.id ?? null,
        operationId: operation?.operationId ?? null,
        operationHash: operation?.operationHash ?? null,
        operationVersion: operation ? 2 : 1,
        operationClientKey: operation ? identity.clientKey : null,
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
  return checkedPlan(row);
}

export function listPlans(
  ctx: CoreCtx,
  opts: {
    client?: ClientRef;
    status?: PlanStatus;
    bookingId?: string;
    limit?: number;
  } = {},
): Promise<(PosPaymentPlan & { scheduleIssue: ScheduleIssue | null })[]> {
  return withOrgCore(ctx, async (tx) => {
    const conds = [eq(posPaymentPlans.orgId, ctx.tenantId)];
    if (opts.client) {
      const identity = await resolveWalletIdentity(tx, ctx.tenantId, opts.client);
      conds.push(walletOwnedPredicate(ctx.tenantId, identity, posPaymentPlans));
    }
    if (opts.status) conds.push(eq(posPaymentPlans.status, opts.status));
    if (opts.bookingId) conds.push(eq(posPaymentPlans.bookingId, opts.bookingId));
    const plans = await tx
      .select()
      .from(posPaymentPlans)
      .where(and(...conds))
      .orderBy(desc(posPaymentPlans.createdAt))
      .limit(opts.limit ?? 100);
    return plans.map((row) => {
      const plan = checkedPlan(row);
      const { scheduleIssue } = readDueSchedule(plan.dueSchedule, plan.totalAmount);
      return { ...plan, scheduleIssue };
    });
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
  const rows = await tx
    .select({ total: posTicketLines.total, currency: posTickets.currency })
    .from(posTicketLines)
    .innerJoin(
      posTickets,
      and(eq(posTickets.id, posTicketLines.ticketId), eq(posTickets.orgId, orgId)),
    )
    .where(
      and(
        eq(posTicketLines.orgId, orgId),
        eq(posTicketLines.planId, planId),
        notInArray(sql<string>`${posTickets.status}`, ['void', 'voided']),
      ),
    );
  return rows.map(({ total, currency }) => {
    requirePosCurrency(currency);
    return { total };
  });
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
    checkedPlan(plan);
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
  return checkedPlan(row);
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
    return { ...detail, plan: checkedPlan(settled ?? plan) };
  });
}

/** A paid service line that still owes an appointment (same rule as
 *  `isPendingScheduling` + the `/pos/accounts` CTE, but PER LINE and including
 *  walk-ins — the calendar tray lists what to drag in, not whom to bill). */
export interface PendingSchedulingLine {
  lineId: string;
  ticketId: string;
  ticketHumanId: string | null;
  submittedAt: Date;
  description: string;
  finProductId: string | null;
  qty: string;
  partyId: string | null;
  crmContactId: string | null;
  customerName: string | null;
}

export async function listPendingSchedulingLines(
  ctx: CoreCtx,
  opts: { limit?: number } = {},
): Promise<PendingSchedulingLine[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select({
        lineId: posTicketLines.id,
        ticketId: posTickets.id,
        ticketHumanId: posTickets.humanId,
        submittedAt: posTickets.submittedAt,
        description: posTicketLines.description,
        finProductId: posTicketLines.finProductId,
        qty: posTicketLines.qty,
        partyId: posTickets.partyId,
        crmContactId: posTickets.crmContactId,
        customerName: posTickets.customerName,
      })
      .from(posTicketLines)
      .innerJoin(
        posTickets,
        and(eq(posTickets.id, posTicketLines.ticketId), eq(posTickets.orgId, posTicketLines.orgId)),
      )
      .where(
        and(
          eq(posTicketLines.orgId, ctx.tenantId),
          eq(posTicketLines.kind, 'service'),
          isNull(posTicketLines.bookingId),
          isNull(posTicketLines.planId), // an instalment is money, not a treatment
          notInArray(sql<string>`${posTickets.status}`, ['void', 'voided']),
        ),
      )
      .orderBy(desc(posTickets.submittedAt))
      .limit(opts.limit ?? 200),
  );
}

/** Count of `listPendingSchedulingLines` rows — the side-menu badge. */
export async function countPendingSchedulingLines(ctx: CoreCtx): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(posTicketLines)
      .innerJoin(
        posTickets,
        and(eq(posTickets.id, posTicketLines.ticketId), eq(posTickets.orgId, posTicketLines.orgId)),
      )
      .where(
        and(
          eq(posTicketLines.orgId, ctx.tenantId),
          eq(posTicketLines.kind, 'service'),
          isNull(posTicketLines.bookingId),
          isNull(posTicketLines.planId),
          notInArray(sql<string>`${posTickets.status}`, ['void', 'voided']),
        ),
      );
    return row?.n ?? 0;
  });
}

/** One paid service line of a client — the treatment history a checkup follows. */
export interface PaidServiceRow {
  lineId: string;
  ticketId: string;
  ticketHumanId: string | null;
  submittedAt: Date;
  description: string;
  finProductId: string | null;
  total: string;
  bookingId: string | null;
  bookingStart: Date | null;
}

export async function listPartyPaidServices(
  ctx: CoreCtx,
  client: { partyId?: string | null; crmContactId?: string | null },
  opts: { limit?: number } = {},
): Promise<PaidServiceRow[]> {
  const who: SQL[] = [];
  if (client.partyId) who.push(eq(posTickets.partyId, client.partyId));
  if (client.crmContactId) who.push(eq(posTickets.crmContactId, client.crmContactId));
  if (who.length === 0) return [];
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        lineId: posTicketLines.id,
        ticketId: posTickets.id,
        ticketHumanId: posTickets.humanId,
        submittedAt: posTickets.submittedAt,
        description: posTicketLines.description,
        finProductId: posTicketLines.finProductId,
        total: posTicketLines.total,
        currency: posTickets.currency,
        bookingId: posTicketLines.bookingId,
        bookingStart: schedBookings.startTime,
      })
      .from(posTicketLines)
      .innerJoin(
        posTickets,
        and(eq(posTickets.id, posTicketLines.ticketId), eq(posTickets.orgId, posTicketLines.orgId)),
      )
      .leftJoin(schedBookings, eq(schedBookings.id, posTicketLines.bookingId))
      .where(
        and(
          eq(posTicketLines.orgId, ctx.tenantId),
          eq(posTicketLines.kind, 'service'),
          isNull(posTicketLines.planId),
          notInArray(sql<string>`${posTickets.status}`, ['void', 'voided']),
          or(...who),
        ),
      )
      .orderBy(desc(posTickets.submittedAt))
      .limit(opts.limit ?? 100),
  );
  return rows.map(({ currency, ...row }) => {
    requirePosCurrency(currency);
    storedMinorNumber(storedMoneyMinor(row.total));
    return row;
  });
}

/** A submitted ticket placed on the calendar at its sale instant, with its
 *  service lines (and the appointments they are linked to). */
export interface CalendarTicket {
  id: string;
  humanId: string | null;
  submittedAt: Date;
  total: string;
  currency: string;
  customerName: string | null;
  lines: { id: string; description: string; bookingId: string | null }[];
}

export async function listTicketsForCalendar(
  ctx: CoreCtx,
  window: { from: Date; to: Date },
): Promise<CalendarTicket[]> {
  return withOrgCore(ctx, async (tx) => {
    const tickets = await tx
      .select({
        id: posTickets.id,
        humanId: posTickets.humanId,
        submittedAt: posTickets.submittedAt,
        total: posTickets.total,
        currency: posTickets.currency,
        customerName: posTickets.customerName,
      })
      .from(posTickets)
      .where(
        and(
          eq(posTickets.orgId, ctx.tenantId),
          notInArray(sql<string>`${posTickets.status}`, ['void', 'voided']),
          sql`${posTickets.submittedAt} >= ${window.from.toISOString()}::timestamptz`,
          sql`${posTickets.submittedAt} <= ${window.to.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(desc(posTickets.submittedAt))
      .limit(2000);
    if (tickets.length === 0) return [];
    for (const ticket of tickets) {
      requirePosCurrency(ticket.currency);
      storedMinorNumber(storedMoneyMinor(ticket.total));
    }
    const lines = await tx
      .select({
        id: posTicketLines.id,
        ticketId: posTicketLines.ticketId,
        description: posTicketLines.description,
        bookingId: posTicketLines.bookingId,
      })
      .from(posTicketLines)
      .where(
        and(
          eq(posTicketLines.orgId, ctx.tenantId),
          eq(posTicketLines.kind, 'service'),
          isNull(posTicketLines.planId),
          sql`${posTicketLines.ticketId} in ${tickets.map((t) => t.id)}`,
        ),
      );
    const byTicket = new Map<string, CalendarTicket['lines']>();
    for (const l of lines) {
      const arr = byTicket.get(l.ticketId) ?? [];
      arr.push({ id: l.id, description: l.description, bookingId: l.bookingId });
      byTicket.set(l.ticketId, arr);
    }
    return tickets.map((t) => ({
      ...t,
      currency: requirePosCurrency(t.currency),
      lines: byTicket.get(t.id) ?? [],
    }));
  });
}
