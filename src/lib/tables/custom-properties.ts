import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';
import { z } from 'zod';
import {
  FORMULA_LANGUAGE_VERSION,
  type FormulaAst,
  type FormulaCellMetadata,
  type FormulaDraftRules,
  type FormulaRules,
} from './formula';
export { CUSTOM_PROPERTIES_PER_TABLE_MAX } from './custom-property-limits';
import { CUSTOM_PROPERTIES_PER_TABLE_MAX } from './custom-property-limits';

// TODO(handoff): Admit guarded formula/relation types and required-on-create only
// with their execution/admission phases; see proposal 2026-09-26-hub-custom-columns-next-phases.
export const CUSTOM_PROPERTY_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multi_select',
  'formula',
] as const;
export type CustomPropertyType = (typeof CUSTOM_PROPERTY_TYPES)[number];
export const CUSTOM_PROPERTY_TABLE_IDS = [
  'stock.items',
  'stock.entries',
  'pos.catalog',
  'crm.customers',
  'finances.invoices',
  'finances.purchases',
  'socials.campaigns',
  'team.people',
] as const;
export type CustomPropertyTableId = (typeof CUSTOM_PROPERTY_TABLE_IDS)[number];
export const CUSTOM_PROPERTY_LABEL_MAX = 80;
export const CUSTOM_PROPERTY_DESCRIPTION_MAX = 500;
export const CUSTOM_PROPERTY_TEXT_MAX = 10_000;
export const CUSTOM_PROPERTY_OPTIONS_MAX = 100;
export const CUSTOM_PROPERTY_QUERY_RECORDS_MAX = 500;

export type CustomPropertyColor = (typeof CRM_TAG_COLORS)[number];
export interface CustomPropertyOption {
  id: string;
  label: string;
  color: CustomPropertyColor;
  archivedAt: string | null;
}
export type CustomPropertyRules =
  | { type: 'text'; maxLength: number | null }
  | { type: 'number'; min: number | null; max: number | null; precision: number | null }
  | { type: 'date'; min: string | null; max: string | null }
  | { type: 'boolean' }
  | { type: 'select'; options: CustomPropertyOption[] }
  | { type: 'multi_select'; options: CustomPropertyOption[]; maxSelections: number | null }
  | FormulaRules;
export type CustomPropertyInputRules =
  Exclude<CustomPropertyRules, FormulaRules> | FormulaDraftRules;
export type CustomPropertyValue = string | number | boolean | string[] | null;
export interface CustomPropertyDefinition {
  id: string;
  tableId: CustomPropertyTableId;
  label: string;
  description: string | null;
  type: CustomPropertyType;
  rules: CustomPropertyRules;
  hasDefault: boolean;
  defaultValue: CustomPropertyValue;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CustomPropertyValueCell {
  propertyId: string;
  recordId: string;
  present: boolean;
  value: CustomPropertyValue;
  effectiveValue: CustomPropertyValue;
  version: number;
  updatedAt: string | null;
  computed?: true;
  definitionVersion?: number;
  formula?: FormulaCellMetadata;
}
export interface CustomPropertyRecordAccess {
  canEdit: boolean;
}
export interface CustomPropertyBundle {
  definitions: CustomPropertyDefinition[];
  values: Record<string, Record<string, CustomPropertyValueCell>>;
  recordAccess: Record<string, CustomPropertyRecordAccess>;
  canManage: boolean;
  canEdit: boolean;
}
export interface CreateCustomPropertyInput {
  tableId: CustomPropertyTableId;
  label: string;
  description?: string | null;
  rules: CustomPropertyInputRules;
  hasDefault: boolean;
  defaultValue?: CustomPropertyValue;
  catalogRevision?: string;
}
export interface UpdateCustomPropertyInput {
  tableId: CustomPropertyTableId;
  expectedVersion: number;
  label?: string;
  description?: string | null;
  rules?: CustomPropertyInputRules;
  hasDefault?: boolean;
  defaultValue?: CustomPropertyValue;
  catalogRevision?: string;
}
export interface CustomPropertyLifecycleInput {
  tableId: CustomPropertyTableId;
  expectedVersion: number;
  action: 'archive' | 'restore';
}
export interface QueryCustomPropertyValuesInput {
  tableId: CustomPropertyTableId;
  recordIds: string[];
}
export interface PutCustomPropertyValueInput {
  tableId: CustomPropertyTableId;
  propertyId: string;
  recordId: string;
  value: CustomPropertyValue;
  expectedVersion: number;
}

export type CustomPropertyValidationCode =
  | 'invalid_rules'
  | 'invalid_value'
  | 'invalid_date'
  | 'invalid_option'
  | 'archived_option'
  | 'duplicate_option'
  | 'limit_exceeded'
  | 'read_only_property';
export type CustomPropertyValidationResult =
  { ok: true; value: CustomPropertyValue } | { ok: false; code: CustomPropertyValidationCode };

export const customPropertyColumnKey = (id: string) => `custom:${id}`;

const optionSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string(),
    color: z.enum(CRM_TAG_COLORS),
    archivedAt: z.string().datetime().nullable(),
  })
  .strict();
