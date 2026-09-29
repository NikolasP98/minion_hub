import type {
  CustomPropertyBundle,
  CustomPropertyDefinition,
  CustomPropertyValue,
} from '$lib/tables/custom-properties';
import { primaryFormulaVariable } from '$lib/tables/formula';

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
  if (displayType === 'date' && typeof value === 'string') {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('day')} ${part('month')} ${part('year')}`;
  }
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
