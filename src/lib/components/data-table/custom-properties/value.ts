import type {
  CustomPropertyBundle,
  CustomPropertyDefinition,
  CustomPropertyValue,
} from '$lib/tables/custom-properties';

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
): string {
  if (value === null) return '';
  if (definition.type === 'boolean') return value === true ? booleanLabels.yes : booleanLabels.no;
  if (definition.type === 'date' && typeof value === 'string') {
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
  if (definition.rules.type !== 'select' && definition.rules.type !== 'multi_select') return new Set();
  const selected = new Set(Array.isArray(value) ? value : typeof value === 'string' ? [value] : []);
  return new Set(
    definition.rules.options
      .filter((option) => option.archivedAt && selected.has(option.id))
      .map((option) => option.id),
  );
}