const formulaNumberTypeSchema = z
  .object({
    kind: z.literal('number'),
    dimension: z.enum(['unitless', 'percent', 'money']),
    currency: z.string().nullable(),
    basis: z.string().nullable(),
  })
  .strict();
const formulaScalarTypeSchema = z.discriminatedUnion('kind', [
  formulaNumberTypeSchema,
  z.object({ kind: z.literal('text') }).strict(),
  z.object({ kind: z.literal('boolean') }).strict(),
  z.object({ kind: z.literal('date') }).strict(),
]);
const formulaAstSchema: z.ZodType<FormulaAst> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('literal'),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        valueType: z.enum(['text', 'number', 'boolean', 'null']),
        from: z.number().int(),
        to: z.number().int(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('reference'),
        sourceId: z.string(),
        from: z.number().int(),
        to: z.number().int(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('unary'),
        operator: z.enum(['+', '-', 'NOT']),
        operand: formulaAstSchema,
        from: z.number().int(),
        to: z.number().int(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('binary'),
        operator: z.enum(['+', '-', '*', '/', '=', '<>', '<', '<=', '>', '>=', 'AND', 'OR']),
        left: formulaAstSchema,
        right: formulaAstSchema,
        from: z.number().int(),
        to: z.number().int(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('is_null'),
        operand: formulaAstSchema,
        negated: z.boolean(),
        from: z.number().int(),
        to: z.number().int(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('call'),
        name: z.enum(['ROUND', 'ABS', 'COALESCE', 'NULLIF', 'LEAST', 'GREATEST']),
        arguments: z.array(formulaAstSchema),
        from: z.number().int(),
        to: z.number().int(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('case'),
        branches: z.array(z.object({ when: formulaAstSchema, then: formulaAstSchema }).strict()),
        otherwise: formulaAstSchema,
        from: z.number().int(),
        to: z.number().int(),
      })
      .strict(),
  ]),
);
export const formulaDraftRulesSchema = z
  .object({ type: z.literal('formula'), expression: z.string() })
  .strict();
export const formulaRulesSchema = formulaDraftRulesSchema
  .extend({
    languageVersion: z.literal(FORMULA_LANGUAGE_VERSION),
    ast: formulaAstSchema,
    outputType: formulaScalarTypeSchema.and(z.object({ nullable: z.boolean() })),
    dependencies: z.array(
      z.object({ id: z.string(), source: z.enum(['native', 'custom', 'formula']) }).strict(),
    ),
  })
  .strict();
export const customPropertyRulesSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), maxLength: z.number().int().nullable() }).strict(),
  z
    .object({
      type: z.literal('number'),
      min: z.number().finite().nullable(),
      max: z.number().finite().nullable(),
      precision: z.number().int().nullable(),
    })
    .strict(),
  z
    .object({ type: z.literal('date'), min: z.string().nullable(), max: z.string().nullable() })
    .strict(),
  z.object({ type: z.literal('boolean') }).strict(),
  z.object({ type: z.literal('select'), options: z.array(optionSchema) }).strict(),
  z
    .object({
      type: z.literal('multi_select'),
      options: z.array(optionSchema),
      maxSelections: z.number().int().nullable(),
    })
    .strict(),
  formulaRulesSchema,
]);
export const customPropertyInputRulesSchema = z.union([
  customPropertyRulesSchema,
  formulaDraftRulesSchema,
]);

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function validateCustomPropertyRules(input: unknown): CustomPropertyValidationResult {
  const parsed = customPropertyRulesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_rules' };
  const rules = parsed.data;
  if (
    rules.type === 'text' &&
    rules.maxLength != null &&
    (!Number.isInteger(rules.maxLength) ||
      rules.maxLength < 1 ||
      rules.maxLength > CUSTOM_PROPERTY_TEXT_MAX)
  )
    return { ok: false, code: 'invalid_rules' };
  if (rules.type === 'number') {
    if (
      (rules.min != null && !Number.isFinite(rules.min)) ||
      (rules.max != null && !Number.isFinite(rules.max)) ||
      (rules.min != null && rules.max != null && rules.min > rules.max)
    )
      return { ok: false, code: 'invalid_rules' };
    if (
      rules.precision != null &&
      (!Number.isInteger(rules.precision) || rules.precision < 0 || rules.precision > 12)
    )
      return { ok: false, code: 'invalid_rules' };
  }
  if (
    rules.type === 'date' &&
    ((rules.min != null && !validDateOnly(rules.min)) ||
      (rules.max != null && !validDateOnly(rules.max)) ||
      (rules.min != null && rules.max != null && rules.min > rules.max))
  )
    return { ok: false, code: 'invalid_rules' };
  if (rules.type === 'select' || rules.type === 'multi_select') {
    if (rules.options.length > CUSTOM_PROPERTY_OPTIONS_MAX)
      return { ok: false, code: 'limit_exceeded' };
    const ids = new Set<string>();
    const labels = new Set<string>();
    for (const option of rules.options) {
      const label = option.label.trim();
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          option.id,
        ) ||
        !label ||
        label.length > CUSTOM_PROPERTY_LABEL_MAX ||
        !CRM_TAG_COLORS.includes(option.color)
      )
        return { ok: false, code: 'invalid_rules' };
      const folded = label.toLowerCase();
      if (ids.has(option.id) || (!option.archivedAt && labels.has(folded)))
        return { ok: false, code: 'duplicate_option' };
      ids.add(option.id);
      if (!option.archivedAt) labels.add(folded);
    }
    if (
      rules.type === 'multi_select' &&
      rules.maxSelections != null &&
      (!Number.isInteger(rules.maxSelections) ||
        rules.maxSelections < 1 ||
        rules.maxSelections > CUSTOM_PROPERTY_OPTIONS_MAX)
    )
      return { ok: false, code: 'invalid_rules' };
  }
  return { ok: true, value: null };
}

