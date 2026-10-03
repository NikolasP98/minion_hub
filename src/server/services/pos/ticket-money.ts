import { minorToNumber } from '$lib/money/decimal';
import { computeTicketMoney, TicketMoneyError } from '$lib/money/ticket';
import { PosError } from './errors';
import { moneyMinor, moneyNumber, requirePosCurrency, withMoneyError } from './money';
import type { PosSettings, SubmitTicketInput, TicketLineInput } from '../pos.service';

export function computeTicketTotals(lines: TicketLineInput[], discount?: number) {
  try {
    return computeTicketMoney(lines, discount);
  } catch (error) {
    if (error instanceof TicketMoneyError) throw new PosError(error.message, error.code);
    throw error;
  }
}

/** The assistant preview and persisted sale share every money admission rule. */
export function validateTicketMoney(
  input: Pick<SubmitTicketInput, 'lines' | 'payments' | 'discount'>,
  settings: PosSettings,
) {
  if (!input.lines.length) throw new PosError('ticket needs lines', 'no_lines');
  requirePosCurrency(settings.currency);
  const totals = computeTicketTotals(input.lines, input.discount);
  if (input.payments.length > 10000)
    throw new PosError('Too many payment amounts.', 'invalid_amount');
  const payments = input.payments.map((payment) => {
    const amount = moneyNumber(payment.amount);
    if (payment.amount < 0) throw new PosError('payment amount must be >= 0', 'invalid_amount');
    const tendered =
      payment.tendered == null ? null : moneyNumber(payment.tendered, { code: 'invalid_tender' });
    if (payment.tendered != null && payment.tendered < 0)
      throw new PosError('invalid cash tender', 'invalid_tender');
    const method = settings.methods.find((candidate) => candidate.id === payment.method);
    if (!method) throw new PosError('Unknown payment method.', 'invalid_method');
    if (!method.enabled) throw new PosError('Payment method is disabled.', 'invalid_method');
    if (method.requiresCreditDecision || method.drawsOnCredit === null)
      throw new PosError(
        'Payment method needs an explicit stored-value decision.',
        'credit_method_decision_required',
      );
    if (!method.takesTendered && tendered !== null)
      throw new PosError('tendered is cash-only', 'invalid_tender');
    if (method.takesTendered && tendered !== null && moneyMinor(tendered) < moneyMinor(amount)) {
      throw new PosError('tendered below amount', 'invalid_tender');
    }
    return { ...payment, amount, tendered };
  });
  const paid = payments.reduce((sum, payment) => sum + moneyMinor(payment.amount), 0n);
  if (paid !== moneyMinor(totals.total))
    throw new PosError('payments must equal the ticket total', 'payment_mismatch');
  const creditPaid = withMoneyError('invalid_amount', () =>
    minorToNumber(
      payments
        .filter(
          (payment) =>
            settings.methods.find((method) => method.id === payment.method)?.drawsOnCredit === true,
        )
        .reduce((sum, payment) => sum + moneyMinor(payment.amount), 0n),
    ),
  );
  return { ...totals, payments, creditPaid };
}
