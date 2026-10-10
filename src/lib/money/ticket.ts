import {
  DecimalInputError,
  decimalToMinor,
  decimalToMinorExact,
  decimalToNumber,
  minorToNumber,
  multiplyDecimalToMinor,
  type DecimalInput,
} from './decimal';

export type TicketMoneyCode = 'invalid_qty' | 'invalid_amount' | 'invalid_discount';
export class TicketMoneyError extends Error {
  constructor(public readonly code: TicketMoneyCode) {
    super(`Invalid ticket money: ${code}`);
    this.name = 'TicketMoneyError';
  }
}

function checked<T>(code: TicketMoneyCode, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof DecimalInputError) throw new TicketMoneyError(code);
    throw error;
  }
}

export interface TicketMoneyLine {
  qty: DecimalInput;
  unitPrice: DecimalInput;
  discount?: DecimalInput | null;
}

/** Shared preview/persistence rule: quantize the exact gross, then subtract cent-exact discount. */
export function lineMoneyMinor(line: TicketMoneyLine): {
  gross: bigint;
  discount: bigint;
  total: bigint;
} {
  const qty = checked('invalid_qty', () => decimalToNumber(line.qty));
  if (!(qty > 0)) throw new TicketMoneyError('invalid_qty');
  const price = checked('invalid_amount', () => decimalToNumber(line.unitPrice));
  // A zero price is a valid value: a free/complimentary catalog item and a
  // package-redeemed session both ring up at 0. Only a negative one is money
  // running backwards.
  if (price < 0) throw new TicketMoneyError('invalid_amount');
  const gross = checked('invalid_amount', () => {
    const minor = multiplyDecimalToMinor(line.qty, line.unitPrice);
    minorToNumber(minor);
    return minor;
  });
  const discount = checked('invalid_discount', () => decimalToMinorExact(line.discount ?? 0));
  if (discount < 0n || discount > gross) throw new TicketMoneyError('invalid_discount');
  return { gross, discount, total: gross - discount };
}

export function computeTicketMoney(
  lines: readonly TicketMoneyLine[],
  discount: DecimalInput = 0,
): {
  lineTotals: number[];
  subtotal: number;
  discount: number;
  total: number;
} {
  if (lines.length > 10000) throw new TicketMoneyError('invalid_amount');
  const amounts = lines.map((line) => lineMoneyMinor(line).total);
  const subtotal = amounts.reduce((sum, amount) => sum + amount, 0n);
  const orderDiscount = checked('invalid_discount', () => {
    if (decimalToNumber(discount) < 0) throw new TicketMoneyError('invalid_discount');
    return decimalToMinor(discount);
  });
  if (orderDiscount > subtotal) throw new TicketMoneyError('invalid_discount');
  return checked('invalid_amount', () => ({
    lineTotals: amounts.map((amount) => minorToNumber(amount)),
    subtotal: minorToNumber(subtotal),
    discount: minorToNumber(orderDiscount),
    total: minorToNumber(subtotal - orderDiscount),
  }));
}
