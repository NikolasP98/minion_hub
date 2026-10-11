import type {
  CustomPropertyBundle,
  CustomPropertyDateFormat,
  CustomPropertyDateRules,
  CustomPropertyDefinition,
  CustomPropertyValue,
} from '$lib/tables/custom-properties';
import { customPropertyDateDay, dateRuleOptions } from '$lib/tables/custom-properties';
import { primaryFormulaVariable } from '$lib/tables/formula';

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function utcMidnight(day: string): Date {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, dayOfMonth);
  return date;
}

function relativeDay(day: string, locale: string | undefined, now: Date): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const days = Math.round(
    (Date.UTC(year, month - 1, dayOfMonth) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86_400_000,
  );
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(days);
  if (abs < 7) return rtf.format(days, 'day');
  if (abs < 28) return rtf.format(Math.round(days / 7), 'week');
  if (abs < 365) return rtf.format(Math.round(days / 30), 'month');
  return rtf.format(Math.round(days / 365), 'year');
}

function formatDay(
  day: string,
  at: Date,
  format: CustomPropertyDateFormat,
  locale: string | undefined,
  timeZone: 'UTC' | undefined,
  now: Date,
): string {
  const [year, month, dayOfMonth] = day.split('-');
  switch (format) {
    case 'relative':
      return relativeDay(day, locale, now);
    case 'mdy':
      return `${month}/${dayOfMonth}/${year}`;
    case 'dmy':
      return `${dayOfMonth}/${month}/${year}`;
    case 'ymd':
      return `${year}/${month}/${dayOfMonth}`;
    case 'short':
      return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone }).format(at);
    case 'full': {
      const parts = new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone,
      }).formatToParts(at);
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((entry) => entry.type === type)?.value ?? '';
      return `${part('day')} ${part('month')} ${part('year')}`;
    }
  }
}

/**
 * A stored date value under its column's chosen formats. A date-only value is
 * rendered in UTC so no viewer ever sees the previous day; an instant is a point
 * in time, so BOTH its day and its clock read in the viewer's own zone.
 */
export function formatCustomPropertyDate(
  value: CustomPropertyValue,
  rules: CustomPropertyDateRules,
  locale?: string,
  now: Date = new Date(),
): string {
  const day = customPropertyDateDay(value);
  if (day === null) return '';
  const { dateFormat, timeFormat } = dateRuleOptions(rules);
  const instant = day === value ? null : new Date(value as string);
  const at = instant ?? utcMidnight(day);
  const datePart = formatDay(
    instant ? localDay(instant) : day,
    at,
    dateFormat,
    locale,
    instant ? undefined : 'UTC',
    now,
  );
  if (timeFormat === 'hidden' || !instant) return datePart;
  return `${datePart} ${new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  }).format(instant)}`;
}

/** Stored value → the text an `<input type="date">` / `"datetime-local"` expects. */
export function customPropertyDateInput(value: CustomPropertyValue, includeTime: boolean): string {
  const day = customPropertyDateDay(value);
  if (day === null) return '';
  if (!includeTime) return day;
  if (value === day) return `${day}T00:00`;
  const d = new Date(value as string);
  return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** That input's text back to the stored value: a bare day, or a UTC instant. */
export function customPropertyDateValue(raw: string, includeTime: boolean): string | null {
  if (!raw) return null;
  if (!includeTime || raw.length === 10) return raw.slice(0, 10);
  const d = new Date(raw); // zone-less `datetime-local` text parses as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isCustomPropertyRecordAvailable(
  bundle: CustomPropertyBundle,
  recordId: string,
): boolean {
  return Object.hasOwn(bundle.recordAccess, recordId) && Object.hasOwn(bundle.values, recordId);
}

export function customPropertyDisplay(
  definition: CustomPropertyDefinition,
  value: CustomPropertyValue,
  locale?: string,
  booleanLabels: { yes: string; no: string } = { yes: 'Yes', no: 'No' },
  formulaCurrency?: string | null,
): string {
  if (value === null) return '';
  const primary =
    definition.rules.type === 'formula'
      ? primaryFormulaVariable(definition.rules, definition.id)
      : null;
  const displayType = primary ? primary.outputType.kind : definition.type;
  if (displayType === 'boolean') return value === true ? booleanLabels.yes : booleanLabels.no;
  if (displayType === 'number' && typeof value === 'number') {
    const output = primary?.outputType ?? null;
    const currency = formulaCurrency ?? (output?.kind === 'number' ? output.currency : null);
    if (output?.kind === 'number' && output.dimension === 'money' && currency) {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
      }).format(value);
    }
    if (output?.kind === 'number' && output.dimension === 'percent') {
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: 4,
      }).format(value / 100);
    }
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 12 }).format(value);
  }
  if (displayType === 'date' && typeof value === 'string')
    return formatCustomPropertyDate(
      value,
      definition.rules.type === 'date' ? definition.rules : { type: 'date', min: null, max: null },
      locale,
    );
  if (definition.rules.type === 'select' || definition.rules.type === 'multi_select') {
    const ids = Array.isArray(value) ? value : [value];
    const labels = new Map(definition.rules.options.map((option) => [option.id, option.label]));
    return ids.map((id) => labels.get(String(id)) ?? String(id)).join(', ');
  }
  return String(value);
}

export function customPropertySortValue(
  definition: CustomPropertyDefinition,
  value: CustomPropertyValue,
): string | number | boolean | null {
  if (value === null) return null;
  if (definition.type === 'multi_select') return customPropertyDisplay(definition, value);
  return Array.isArray(value) ? value.join(', ') : value;
}

export function retainedArchivedOptions(
  definition: CustomPropertyDefinition,
  value: CustomPropertyValue,
): ReadonlySet<string> {
  if (definition.rules.type !== 'select' && definition.rules.type !== 'multi_select')
    return new Set();
  const selected = new Set(Array.isArray(value) ? value : typeof value === 'string' ? [value] : []);
  return new Set(
    definition.rules.options
      .filter((option) => option.archivedAt && selected.has(option.id))
      .map((option) => option.id),
  );
}