export function validateCustomPropertyValue(
  rules: CustomPropertyRules,
  value: unknown,
  retainedArchivedOptionIds: ReadonlySet<string> = new Set(),
): CustomPropertyValidationResult {
  if (rules.type === 'formula') return { ok: false, code: 'read_only_property' };
  if (value === null) return { ok: true, value: null };
  if (rules.type === 'text')
    return typeof value === 'string' &&
      value.length <= (rules.maxLength ?? CUSTOM_PROPERTY_TEXT_MAX)
      ? { ok: true, value }
      : { ok: false, code: 'invalid_value' };
  if (rules.type === 'number') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (rules.min != null && value < rules.min) ||
      (rules.max != null && value > rules.max)
    )
      return { ok: false, code: 'invalid_value' };
    if (rules.precision != null) {
      const rendered = value.toString().toLowerCase();
      const [coefficient, exponentRaw] = rendered.split('e');
      const decimals = (coefficient.split('.')[1]?.length ?? 0) - Number(exponentRaw ?? 0);
      if (Math.max(0, decimals) > rules.precision) return { ok: false, code: 'invalid_value' };
    }
    return { ok: true, value };
  }
  if (rules.type === 'date')
    return typeof value === 'string' &&
      validDateOnly(value) &&
      (rules.min == null || value >= rules.min) &&
      (rules.max == null || value <= rules.max)
      ? { ok: true, value }
      : { ok: false, code: 'invalid_date' };
  if (rules.type === 'boolean')
    return typeof value === 'boolean' ? { ok: true, value } : { ok: false, code: 'invalid_value' };
  const values =
    rules.type === 'select'
      ? typeof value === 'string'
        ? [value]
        : null
      : Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? [...new Set(value)]
        : null;
  if (
    !values ||
    (rules.type === 'multi_select' &&
      rules.maxSelections != null &&
      values.length > rules.maxSelections)
  )
    return { ok: false, code: 'invalid_value' };
  const options = new Map(rules.options.map((o) => [o.id, o]));
  for (const id of values) {
    const option = options.get(id);
    if (!option) return { ok: false, code: 'invalid_option' };
    if (option.archivedAt && !retainedArchivedOptionIds.has(id))
      return { ok: false, code: 'archived_option' };
  }
  return { ok: true, value: rules.type === 'select' ? values[0] : values };
}
