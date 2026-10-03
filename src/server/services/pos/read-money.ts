import type {
  PosTicket,
  PosTicketLine,
  PosPayment,
  PosClientLedgerRow,
  PosPaymentPlan,
  PosPaymentPlanRow,
} from '$server/db/pg-pos-schema';
import {
  requirePosCurrency,
  storedDecimalNumber,
  storedMinorNumber,
  storedMoneyMinor,
} from './money';

/** Preserve existing decimal-string DTOs, but reject values consumers cannot safely represent. */
export function checkedTicket<
  T extends Pick<PosTicket, 'currency' | 'subtotal' | 'discount' | 'total'>,
>(ticket: T): T {
  const currency = requirePosCurrency(ticket.currency);
  for (const value of [ticket.subtotal, ticket.discount, ticket.total])
    storedMinorNumber(storedMoneyMinor(value));
  return { ...ticket, currency };
}

export function checkedTicketLine<
  T extends Pick<PosTicketLine, 'unitPrice' | 'discount' | 'total'>,
>(line: T): T {
  storedDecimalNumber(line.unitPrice);
  for (const value of [line.discount, line.total]) storedMinorNumber(storedMoneyMinor(value));
  return line;
}

export function checkedPayment<T extends Pick<PosPayment, 'amount' | 'tendered'>>(payment: T): T {
  storedMinorNumber(storedMoneyMinor(payment.amount));
  if (payment.tendered !== null) storedMinorNumber(storedMoneyMinor(payment.tendered));
  return payment;
}

export function checkedLedger<T extends Pick<PosClientLedgerRow, 'currency' | 'amount'>>(
  row: T,
): T {
  const currency = requirePosCurrency(row.currency);
  storedMinorNumber(storedMoneyMinor(row.amount, true));
  return { ...row, currency };
}

export function checkedPlan(plan: PosPaymentPlan): PosPaymentPlan {
  const currency = requirePosCurrency(plan.currency);
  storedMinorNumber(storedMoneyMinor(plan.totalAmount, true));
  const {
    operationId: _operationId,
    operationHash: _operationHash,
    ...publicPlan
  } = plan as PosPaymentPlan & Partial<PosPaymentPlanRow>;
  return { ...publicPlan, currency };
}
