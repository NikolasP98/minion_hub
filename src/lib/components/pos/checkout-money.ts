import {
  DecimalInputError,
  allocateMinorUnits,
  decimalToMinor,
  decimalToMinorExact,
  decimalToNumber,
  minorToNumber,
  type DecimalInput,
} from '$lib/money/decimal';
import { TicketMoneyError, lineMoneyMinor, type TicketMoneyCode } from '$lib/money/ticket';

/** Pure money rules shared by the POS client. Drafts stay as text until a
 * checked numeric wire boundary; invalid text is never replaced with zero. */

export type MoneyDraft = DecimalInput;
export type CheckoutMoneyCode = TicketMoneyCode | 'invalid_tender' | 'invalid_count';

export type DraftResult<T, C extends string = CheckoutMoneyCode> =
  { ok: true; value: T } | { ok: false; code: C };

export class CheckoutMoneyDraftError extends Error {
  constructor(readonly code: CheckoutMoneyCode) {
    super(code);
    this.name = 'CheckoutMoneyDraftError';
  }
}

export interface ParsedMoney {
  minor: bigint;
  number: number;
}

const NUMERIC_12_2_MAX_MINOR = 999_999_999_999n;

function invalid<C extends string>(code: C): DraftResult<never, C> {
  return { ok: false, code };
}

/** Parse a UI draft without losing its original text. `exact` is used for
 * agreed cent values (discounts, payments); ordinary prices/principals are
 * quantized once after their exact decimal spelling passes the Number wire
 * round-trip check. */
export function moneyDraft(
  input: MoneyDraft,
  options: {
    exact?: boolean;
    positive?: boolean;
    nonnegative?: boolean;
    numeric12?: boolean;
    code?: CheckoutMoneyCode;
  } = {},
): DraftResult<ParsedMoney> {
  const code = options.code ?? 'invalid_amount';
  try {
    // The existing JSON contract is numeric. Reject a decimal that Number
    // would silently change before quantizing it at the declared boundary.
    decimalToNumber(input);
    const minor = options.exact ? decimalToMinorExact(input) : decimalToMinor(input);
    if (options.positive && minor <= 0n) return invalid(code);
    if (options.nonnegative && minor < 0n) return invalid(code);
    if (options.numeric12 && (minor < -NUMERIC_12_2_MAX_MINOR || minor > NUMERIC_12_2_MAX_MINOR)) {
      return invalid(code);
    }
    return { ok: true, value: { minor, number: minorToNumber(minor) } };
  } catch (error) {
    if (error instanceof DecimalInputError) return invalid(code);
    throw error;
  }
}

export interface CheckoutLineDraft {
  qty: MoneyDraft;
  unitPrice: MoneyDraft | null;
  discount: MoneyDraft;
  redemptionId?: string | null;
}

export type CheckoutLineState = DraftResult<{
  qty: number;
  unitPrice: number;
  discount: number;
  grossMinor: bigint;
  discountMinor: bigint;
  totalMinor: bigint;
  total: number;
}>;

/** The browser preview uses the same exact-product-once rule as persistence. */
export function checkoutLineState(line: CheckoutLineDraft): CheckoutLineState {
  const unitPrice = line.unitPrice;
  if (unitPrice == null) return invalid('invalid_amount');
  try {
    const money = lineMoneyMinor({ ...line, unitPrice });
    return {
      ok: true,
      value: {
        qty: decimalToNumber(line.qty),
        unitPrice: decimalToNumber(unitPrice),
        discount: minorToNumber(money.discount),
        grossMinor: money.gross,
        discountMinor: money.discount,
        totalMinor: money.total,
        total: minorToNumber(money.total),
      },
    };
  } catch (error) {
    if (error instanceof TicketMoneyError) return invalid(error.code);
    if (error instanceof DecimalInputError) return invalid('invalid_amount');
    throw error;
  }
}

