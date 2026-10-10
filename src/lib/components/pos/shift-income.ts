import { decimalToMinor, minorToNumber } from '$lib/money/decimal';

/** Pure grouping rules for the shift banner's income menu. Kept out of the
 * component so the ordering/labelling is testable without mounting it. */

/** A payment row as `/api/pos/shifts/current?payments=1` serializes it. */
export interface ShiftPaymentRow {
  id: string;
  ticketId: string;
  humanId: string | null;
  customerName: string | null;
  method: string;
  amount: number;
  paidAt: string;
}

/** The slice of a configured payment method this module needs. */
export interface MethodLike {
  id: string;
  label: string;
}

export interface MethodIncome {
  id: string;
  label: string;
  total: number;
}

/**
 * One row per method that actually took money this shift, in the register's own
 * method order. A method id that is no longer configured (renamed, removed)
 * still gets a row labelled by its raw id — money never disappears from the
 * breakdown because settings changed mid-shift.
 */
export function methodIncome(
  byMethod: Record<string, number>,
  methods: readonly MethodLike[],
): MethodIncome[] {
  const seen = new Set<string>();
  const rows: MethodIncome[] = [];
  for (const method of methods) {
    const total = byMethod[method.id];
    if (total === undefined) continue;
    seen.add(method.id);
    rows.push({ id: method.id, label: method.label, total });
  }
  for (const [id, total] of Object.entries(byMethod)) {
    if (seen.has(id)) continue;
    rows.push({ id, label: id, total });
  }
  return rows;
}

/** Σ of the per-method totals, summed in integer minor units so the header
 * figure is exactly the rows the menu shows. */
export function incomeTotal(byMethod: Record<string, number>): number {
  let minor = 0n;
  for (const amount of Object.values(byMethod)) minor += decimalToMinor(amount);
  return minorToNumber(minor);
}

/** This method's payments. The server already orders them newest first. */
export function paymentsOfMethod(
  payments: readonly ShiftPaymentRow[],
  methodId: string,
): ShiftPaymentRow[] {
  return payments.filter((payment) => payment.method === methodId);
}
