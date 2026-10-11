import { appointmentOverdueRule } from './appointment-overdue';
import { visitUnpaidRule } from './visit-unpaid';
import { shiftOpenAfterHoursRule } from './shift-open-after-hours';
import type { Rule } from './types';

export type { Rule, RuleResult } from './types';

/** Slice 4 appends its rules here — same shape, same registration. */
export const INBOX_RULES: Rule[] = [appointmentOverdueRule, visitUnpaidRule, shiftOpenAfterHoursRule];