export function cartMoneyState(lines: readonly CheckoutLineDraft[]): DraftResult<{
  lines: Array<Extract<CheckoutLineState, { ok: true }>['value']>;
  totalMinor: bigint;
  total: number;
}> & { index?: number } {
  const normalized: Array<Extract<CheckoutLineState, { ok: true }>['value']> = [];
  let totalMinor = 0n;
  for (let index = 0; index < lines.length; index++) {
    const line = checkoutLineState(lines[index]);
    if (!line.ok) return { ...line, index };
    normalized.push(line.value);
    totalMinor += line.value.totalMinor;
  }
  try {
    return { ok: true, value: { lines: normalized, totalMinor, total: minorToNumber(totalMinor) } };
  } catch (error) {
    if (error instanceof DecimalInputError) return invalid('invalid_amount');
    throw error;
  }
}

/** One row of a plan's `dueSchedule` — the wire shape `POST /api/pos/plans` takes. */
export interface PlanInstalment {
  dueOn: string;
  amount: number;
}

/** Split a positive numeric(12,2) principal without losing a residual cent. */
export function planDueSchedule(
  total: MoneyDraft,
  count: number,
  from: Date = new Date(),
): PlanInstalment[] {
  if (!Number.isInteger(count) || count < 1 || count > 365) {
    throw new CheckoutMoneyDraftError('invalid_count');
  }
  const parsed = moneyDraft(total, { positive: true, numeric12: true });
  if (!parsed.ok) throw new CheckoutMoneyDraftError(parsed.code);
  const parts = allocateMinorUnits(parsed.value.minor, count);
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = from.getFullYear();
  const month = from.getMonth();
  const day = from.getDate();
  const out: PlanInstalment[] = [];
  for (let index = 0; index < count; index++) {
    const minor = parts[index];
    if (minor <= 0n) continue;
    const targetYear = year + Math.floor((month + index) / 12);
    const targetMonth = (month + index) % 12;
    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    out.push({
      dueOn: `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDay))}`,
      amount: minorToNumber(minor),
    });
  }
  return out;
}

/** A schedule issue removes nextDue authority, but it does not erase a real
 * positive remaining principal: manual collection may still use that balance. */
export function instalmentPrefillAmount(plan: {
  remaining: MoneyDraft;
  nextDue: { amount: MoneyDraft } | null;
  scheduleIssue?: 'invalid_rows' | 'principal_mismatch' | 'too_many_rows' | null;
}): number | null {
  const remaining = moneyDraft(plan.remaining, { exact: true, positive: true });
  if (!remaining.ok) return null;
  if (plan.scheduleIssue || !plan.nextDue) return remaining.value.number;
  const next = moneyDraft(plan.nextDue.amount, { exact: true, positive: true });
  if (!next.ok) return null;
  return minorToNumber(
    next.value.minor < remaining.value.minor ? next.value.minor : remaining.value.minor,
  );
}

/** The tender shape these rules need; raw strings deliberately remain valid
 * structural values until the checked draft state below. */
export interface TenderLike {
  amount: MoneyDraft;
  tendered?: MoneyDraft | null;
  takesTendered: boolean;
}

export type PaymentRowsState = DraftResult<{
  rows: Array<{ amount: number; tendered: number | null }>;
  paidMinor: bigint;
  paid: number;
  changeMinor: bigint;
  change: number;
}> & { index?: number };

export type RemainingMoneyState = DraftResult<ParsedMoney, 'invalid_amount'>;

/** Keep the subtraction in integer minor units, then prove the legacy Number
 * display/wire projection is still exact. Two individually representable
 * values can have a difference that is not. */
export function remainingMoneyState(totalMinor: bigint, paidMinor: bigint): RemainingMoneyState {
  const minor = totalMinor - paidMinor;
  try {
    return { ok: true, value: { minor, number: minorToNumber(minor) } };
  } catch (error) {
    if (error instanceof DecimalInputError) return invalid('invalid_amount');
    throw error;
  }
}

