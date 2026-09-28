import type { ColumnNumberFormat, ColumnPresentation } from './column-presentation';
import type { FormulaScalarType } from './formula';
import { formatMoney } from '$lib/utils/format';

export function formatPresentedNumber(
  value: number,
  format: ColumnNumberFormat,
  output: FormulaScalarType,
  locale: string,
  runtimeCurrency: string | null = null,
): string | null {
  if (!Number.isFinite(value) || output.kind !== 'number') return null;
  if (
    format.decimals !== null &&
    (!Number.isInteger(format.decimals) || format.decimals < 0 || format.decimals > 6)
  )
    return null;
  const style = format.style === 'auto' ? output.dimension : format.style;
  const fraction =
    format.decimals == null
      ? style === 'currency' || style === 'money'
        ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        : { maximumFractionDigits: style === 'percent' ? 4 : 12 }
      : { minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals };
  if (style === 'currency' || style === 'money') {
    const currency = runtimeCurrency ?? output.currency;
    if (!currency) return null;
    return formatMoney(value, currency, {
      decimals: format.decimals ?? 2,
      currencyDisplay: format.currencyDisplay,
    });
  }
  if (style === 'percent') {
    const ratio =
      format.style === 'auto' ? value / 100 : format.percentScale === 'ratio' ? value : value / 100;
    return new Intl.NumberFormat(locale, { style: 'percent', ...fraction }).format(ratio);
  }
  return new Intl.NumberFormat(locale, fraction).format(value);
}

export function presentedTone(
  value: unknown,
  quality: string | null | undefined,
  presentation: ColumnPresentation | null,
): 'positive' | 'negative' | null {
  if (presentation?.tone !== 'sign' || quality !== 'valid' || typeof value !== 'number')
    return null;
  return value < 0 ? 'negative' : 'positive';
}
