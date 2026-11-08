/**
 * Value display presets (spec 049 I2) on top of the hub's ONE formatter
 * module (`$lib/utils/format`): money always carries its currency symbol,
 * numbers and percents use the app locale, dates go through `formatDate`.
 * `percent` expects a ratio (0.12 → 12 %).
 */
import {
  formatDate,
  formatMoney,
  formatMoneyShort,
  formatNumber,
  formatPercent,
} from '$lib/utils/format';
import type { Format } from './schema';

export const DEFAULT_CURRENCY = 'PEN';

export function toNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

export function formatValue(
  value: unknown,
  format: Format = 'number',
  currency = DEFAULT_CURRENCY,
): string {
  const n = toNumber(value);
  if (n === null) return '—';
  switch (format) {
    case 'money':
      return formatMoney(n, currency);
    case 'compact':
      return formatNumber(n, { compact: true });
    case 'percent':
      return formatPercent(n);
    case 'number':
    default:
      return formatNumber(n);
  }
}

/** Dense variant for chart axes and sparkline captions: "S/ 1.2M", "3.4K". */
export function formatAxis(value: unknown, format: Format = 'number', currency = DEFAULT_CURRENCY) {
  const n = toNumber(value);
  if (n === null) return '';
  if (format === 'money') return formatMoneyShort(n, currency);
  if (format === 'percent') return formatPercent(n);
  return formatNumber(n, { compact: true });
}

/** Relative change as a signed percent string; `null` when the base is 0 or unknown. */
export function formatDelta(current: unknown, previous: unknown): string | null {
  const now = toNumber(current);
  const before = toNumber(previous);
  if (now === null || before === null || before === 0) return null;
  return formatPercent((now - before) / Math.abs(before), { signed: true });
}

/** Bucket label for a time axis: day/week → "8 nov", month → "nov 2026". */
export function bucketLabel(value: unknown, unit: 'day' | 'week' | 'month'): string {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value ?? '');
  return formatDate(
    d,
    unit === 'month' ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' },
  );
}