export function paymentRowsState(rows: readonly TenderLike[]): PaymentRowsState {
  const normalized: Array<{ amount: number; tendered: number | null }> = [];
  let paidMinor = 0n;
  let changeMinor = 0n;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const amount = moneyDraft(row.amount, { exact: true, positive: true });
    if (!amount.ok) return { ...amount, index };
    let tendered: ParsedMoney | null = null;
    if (row.takesTendered) {
      if (row.tendered == null) return { ok: false, code: 'invalid_tender', index };
      const parsed = moneyDraft(row.tendered, {
        exact: true,
        nonnegative: true,
        code: 'invalid_tender',
      });
      if (!parsed.ok || parsed.value.minor < amount.value.minor) {
        return { ok: false, code: 'invalid_tender', index };
      }
      tendered = parsed.value;
      changeMinor += tendered.minor - amount.value.minor;
    }
    paidMinor += amount.value.minor;
    normalized.push({ amount: amount.value.number, tendered: tendered?.number ?? null });
  }
  try {
    return {
      ok: true,
      value: {
        rows: normalized,
        paidMinor,
        paid: minorToNumber(paidMinor),
        changeMinor,
        change: minorToNumber(changeMinor),
      },
    };
  } catch (error) {
    if (error instanceof DecimalInputError) return invalid('invalid_amount');
    throw error;
  }
}

/** Compatibility helpers used by tests and display components. Invalid drafts
 * return null rather than a plausible zero. */
export function rowChange(row: TenderLike): number | null {
  const state = paymentRowsState([row]);
  return state.ok ? state.value.change : null;
}

export function changeDue(rows: readonly TenderLike[]): number | null {
  const state = paymentRowsState(rows);
  return state.ok ? state.value.change : null;
}

export function tenderedCents(rows: readonly TenderLike[]): number {
  const state = paymentRowsState(rows);
  if (!state.ok) throw new CheckoutMoneyDraftError(state.code);
  return Number(state.value.paidMinor);
}

/** Re-fit valid tenders after the cart total changes. Invalid raw drafts are
 * retained untouched for correction and continue to block submission. */
export function fitTendersToTotal<T extends TenderLike>(
  rows: readonly T[],
  targetMinor: bigint | number,
): readonly T[] {
  const state = paymentRowsState(rows);
  if (!state.ok) return rows;
  if (typeof targetMinor === 'number' && !Number.isSafeInteger(targetMinor)) return rows;
  const target = typeof targetMinor === 'bigint' ? targetMinor : BigInt(targetMinor);
  if (target < 0n) return rows;
  const floor = target > 0n ? target : 0n;
  let excess = state.value.paidMinor - floor;
  if (excess <= 0n) return rows;

  const kept: T[] = [];
  try {
    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index];
      const normalized = state.value.rows[index];
      const amountMinor = decimalToMinorExact(normalized.amount);
      if (excess <= 0n) {
        kept.unshift(row);
        continue;
      }
      if (excess >= amountMinor) {
        excess -= amountMinor;
        continue;
      }
      const nextMinor = amountMinor - excess;
      excess = 0n;
      const originalTendered = normalized.tendered;
      const originalTenderedMinor =
        originalTendered == null ? null : decimalToMinorExact(originalTendered);
      kept.unshift({
        ...row,
        amount: minorToNumber(nextMinor),
        tendered:
          originalTenderedMinor == null || originalTenderedMinor > amountMinor
            ? row.tendered
            : minorToNumber(originalTenderedMinor < nextMinor ? originalTenderedMinor : nextMinor),
      });
    }
  } catch (error) {
    // A valid aggregate may not have an exact Number representation after a
    // split. Retain the cashier's draft so the ordinary over-tender guard can
    // explain and block it instead of crashing the route.
    if (error instanceof DecimalInputError) return rows;
    throw error;
  }
  return kept;
}
