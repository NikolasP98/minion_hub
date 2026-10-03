import type { PosPaymentPlan } from '$server/db/pg-pos-schema';
import {
  nextDueInstalment,
  planProgress,
  readDueSchedule,
  type ScheduleIssue,
  type DueInstalment,
} from '../../pos-accounts.logic';
import { checkedPlan } from '../read-money';

export interface PlanDetail {
  plan: PosPaymentPlan;
  /** Sum of this plan's ticket lines over non-void tickets. */
  paidToDate: number;
  remaining: number;
  isPaid: boolean;
  nextDue: DueInstalment | null;
  scheduleIssue: ScheduleIssue | null;
}

/** Assemble one public plan projection from its authoritative paid-line sum. */
export function planDetail(
  plan: PosPaymentPlan,
  paidLines: { total: string | number | null }[],
): PlanDetail {
  plan = checkedPlan(plan);
  const progress = planProgress(plan.totalAmount, paidLines);
  const { scheduleIssue } = readDueSchedule(plan.dueSchedule, plan.totalAmount);
  return {
    plan,
    ...progress,
    scheduleIssue,
    nextDue: nextDueInstalment(plan.dueSchedule, progress.paidToDate, plan.totalAmount),
  };
}
