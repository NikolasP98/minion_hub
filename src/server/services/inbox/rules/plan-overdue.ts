import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { posPaymentPlans, posTicketLines, posTickets } from '$server/db/pg-pos-schema';
import { appNotifications } from '$server/db/pg-inbox-schema';
import { nextDueInstalment } from '$server/services/pos-accounts.logic';
import { resolveOrgTimezone } from '$server/services/inbox/daily-feed.service';
import { zonedDateKey } from '$server/scheduling/tz';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Rule, RuleResult } from './types';

/** Pure boundary check: the plan's next unpaid instalment (from
 *  `nextDueInstalment`) is overdue once its `dueOn` is strictly before
 *  `today` — a row due today is not yet late. Exported for the unit test. */
export function isPlanOverdue(
  dueSchedule: unknown,
  paidToDate: string | number,
  totalAmount: string | number,
  today: string,
): boolean {
  const next = nextDueInstalment(dueSchedule, paidToDate, totalAmount);
  return next != null && next.dueOn < today;
}

// shortcut: see appointment-overdue.ts — fixed Spanish strings, no per-viewer locale.
function title(): string {
  return 'Cuota vencida';
}
function body(title_: string): string {
  return `Plan "${title_}" tiene una cuota vencida`;
}

/** Sum of non-void ticket lines carrying this plan's id — paid-to-date,
 *  derived rather than stored (same convention as `visit-unpaid.ts`'s
 *  `isFundedNow`). Shared by the upsert scan and the resolve re-check. */
async function paidToDate(tx: CoreTx, planId: string): Promise<string> {
  const [row] = await tx
    .select({ sum: sql<string>`coalesce(sum(${posTicketLines.total}), 0)` })
    .from(posTicketLines)
    .innerJoin(posTickets, eq(posTickets.id, posTicketLines.ticketId))
    .where(
      and(
        eq(posTicketLines.planId, planId),
        notInArray(sql<string>`${posTickets.status}`, ['void', 'voided']),
      ),
    );
  return row?.sum ?? '0';
}

export const planOverdueRule: Rule = {
  key: 'plan.overdue',
  async evaluate(ctx: CoreCtx, now: Date): Promise<RuleResult> {
    const tz = await resolveOrgTimezone(ctx);
    const today = zonedDateKey(now, tz);

    return withOrgCore(ctx, async (tx) => {
      const plans = await tx
        .select({
          id: posPaymentPlans.id,
          title: posPaymentPlans.title,
          totalAmount: posPaymentPlans.totalAmount,
          dueSchedule: posPaymentPlans.dueSchedule,
        })
        .from(posPaymentPlans)
        .where(and(eq(posPaymentPlans.orgId, ctx.tenantId), eq(posPaymentPlans.status, 'open')));

      const upserts: RuleResult['upserts'] = [];
      for (const p of plans) {
        const paid = await paidToDate(tx, p.id);
        if (!isPlanOverdue(p.dueSchedule, paid, p.totalAmount, today)) continue;
        upserts.push({
          scope: 'role',
          orgId: ctx.tenantId,
          capability: 'pos:manage',
          kind: 'plan.overdue',
          severity: 'warning',
          title: title(),
          body: body(p.title),
          href: `/pos/accounts?plan=${p.id}`,
          subjectType: 'pos_payment_plan',
          subjectId: p.id,
          dedupeKey: `plan-overdue:${ctx.tenantId}:${p.id}`,
        });
      }

      // Resolve: a previously-fired plan resolves once it's settled/cancelled
      // or the overdue instalment is caught up.
      const existing = await tx
        .select({ dedupeKey: appNotifications.dedupeKey, subjectId: appNotifications.subjectId })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, 'plan.overdue'),
            eq(appNotifications.orgId, ctx.tenantId),
            isNull(appNotifications.resolvedAt),
          ),
        );
      if (existing.length === 0) return { upserts, resolve: [] };

      const planIds = [...new Set(existing.map((r) => r.subjectId).filter(Boolean))] as string[];
      const rows = await tx
        .select({
          id: posPaymentPlans.id,
          status: posPaymentPlans.status,
          totalAmount: posPaymentPlans.totalAmount,
          dueSchedule: posPaymentPlans.dueSchedule,
        })
        .from(posPaymentPlans)
        .where(inArray(posPaymentPlans.id, planIds));
      const byId = new Map(rows.map((r) => [r.id, r]));

      const resolve: string[] = [];
      for (const r of existing) {
        if (!r.dedupeKey) continue;
        const plan = r.subjectId ? byId.get(r.subjectId) : undefined;
        if (!plan || plan.status !== 'open') {
          resolve.push(r.dedupeKey);
          continue;
        }
        const paid = await paidToDate(tx, plan.id);
        if (!isPlanOverdue(plan.dueSchedule, paid, plan.totalAmount, today))
          resolve.push(r.dedupeKey);
      }
      return { upserts, resolve };
    });
  },
};
