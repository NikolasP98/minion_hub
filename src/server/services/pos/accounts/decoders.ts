import { PosError } from '../errors';
import { requirePosCurrency, storedMoneyMinor, storedMinorNumber } from '../money';
import type { CurrencyBalance, CurrencyPlanBucket } from './types';

export function parseBalanceBuckets(value: unknown): CurrencyBalance[] {
  if (!Array.isArray(value))
    throw new PosError('Stored currency data is invalid.', 'invalid_stored_amount');
  return value.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      currency: requirePosCurrency(row.currency),
      balance: storedMinorNumber(storedMoneyMinor(row.balance)),
    };
  });
}

export function parsePlanBuckets(value: unknown): CurrencyPlanBucket[] {
  if (!Array.isArray(value))
    throw new PosError('Stored plan currency data is invalid.', 'invalid_stored_amount');
  return value.map((raw) => {
    const row = raw as Record<string, unknown>;
    const count = Number(row.count);
    if (!Number.isSafeInteger(count) || count < 0)
      throw new PosError('Stored plan count is invalid.', 'invalid_stored_amount');
    return {
      currency: requirePosCurrency(row.currency),
      count,
      total: storedMinorNumber(storedMoneyMinor(row.total)),
    };
  });
}

export function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PosError(`Stored ${label} data is invalid.`, 'invalid_stored_amount');
  return value as Record<string, unknown>;
}

export function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value))
    throw new PosError(`Stored ${label} data is invalid.`, 'invalid_stored_amount');
  return value;
}

export function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value)
    throw new PosError(`Stored ${label} data is invalid.`, 'invalid_stored_amount');
  return value;
}

export function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

export function dateValue(value: unknown, label: string): Date {
  const date = new Date(stringValue(value, label));
  if (!Number.isFinite(date.getTime()))
    throw new PosError(`Stored ${label} date is invalid.`, 'invalid_stored_amount');
  return date;
}

export function nullableDate(value: unknown, label: string): Date | null {
  return value == null ? null : dateValue(value, label);
}
