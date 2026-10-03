import {
  DecimalInputError,
  decimalToMinor,
  decimalToMinorExact,
  decimalToNumber,
  minorToNumber,
  type DecimalInput,
} from '$lib/money/decimal';
import { PosError } from './errors';

/** Only the actual numeric(12,2) columns use this bound; aggregates do not. */
export const NUMERIC_12_2_MAX_MINOR = 999_999_999_999n;

export function withMoneyError<T>(code: string, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (!(error instanceof DecimalInputError)) throw error;
    throw new PosError(
      code === 'invalid_stored_amount'
        ? 'Stored monetary data is invalid or cannot be represented safely.'
        : 'The monetary value is invalid or outside the supported range.',
      code,
    );
  }
}

export interface MoneyOptions {
  code?: string;
  exact?: boolean;
  numeric12?: boolean;
}

export function moneyMinor(input: unknown, options: MoneyOptions = {}): bigint {
  return withMoneyError(options.code ?? 'invalid_amount', () => {
    // The core validates runtime types too; null never becomes a monetary zero.
    const minor = (options.exact ? decimalToMinorExact : decimalToMinor)(input as DecimalInput);
    if (options.numeric12 && (minor > NUMERIC_12_2_MAX_MINOR || minor < -NUMERIC_12_2_MAX_MINOR)) {
      throw new DecimalInputError('decimal_limit');
    }
    return minor;
  });
}

export function moneyNumber(input: unknown, options: MoneyOptions = {}): number {
  return withMoneyError(options.code ?? 'invalid_amount', () =>
    minorToNumber(moneyMinor(input, options)),
  );
}

/** Catalog unit prices remain unrounded until quantity × price is quantized. */
export function storedDecimalNumber(input: unknown): number {
  return withMoneyError('invalid_stored_amount', () => decimalToNumber(input as DecimalInput));
}

export function storedMoneyMinor(input: unknown, numeric12 = false): bigint {
  return moneyMinor(input, { code: 'invalid_stored_amount', exact: true, numeric12 });
}

export function storedMinorNumber(minor: bigint): number {
  return withMoneyError('invalid_stored_amount', () => minorToNumber(minor));
}

let supportedCurrencies: readonly string[] | undefined;

/** Server-authoritative list, returned with settings; browser ICU is not authority. */
export function supportedPosCurrencies(): readonly string[] {
  supportedCurrencies ??= Object.freeze(
    Intl.supportedValuesOf('currency')
      .filter((currency) => {
        const policy = new Intl.NumberFormat('en', {
          style: 'currency',
          currency,
        }).resolvedOptions();
        return policy.minimumFractionDigits === 2 && policy.maximumFractionDigits === 2;
      })
      .sort(),
  );
  return supportedCurrencies;
}

export function requirePosCurrency(input: unknown): string {
  const currency = typeof input === 'string' ? input.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency) || !supportedPosCurrencies().includes(currency)) {
    throw new PosError(
      'POS currently supports currencies with two minor units.',
      'unsupported_pos_currency',
    );
  }
  return currency;
}

/** Settings stay readable so an operator can correct an unsupported legacy currency. */
export function currencyReadPolicy(currency: string): {
  currency: string;
  currencyIssue: 'unsupported_pos_currency' | null;
  supportedCurrencies: readonly string[];
} {
  let currencyIssue: 'unsupported_pos_currency' | null = null;
  try {
    currency = requirePosCurrency(currency);
  } catch (error) {
    if (!(error instanceof PosError) || error.code !== 'unsupported_pos_currency') throw error;
    currencyIssue = 'unsupported_pos_currency';
  }
  return { currency, currencyIssue, supportedCurrencies: supportedPosCurrencies() };
}
