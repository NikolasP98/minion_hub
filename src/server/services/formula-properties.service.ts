import { and, eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { CoreCtx } from '$server/auth/core-ctx';
import type {
  CustomPropertyDefinition,
  CustomPropertyValue,
  CustomPropertyValueCell,
} from '$lib/tables/custom-properties';
import {
  analyzeFormula,
  typecheckFormulaAst,
  FORMULA_NUMBER_ABS_MAX,
  FORMULA_LANGUAGE_VERSION,
  type FormulaAnalysis,
  type FormulaCellMetadata,
  type FormulaDependency,
  type FormulaNativeComparison,
  type FormulaPreviewRow,
  type FormulaRules,
  type FormulaScalarType,
  type FormulaSourceDescriptor,
} from '$lib/tables/formula';
import { withOrgCore } from '$server/db/with-org-core';
import { appTableProperties } from '$server/db/pg-schema/custom-properties';
import { shouldMaskSensitive } from './rbac.service';
import { getFinSettings } from './finance.service';
import { listSellables } from './pos.service';
import { costForProducts } from './item-cost.service';
import { compileFormulaSql } from './formula-sql';

export const POS_FORMULA_SOURCE_IDS = {
  salePrice: 'native:pos.catalog:sale-price',
  estimatedUnitCost: 'native:pos.catalog:estimated-unit-cost',
  nativeMargin: 'native:pos.catalog:native-margin',
} as const;

type InputQuality = 'valid' | 'blank' | 'partial' | 'restricted' | 'error';
type FormulaInput = {
  value: CustomPropertyValue;
  quality: InputQuality;
  code: string | null;
  sourceUpdatedAt: string | null;
};
export type FormulaRecordInputs = Record<string, Record<string, FormulaInput>>;

export type FormulaCatalog = {
  fields: FormulaSourceDescriptor[];
  definitions: CustomPropertyDefinition[];
  restrictedDefinitionIds: Set<string>;
  unavailableDefinitionIds: Set<string>;
  canonicalNativeSources: FormulaSourceDescriptor[];
  currency: string | null;
};

function validCurrency(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function inputType(definition: CustomPropertyDefinition): FormulaScalarType | null {
  switch (definition.rules.type) {
    case 'text':
      return { kind: 'text' };
    case 'number':
      return { kind: 'number', dimension: 'unitless', currency: null, basis: null };
    case 'date':
      return { kind: 'date' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'formula':
      return definition.rules.outputType;
    default:
      return null;
  }
}

export function formulaDescriptor(
  definition: CustomPropertyDefinition,
): FormulaSourceDescriptor | null {
  const type = inputType(definition);
  if (!type) return null;
  return {
    id: definition.id,
    label: definition.label,
    aliases: [],
    type,
    nullable: definition.rules.type === 'formula' ? definition.rules.outputType.nullable : true,
    source: definition.rules.type === 'formula' ? 'formula' : 'custom',
  };
}

function nativePosSources(currency: string): FormulaSourceDescriptor[] {
  const money = { kind: 'number', dimension: 'money', currency, basis: 'sellable-unit' } as const;
  return [
    {
      id: POS_FORMULA_SOURCE_IDS.salePrice,
      label: 'Sale price',
      aliases: ['Precio de venta'],
      type: money,
      nullable: true,
      source: 'native',
    },
    {
      id: POS_FORMULA_SOURCE_IDS.estimatedUnitCost,
      label: 'Estimated unit cost',
      aliases: ['Costo unitario estimado'],
      type: money,
      nullable: true,
      source: 'native',
    },
    {
      id: POS_FORMULA_SOURCE_IDS.nativeMargin,
      label: 'Native margin',
      aliases: ['Margen nativo'],
      type: money,
      nullable: true,
      source: 'native',
    },
  ];
}

function dependencyIds(definition: CustomPropertyDefinition): FormulaDependency[] {
  return definition.rules.type === 'formula' ? definition.rules.dependencies : [];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/**
 * Build the permission-filtered source catalog. Formula definitions whose
 * dependency closure reaches a hidden source are omitted with their dependents.
 */
export async function loadFormulaCatalog(
  locals: App.Locals,
  ctx: CoreCtx,
  tableId: string,
  definitions: CustomPropertyDefinition[],
): Promise<FormulaCatalog> {
  const customDescriptors = new Map<string, FormulaSourceDescriptor>();
  for (const definition of definitions) {
    if (definition.archivedAt) continue;
    const field = formulaDescriptor(definition);
    if (field) customDescriptors.set(field.id, field);
  }

  let currency: string | null = null;
  let native: FormulaSourceDescriptor[] = [];
  let canonicalNativeSources: FormulaSourceDescriptor[] = [];
  const hidden = new Set<string>();
  if (tableId === 'pos.catalog') {
    currency = validCurrency((await getFinSettings(ctx)).currency);
    if (currency) native = canonicalNativeSources = nativePosSources(currency);
    else {
      hidden.add(POS_FORMULA_SOURCE_IDS.salePrice);
      hidden.add(POS_FORMULA_SOURCE_IDS.estimatedUnitCost);
      hidden.add(POS_FORMULA_SOURCE_IDS.nativeMargin);
    }
    if (await shouldMaskSensitive(locals, 'finance')) {
      hidden.add(POS_FORMULA_SOURCE_IDS.estimatedUnitCost);
      hidden.add(POS_FORMULA_SOURCE_IDS.nativeMargin);
      native = native.filter((field) => !hidden.has(field.id));
    }
  }

  const formulas = definitions.filter((definition) => definition.rules.type === 'formula');
  let changed = true;
  while (changed) {
    changed = false;
    for (const formula of formulas) {
      if (hidden.has(formula.id)) continue;
      if (dependencyIds(formula).some((dependency) => hidden.has(dependency.id))) {
        hidden.add(formula.id);
        changed = true;
        continue;
      }
    }
  }

  const visibleDefinitions = definitions.filter((definition) => !hidden.has(definition.id));
  const unavailable = new Set<string>();
  changed = true;
  while (changed) {
    changed = false;
    const availableSources = [
      ...native,
      ...[...customDescriptors.values()].filter(
        (field) => !hidden.has(field.id) && !unavailable.has(field.id),
      ),
    ];
    for (const formula of visibleDefinitions) {
      if (formula.archivedAt || formula.rules.type !== 'formula' || unavailable.has(formula.id))
        continue;
      const dependsOnUnavailable = dependencyIds(formula).some((dependency) =>
        unavailable.has(dependency.id),
      );
      const checked = typecheckFormulaAst(formula.rules.ast, availableSources);
      if (
        dependsOnUnavailable ||
        checked.diagnostics.length ||
        !checked.outputType ||
        canonicalJson(checked.outputType) !== canonicalJson(formula.rules.outputType)
      ) {
        unavailable.add(formula.id);
        changed = true;
      }
    }
  }
  const fields = [
    ...native,
    ...visibleDefinitions.flatMap((definition) => {
      if (unavailable.has(definition.id)) return [];
      const field = customDescriptors.get(definition.id);
      return field ? [field] : [];
    }),
  ];
  return {
    fields,
    definitions: visibleDefinitions,
    restrictedDefinitionIds: hidden,
    unavailableDefinitionIds: unavailable,
    canonicalNativeSources,
    currency,
  };
}

export function formulaCatalogRevision(
  definitions: CustomPropertyDefinition[],
  nativeSources: FormulaSourceDescriptor[],
): string {
  const payload = [
    ...nativeSources.map((field) => ({ field, version: 0 })),
    ...definitions
      .filter((definition) => !definition.archivedAt)
      .map((definition) => ({
        field: formulaDescriptor(definition),
        version: definition.version,
      })),
  ].sort((a, b) => (a.field?.id ?? '').localeCompare(b.field?.id ?? ''));
  return createHash('sha256').update(canonicalJson(payload)).digest('base64url');
}

/** Trusted in-request snapshot for the POS page, whose native display values
 * have already been computed from these same canonical sources. */
export function formulaInputsFromPosRows(
  rows: Array<{
    productId: string;
    unitPrice: number | null;
    cost: number | null;
    margin: number | null;
    partial: boolean;
  }>,
  customValues: Record<string, Record<string, CustomPropertyValueCell>>,
): FormulaRecordInputs {
  const out: FormulaRecordInputs = {};
  for (const row of rows) {
    const inputs: Record<string, FormulaInput> = {};
    for (const [propertyId, cell] of Object.entries(customValues[row.productId] ?? {}))
      inputs[propertyId] = {
        value: cell.effectiveValue,
        quality: cell.effectiveValue == null ? 'blank' : 'valid',
        code: null,
        sourceUpdatedAt: cell.updatedAt,
      };
    inputs[POS_FORMULA_SOURCE_IDS.salePrice] = {
      value: row.unitPrice,
      quality: row.unitPrice == null ? 'blank' : 'valid',
      code: null,
      sourceUpdatedAt: null,
    };
    inputs[POS_FORMULA_SOURCE_IDS.estimatedUnitCost] = {
      value: row.cost,
      quality: row.partial ? 'partial' : row.cost == null ? 'blank' : 'valid',
      code: row.partial ? 'partial_cost' : null,
      sourceUpdatedAt: null,
    };
    inputs[POS_FORMULA_SOURCE_IDS.nativeMargin] = {
      value: row.margin,
      quality: row.partial ? 'partial' : row.margin == null ? 'blank' : 'valid',
      code: row.partial ? 'partial_cost' : null,
      sourceUpdatedAt: null,
    };
    out[row.productId] = inputs;
  }
  return out;
}

export function analyzeFormulaDraft(
  expression: string,
  catalog: Pick<FormulaCatalog, 'fields'>,
): FormulaAnalysis {
  return analyzeFormula(expression, catalog.fields);
}

export function persistedFormulaRules(expression: string, analysis: FormulaAnalysis): FormulaRules {
  if (!analysis.ast || !analysis.outputType || analysis.diagnostics.length)
    throw new Error('formula_invalid');
  return {
    type: 'formula',
    expression,
    languageVersion: FORMULA_LANGUAGE_VERSION,
    ast: analysis.ast,
    outputType: analysis.outputType,
    dependencies: analysis.dependencies,
  };
}

function blankInput(): FormulaInput {
  return { value: null, quality: 'blank', code: null, sourceUpdatedAt: null };
}

export async function loadPosFormulaInputs(
  ctx: CoreCtx,
  recordIds: string[],
  customValues: Record<string, Record<string, CustomPropertyValueCell>>,
): Promise<FormulaRecordInputs> {
  const requested = new Set(recordIds);
  const sellables = (await listSellables(ctx, { includeInactive: true })).filter((row) =>
    requested.has(row.productId),
  );
  const costs = await costForProducts(
    ctx,
    sellables.map((row) => row.productId),
  );
  const out: FormulaRecordInputs = Object.fromEntries(recordIds.map((id) => [id, {}]));
  for (const recordId of recordIds) {
    for (const [propertyId, cell] of Object.entries(customValues[recordId] ?? {})) {
      out[recordId][propertyId] = {
        value: cell.effectiveValue,
        quality: cell.effectiveValue == null ? 'blank' : 'valid',
        code: null,
        sourceUpdatedAt: cell.updatedAt,
      };
    }
  }
  for (const row of sellables) {
    const target = out[row.productId];
    const cost = costs.get(row.productId);
    const costValue = cost?.costable ? cost.cost : null;
    const costQuality: InputQuality = cost?.partial
      ? 'partial'
      : costValue == null
        ? 'blank'
        : 'valid';
    target[POS_FORMULA_SOURCE_IDS.salePrice] = {
      value: row.unitPrice,
      quality: row.unitPrice == null ? 'blank' : 'valid',
      code: null,
      sourceUpdatedAt: null,
    };
    target[POS_FORMULA_SOURCE_IDS.estimatedUnitCost] = {
      value: costValue,
      quality: costQuality,
      code: cost?.partial ? 'partial_cost' : null,
      sourceUpdatedAt: null,
    };
    const margin =
      costValue != null && row.unitPrice != null
        ? Math.round((row.unitPrice - costValue) * 100) / 100
        : null;
    target[POS_FORMULA_SOURCE_IDS.nativeMargin] = {
      value: margin,
      quality: cost?.partial ? 'partial' : margin == null ? 'blank' : 'valid',
      code: cost?.partial ? 'partial_cost' : null,
      sourceUpdatedAt: null,
    };
  }
  for (const recordId of recordIds) {
    out[recordId][POS_FORMULA_SOURCE_IDS.salePrice] ??= blankInput();
    out[recordId][POS_FORMULA_SOURCE_IDS.estimatedUnitCost] ??= blankInput();
    out[recordId][POS_FORMULA_SOURCE_IDS.nativeMargin] ??= blankInput();
  }
  return out;
}

export async function loadFormulaInputs(
  ctx: CoreCtx,
  tableId: string,
  recordIds: string[],
  customValues: Record<string, Record<string, CustomPropertyValueCell>>,
): Promise<FormulaRecordInputs> {
  if (tableId === 'pos.catalog') return loadPosFormulaInputs(ctx, recordIds, customValues);
  return formulaInputsFromCustomValues(recordIds, customValues);
}

/** Convert freshly read scalar cells without loading native domain values. */
export function formulaInputsFromCustomValues(
  recordIds: string[],
  customValues: Record<string, Record<string, CustomPropertyValueCell>>,
): FormulaRecordInputs {
  return Object.fromEntries(
    recordIds.map((recordId) => [
      recordId,
      Object.fromEntries(
        Object.entries(customValues[recordId] ?? {}).map(([propertyId, cell]) => [
          propertyId,
          {
            value: cell.effectiveValue,
            quality: cell.effectiveValue == null ? 'blank' : 'valid',
            code: null,
            sourceUpdatedAt: cell.updatedAt,
          } satisfies FormulaInput,
        ]),
      ),
    ]),
  );
}

function sqlInput(source: FormulaSourceDescriptor): SQL {
  const raw = sql`r.inputs ->> ${source.id}`;
  if (source.type.kind === 'number') return sql`(${raw})::numeric`;
  if (source.type.kind === 'boolean') return sql`(${raw})::boolean`;
  if (source.type.kind === 'date') return sql`(${raw})::date`;
  return raw;
}

function qualityFor(dependencies: FormulaDependency[], inputs: Record<string, FormulaInput>) {
  const qualities = dependencies.map((dependency) => inputs[dependency.id]?.quality ?? 'error');
  if (qualities.includes('restricted'))
    return { quality: 'restricted' as const, code: 'restricted' };
  if (qualities.includes('partial'))
    return { quality: 'partial' as const, code: 'partial_dependency' };
  return { quality: 'valid' as const, code: null };
}

function formulaMetadata(
  quality: FormulaCellMetadata['quality'],
  code: string | null,
  currency: string | null,
): FormulaCellMetadata {
  return { quality, code, currency, sourceUpdatedAt: null };
}

/** Evaluate formulas in dependency order. One parameterized SQL query per
 * definition and record batch; never one query per cell. */
export async function evaluateFormulaDefinitions(
  ctx: CoreCtx,
  formulas: CustomPropertyDefinition[],
  sources: FormulaSourceDescriptor[],
  recordInputs: FormulaRecordInputs,
  previewTargetId?: string,
): Promise<{
  cells: Record<string, Record<string, CustomPropertyValueCell>>;
  previewRows: Record<string, FormulaPreviewRow>;
}> {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const pending = new Map(formulas.map((formula) => [formula.id, formula]));
  const cells: Record<string, Record<string, CustomPropertyValueCell>> = Object.fromEntries(
    Object.keys(recordInputs).map((id) => [id, {}]),
  );
  const previewRows: Record<string, FormulaPreviewRow> = {};

  while (pending.size) {
    const ready = [...pending.values()].filter((formula) =>
      dependencyIds(formula).every(
        (dependency) => dependency.source !== 'formula' || !pending.has(dependency.id),
      ),
    );
    if (!ready.length) break;
    for (const formula of ready) {
      pending.delete(formula.id);
      if (formula.rules.type !== 'formula') continue;
      const inputSql = new Map<string, SQL>();
      const inputErrorSql = new Map<string, SQL>();
      for (const dependency of formula.rules.dependencies) {
        const source = sourceById.get(dependency.id);
        if (source) {
          inputSql.set(dependency.id, sqlInput(source));
          inputErrorSql.set(dependency.id, sql`r.errors ->> ${source.id}`);
        }
      }
      const compiled = compileFormulaSql(formula.rules.ast, inputSql, inputErrorSql);
      const payload = Object.entries(recordInputs).map(([recordId, inputs]) => {
        const normalized = formula.rules.dependencies.map(({ id }) => {
          const input = inputs[id] ?? blankInput();
          const source = sourceById.get(id);
          if (
            source?.type.kind === 'number' &&
            typeof input.value === 'number' &&
            (!Number.isFinite(input.value) || Math.abs(input.value) > FORMULA_NUMBER_ABS_MAX)
          )
            return [
              id,
              { ...input, value: null, quality: 'error' as const, code: 'numeric_out_of_range' },
            ] as const;
          return [id, input] as const;
        });
        return {
          record_id: recordId,
          inputs: Object.fromEntries(
            normalized.map(([id, input]) => [id, Array.isArray(input.value) ? null : input.value]),
          ),
          errors: Object.fromEntries(
            normalized.map(([id, input]) => [id, input.quality === 'error' ? input.code : null]),
          ),
        };
      });
      const rows = await withOrgCore(ctx, (tx) =>
        tx.execute(sql`select r.record_id, ${compiled.valueSql} as value, ${compiled.errorSql} as error
          from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
            as r(record_id text, inputs jsonb, errors jsonb)`),
      );
      for (const row of rows as unknown as Array<{
        record_id: string;
        value: string | number | boolean | Date | null;
        error: string | null;
      }>) {
        const recordId = row.record_id;
        const inherited = qualityFor(formula.rules.dependencies, recordInputs[recordId]);
        let value: CustomPropertyValue =
          row.value instanceof Date ? row.value.toISOString().slice(0, 10) : row.value;
        if (typeof value === 'string' && formula.rules.outputType.kind === 'number')
          value = Number(value);
        const quality = row.error
          ? 'error'
          : inherited.quality !== 'valid'
            ? inherited.quality
            : value == null
              ? 'blank'
              : 'valid';
        const code = row.error ?? inherited.code;
        const currency =
          formula.rules.outputType.kind === 'number' &&
          formula.rules.outputType.dimension === 'money'
            ? formula.rules.outputType.currency
            : null;
        const metadata = formulaMetadata(quality, code, currency);
        cells[recordId][formula.id] = {
          propertyId: formula.id,
          recordId,
          present: false,
          value,
          effectiveValue: value,
          version: 0,
          updatedAt: null,
          computed: true,
          definitionVersion: formula.version,
          formula: metadata,
        };
        recordInputs[recordId][formula.id] = {
          value,
          quality,
          code,
          sourceUpdatedAt: null,
        };
        if (!previewTargetId || formula.id === previewTargetId)
          previewRows[recordId] = {
            recordId,
            inputs: Object.fromEntries(
              formula.rules.dependencies.map((dependency) => [
                dependency.id,
                recordInputs[recordId][dependency.id]?.value ?? null,
              ]),
            ),
            result: { value, formula: metadata },
          };
      }
    }
  }
  return { cells, previewRows };
}

export function nativeMarginComparison(
  result: CustomPropertyValue,
  native: FormulaInput | undefined,
): FormulaNativeComparison {
  if (typeof result !== 'number' || typeof native?.value !== 'number')
    return {
      value: typeof native?.value === 'number' ? native.value : null,
      delta: null,
      status: 'unavailable',
    };
  const delta = result - native.value;
  return { value: native.value, delta, status: Math.abs(delta) < 1e-9 ? 'match' : 'different' };
}

export async function loadDefinitionRowsForGraph(ctx: CoreCtx, tableId: string) {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(appTableProperties)
      .where(
        and(eq(appTableProperties.orgId, ctx.tenantId), eq(appTableProperties.tableId, tableId)),
      ),
  );
}
