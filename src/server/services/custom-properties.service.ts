import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { appTableProperties, appTablePropertyValues } from '$server/db/pg-schema/custom-properties';
import { TABLE_BY_ID } from '$lib/tables/defs';
import type { Module } from './rbac.service';
import {
  CUSTOM_PROPERTIES_PER_TABLE_MAX,
  CUSTOM_PROPERTY_DESCRIPTION_MAX,
  CUSTOM_PROPERTY_LABEL_MAX,
  type CreateCustomPropertyInput,
  type CustomPropertyDefinition,
  type CustomPropertyTableId,
  type CustomPropertyRules,
  type CustomPropertyInputRules,
  type CustomPropertyValue,
  type CustomPropertyValueCell,
  type UpdateCustomPropertyInput,
  validateCustomPropertyRules,
  validateCustomPropertyValue,
} from '$lib/tables/custom-properties';
import {
  anyColumnPresentationSchema,
  columnPresentationSchema,
  type ColumnNumberFormat,
  type ColumnPresentation,
  type ColumnPresentationV2,
  type AnyColumnPresentation,
} from '$lib/tables/column-presentation';
import {
  analyzeFormula,
  estimateFormulaSqlExpansion,
  formulaDependencies,
  formulaPrimaryDependencies,
  primaryFormulaOutputType,
  primaryFormulaVariable,
  typecheckFormulaAst,
  FORMULA_VARIABLE_AGGREGATE_DEPENDENCY_MAX,
  FORMULA_VARIABLE_AGGREGATE_NODE_MAX,
  FORMULA_VARIABLE_AGGREGATE_SQL_EXPANSION_MAX,
  FORMULA_VARIABLE_NAME_MAX,
  type FormulaAst,
  type FormulaNullableType,
  type FormulaRulesV2,
  type FormulaSourceDescriptor,
} from '$lib/tables/formula';
import {
  formulaCatalogRevision,
  formulaDescriptor,
  persistedFormulaVariable,
  persistedFormulaRules,
} from './formula-properties.service';

export type CustomPropertyTablePolicy = {
  module: Module;
  moduleId: string;
  sensitiveModule?: Module;
  team?: true;
  /** Modules whose capability ALSO grants an action on this table — any one
   *  suffices. `/pos/appointments` is POS-gated (a cashier schedules without a
   *  scheduling role), so its custom columns must be reachable through `pos`
   *  too (owner report 2026-10-02: Customer Support could not see
   *  `tipo_evento`). */
  altModules?: readonly Module[];
};
/** Every module a policy accepts for a capability check, primary first. */
export const policyModules = (policy: CustomPropertyTablePolicy): readonly Module[] => [
  policy.module,
  ...(policy.altModules ?? []),
];
export const CUSTOM_PROPERTY_TABLE_POLICIES: Readonly<
  Record<CustomPropertyTableId, CustomPropertyTablePolicy>
> = {
  'stock.items': { module: 'stock', moduleId: 'stock' },
  'stock.entries': { module: 'stock', moduleId: 'stock' },
  'pos.catalog': { module: 'pos', moduleId: 'pos' },
  'crm.customers': { module: 'crm', moduleId: 'crm', sensitiveModule: 'crm' },
  'finances.invoices': { module: 'finance', moduleId: 'finances', sensitiveModule: 'finance' },
  'finances.purchases': { module: 'finance', moduleId: 'finances', sensitiveModule: 'finance' },
  'socials.campaigns': { module: 'ads', moduleId: 'socials' },
  'scheduling.bookings': { module: 'scheduling', moduleId: 'scheduling', altModules: ['pos'] },
  'team.people': {
    module: 'scheduling',
    moduleId: 'scheduling',
    sensitiveModule: 'scheduling',
    team: true,
  },
};

export class CustomPropertyError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    readonly code: string,
  ) {
    super(code);
  }
}

export function customPropertyTablePolicy(tableId: string): CustomPropertyTablePolicy {
  const policy = CUSTOM_PROPERTY_TABLE_POLICIES[tableId as CustomPropertyTableId];
  if (!policy || !TABLE_BY_ID.has(tableId)) throw new CustomPropertyError(404, 'unknown_table');
  return policy;
}

type PropertyRow = typeof appTableProperties.$inferSelect;
export type FormulaMutationContext = {
  nativeSources: FormulaSourceDescriptor[];
  authorNativeSources?: FormulaSourceDescriptor[];
  restrictedDefinitionIds?: string[];
  unavailableDefinitionIds?: string[];
  catalogRevision?: string;
  templateKey?: string;
};
const graphLockKey = (orgId: string, tableId: string) => `${orgId}:${tableId}`;
async function lockTableGraph(tx: CoreTx, orgId: string, tableId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${graphLockKey(orgId, tableId)}))`);
}
async function tableRows(tx: CoreTx, orgId: string, tableId: string): Promise<PropertyRow[]> {
  return tx
    .select()
    .from(appTableProperties)
    .where(and(eq(appTableProperties.orgId, orgId), eq(appTableProperties.tableId, tableId)));
}
function activeFormulaDependencies(row: PropertyRow): string[] {
  const rules = row.rules as CustomPropertyRules;
  if (row.archivedAt || rules.type !== 'formula') return [];
  return formulaPrimaryDependencies(rules)
    .filter((dependency) => dependency.source !== 'native')
    .map((dependency) => dependency.id);
}
function allFormulaDependencies(row: PropertyRow): string[] {
  const rules = row.rules as CustomPropertyRules;
  if (row.archivedAt || rules.type !== 'formula') return [];
  return formulaDependencies(rules)
    .filter((dependency) => dependency.source !== 'native')
    .map((dependency) => dependency.id);
}
function assertFormulaGraph(rows: PropertyRow[]): void {
  const active = new Map(rows.filter((row) => !row.archivedAt).map((row) => [row.id, row]));
  for (const row of active.values())
    for (const dependencyId of activeFormulaDependencies(row))
      if (!active.has(dependencyId))
        throw new CustomPropertyError(422, 'formula_invalid_dependency');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new CustomPropertyError(422, 'formula_cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    const row = active.get(id);
    if (row) for (const dependencyId of activeFormulaDependencies(row)) visit(dependencyId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of active.keys()) visit(id);
}
function definitionsFromRows(rows: PropertyRow[]): CustomPropertyDefinition[] {
  return rows.map(toDefinition);
}
function sameScalarType(left: unknown, right: unknown): boolean {
  const ordered = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(ordered).join(',')}]`;
    if (value && typeof value === 'object')
      return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${ordered(item)}`)
        .join(',')}}`;
    return JSON.stringify(value);
  };
  return ordered(left) === ordered(right);
}
function compileFormulaRules(
  rules: CustomPropertyInputRules,
  rows: PropertyRow[],
  nativeSources: FormulaSourceDescriptor[],
  expectedRevision?: string,
  authorNativeSources: FormulaSourceDescriptor[] = nativeSources,
  restrictedDefinitionIds: string[] = [],
  propertyId: string | null = null,
): CustomPropertyRules {
  const restricted = new Set(restrictedDefinitionIds);
  const definitions = definitionsFromRows(rows).filter(
    (definition) => !restricted.has(definition.id),
  );
  const currentRevision = formulaCatalogRevision(definitions, authorNativeSources);
  if (expectedRevision !== undefined && expectedRevision !== currentRevision)
    throw new CustomPropertyError(409, 'catalog_changed');
  if (rules.type !== 'formula') return rules;
  const sources = [
    ...authorNativeSources,
    ...definitions.flatMap((definition) => {
      if (definition.archivedAt) return [];
      const field = formulaDescriptor(definition);
      return field ? [field] : [];
    }),
  ];
  if (!('version' in rules)) {
    const analysis = analyzeFormula(rules.expression, sources);
    if (analysis.diagnostics.length || !analysis.ast || !analysis.outputType)
      throw new CustomPropertyError(422, analysis.diagnostics[0]?.code ?? 'invalid_rules');
    return persistedFormulaRules(rules.expression, analysis);
  }
  const names = new Set<string>();
  const ids = new Set<string>();
  const compiled = [];
  let nodes = 0;
  let expansion = 0;
  const dependencies = new Set<string>();
  const countNodes = (ast: FormulaAst): number => {
    if (ast.kind === 'literal' || ast.kind === 'reference') return 1;
    if (ast.kind === 'unary' || ast.kind === 'is_null') return 1 + countNodes(ast.operand);
    if (ast.kind === 'binary') return 1 + countNodes(ast.left) + countNodes(ast.right);
    if (ast.kind === 'call')
      return 1 + ast.arguments.reduce((sum, arg) => sum + countNodes(arg), 0);
    return (
      1 +
      ast.branches.reduce(
        (sum, branch) => sum + countNodes(branch.when) + countNodes(branch.then),
        0,
      ) +
      countNodes(ast.otherwise)
    );
  };
  for (const variable of rules.variables) {
    if (ids.has(variable.id)) throw new CustomPropertyError(422, 'formula_variable_id_duplicate');
    ids.add(variable.id);
    const name = variable.name?.trim().normalize('NFKC') ?? null;
    if (
      rules.variables.length === 1
        ? name !== null
        : !name || name.length > FORMULA_VARIABLE_NAME_MAX
    )
      throw new CustomPropertyError(422, 'formula_variable_name_invalid');
    if (name) {
      const folded = name.toLocaleLowerCase('und');
      if (names.has(folded)) throw new CustomPropertyError(422, 'formula_variable_name_duplicate');
      names.add(folded);
    }
    const analysis = analyzeFormula(variable.expression, sources);
    if (analysis.diagnostics.length || !analysis.ast || !analysis.outputType)
      throw new CustomPropertyError(422, analysis.diagnostics[0]?.code ?? 'invalid_rules');
    if (propertyId && analysis.dependencies.some((dependency) => dependency.id === propertyId))
      throw new CustomPropertyError(422, 'formula_cycle');
    nodes += countNodes(analysis.ast);
    expansion += estimateFormulaSqlExpansion(analysis.ast);
    for (const dependency of analysis.dependencies) dependencies.add(dependency.id);
    compiled.push(persistedFormulaVariable({ ...variable, name }, analysis));
  }
  if (!ids.has(rules.primaryVariableId))
    throw new CustomPropertyError(422, 'formula_primary_variable_missing');
  if (
    nodes > FORMULA_VARIABLE_AGGREGATE_NODE_MAX ||
    dependencies.size > FORMULA_VARIABLE_AGGREGATE_DEPENDENCY_MAX ||
    expansion > FORMULA_VARIABLE_AGGREGATE_SQL_EXPANSION_MAX
  )
    throw new CustomPropertyError(422, 'expression_too_complex');
  return {
    type: 'formula',
    version: 2,
    primaryVariableId: rules.primaryVariableId,
    variables: compiled,
  } satisfies FormulaRulesV2;
}
function assertCatalogRevision(
  rows: PropertyRow[],
  nativeSources: FormulaSourceDescriptor[],
  restrictedDefinitionIds: string[],
  expectedRevision: string | undefined,
): void {
  const restricted = new Set(restrictedDefinitionIds);
  const definitions = definitionsFromRows(rows).filter(
    (definition) => !restricted.has(definition.id),
  );
  if (
    expectedRevision === undefined ||
    expectedRevision !== formulaCatalogRevision(definitions, nativeSources)
  )
    throw new CustomPropertyError(409, 'catalog_changed');
}
function validateAllFormulaTypes(
  rows: PropertyRow[],
  nativeSources: FormulaSourceDescriptor[],
): void {
  const definitions = definitionsFromRows(rows);
  const sources = [
    ...nativeSources,
    ...definitions.flatMap((definition) => {
      if (definition.archivedAt) return [];
      const field = formulaDescriptor(definition);
      return field ? [field] : [];
    }),
  ];
  for (const definition of definitions) {
    if (definition.archivedAt || definition.rules.type !== 'formula') continue;
    const variables =
      'version' in definition.rules
        ? definition.rules.variables
        : [primaryFormulaVariable(definition.rules, definition.id)];
    for (const variable of variables) {
      const analysis = typecheckFormulaAst(variable.ast, sources);
      if (
        analysis.diagnostics.length ||
        !analysis.outputType ||
        !sameScalarType(analysis.outputType, variable.outputType)
      )
        throw new CustomPropertyError(422, analysis.diagnostics[0]?.code ?? 'formula_invalid');
    }
  }
}
const iso = (d: Date | null) => d?.toISOString() ?? null;
function toDefinition(row: PropertyRow): CustomPropertyDefinition {
  const rules = row.rules as CustomPropertyRules;
  return {
    id: row.id,
    tableId: row.tableId as CustomPropertyTableId,
    label: row.label,
    description: row.description,
    type: rules.type,
    rules,
    hasDefault: row.hasDefault === 1,
    defaultValue: row.hasDefault === 1 ? (row.defaultValue as CustomPropertyValue) : null,
    presentation: (row.presentation as AnyColumnPresentation | null) ?? null,
    version: row.version,
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertNumberFormat(format: ColumnNumberFormat, outputType: FormulaNullableType): void {
  if (outputType.kind !== 'number') throw new CustomPropertyError(422, 'presentation_incompatible');
  if (
    (format.style === 'currency' && outputType.dimension !== 'money') ||
    (outputType.dimension === 'money' && !['auto', 'currency'].includes(format.style))
  )
    throw new CustomPropertyError(422, 'presentation_incompatible');
}

function validatePresentation(
  proposed: unknown,
  propertyId: string | null,
  rules: CustomPropertyRules,
  rows: PropertyRow[],
  restrictedDefinitionIds: readonly string[],
  unavailableDefinitionIds: readonly string[],
  current: AnyColumnPresentation | null,
  explicitlyChanged: boolean,
): AnyColumnPresentation | null {
  // TODO(handoff): Extend this admission seam to native and other custom numeric columns under
  // proposal 2026-09-27-hub-column-presentation-admission; this slice intentionally admits
  // numeric formulas only.
  if (proposed == null) {
    if (
      explicitlyChanged &&
      current?.version === 1 &&
      current.secondary &&
      restrictedDefinitionIds.includes(current.secondary.propertyId)
    )
      throw new CustomPropertyError(422, 'presentation_restricted');
    return null;
  }
  const parsed = anyColumnPresentationSchema.safeParse(proposed);
  if (!parsed.success) throw new CustomPropertyError(422, 'invalid_presentation');
  if (rules.type !== 'formula') throw new CustomPropertyError(422, 'presentation_incompatible');
  if (parsed.data.version === 2) {
    if (!('version' in rules)) throw new CustomPropertyError(422, 'presentation_incompatible');
    const variables = new Map(rules.variables.map((variable) => [variable.id, variable]));
    const seen = new Set<string>();
    for (const entry of parsed.data.variables) {
      if (seen.has(entry.variableId)) throw new CustomPropertyError(422, 'invalid_presentation');
      seen.add(entry.variableId);
      const variable = variables.get(entry.variableId);
      if (!variable) throw new CustomPropertyError(422, 'presentation_variable_invalid');
      if (variable.outputType.kind !== 'number') {
        if (entry.number !== null || entry.tone !== 'none')
          throw new CustomPropertyError(422, 'presentation_incompatible');
      } else if (entry.number) assertNumberFormat(entry.number, variable.outputType);
    }
    return parsed.data;
  }
  assertNumberFormat(parsed.data.number, primaryFormulaOutputType(rules));
  const secondaryId = parsed.data.secondary?.propertyId;
  if (
    explicitlyChanged &&
    current?.version === 1 &&
    current.secondary &&
    restrictedDefinitionIds.includes(current.secondary.propertyId)
  )
    throw new CustomPropertyError(422, 'presentation_restricted');
  if (secondaryId) {
    if (secondaryId === propertyId)
      throw new CustomPropertyError(422, 'presentation_secondary_invalid');
    if (
      !explicitlyChanged &&
      current?.version === 1 &&
      current.secondary?.propertyId === secondaryId
    )
      return parsed.data;
    if (restrictedDefinitionIds.includes(secondaryId))
      throw new CustomPropertyError(422, 'presentation_restricted');
    if (unavailableDefinitionIds.includes(secondaryId))
      throw new CustomPropertyError(422, 'presentation_secondary_invalid');
    const target = rows.find((row) => row.id === secondaryId && !row.archivedAt);
    const targetRules = target?.rules as CustomPropertyRules | undefined;
    if (
      !target ||
      targetRules?.type !== 'formula' ||
      primaryFormulaOutputType(targetRules).kind !== 'number'
    )
      throw new CustomPropertyError(422, 'presentation_secondary_invalid');
    assertNumberFormat(parsed.data.secondary!.format, primaryFormulaOutputType(targetRules));
  }
  return parsed.data;
}
function actor(ctx: CoreCtx): string {
  if (!ctx.profileId) throw new CustomPropertyError(404, 'unauthorized');
  return ctx.profileId;
}
function cleanLabel(label: string): string {
  const clean = label.trim();
  if (!clean || clean.length > CUSTOM_PROPERTY_LABEL_MAX)
    throw new CustomPropertyError(422, 'invalid_label');
  return clean;
}
function cleanDescription(value: string | null | undefined): string | null {
  if (value == null) return null;
  const clean = value.trim();
  if (clean.length > CUSTOM_PROPERTY_DESCRIPTION_MAX)
    throw new CustomPropertyError(422, 'invalid_description');
  return clean || null;
}
function validateDefinition(
  rules: CustomPropertyRules,
  hasDefault: boolean,
  defaultValue: unknown,
): CustomPropertyValue {
  const validRules = validateCustomPropertyRules(rules);
  if (!validRules.ok) throw new CustomPropertyError(422, validRules.code);
  if (rules.type === 'formula') {
    if (hasDefault) throw new CustomPropertyError(422, 'formula_default_forbidden');
    return null;
  }
  if (!hasDefault) return null;
  const valid = validateCustomPropertyValue(rules, defaultValue ?? null);
  if (!valid.ok) throw new CustomPropertyError(422, `default_${valid.code}`);
  return valid.value;
}
function mapDbError(cause: unknown): never {
  let current: unknown = cause;
  for (let i = 0; current && i < 5; i++) {
    if (typeof current !== 'object') break;
    const e = current as {
      code?: string;
      constraint_name?: string;
      constraint?: string;
      cause?: unknown;
    };
    if (e.code === '23505' && (e.constraint_name ?? e.constraint)?.includes('active_label'))
      throw new CustomPropertyError(409, 'duplicate_label');
    if (e.code === '23505' && (e.constraint_name ?? e.constraint)?.includes('template_key'))
      throw new CustomPropertyError(409, 'template_exists');
    current = e.cause;
  }
  throw cause;
}
async function lockProperty(tx: CoreTx, orgId: string, propertyId: string): Promise<PropertyRow> {
  const [row] = await tx
    .select()
    .from(appTableProperties)
    .where(and(eq(appTableProperties.orgId, orgId), eq(appTableProperties.id, propertyId)))
    .limit(1)
    .for('update');
  if (!row) throw new CustomPropertyError(404, 'property_unavailable');
  return row;
}

export async function listCustomProperties(
  ctx: CoreCtx,
  tableId: string,
  includeArchived = false,
): Promise<CustomPropertyDefinition[]> {
  customPropertyTablePolicy(tableId);
  return withOrgCore(ctx, async (tx) => {
    const conditions = [
      eq(appTableProperties.orgId, ctx.tenantId),
      eq(appTableProperties.tableId, tableId),
    ];
    if (!includeArchived) conditions.push(isNull(appTableProperties.archivedAt));
    const rows = await tx
      .select()
      .from(appTableProperties)
      .where(and(...conditions))
      .orderBy(appTableProperties.createdAt);
    return rows.map(toDefinition);
  });
}

export async function getCustomProperty(
  ctx: CoreCtx,
  propertyId: string,
): Promise<CustomPropertyDefinition> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(appTableProperties)
      .where(and(eq(appTableProperties.orgId, ctx.tenantId), eq(appTableProperties.id, propertyId)))
      .limit(1);
    if (!row) throw new CustomPropertyError(404, 'property_unavailable');
    return toDefinition(row);
  });
}

export async function createCustomProperty(
  ctx: CoreCtx,
  input: CreateCustomPropertyInput,
  formulaContext: FormulaMutationContext = { nativeSources: [] },
): Promise<CustomPropertyDefinition> {
  customPropertyTablePolicy(input.tableId);
  const who = actor(ctx);
  const label = cleanLabel(input.label);
  const description = cleanDescription(input.description);
  try {
    return await withOrgCore(ctx, async (tx) => {
      await lockTableGraph(tx, ctx.tenantId, input.tableId);
      const beforeRows = await tableRows(tx, ctx.tenantId, input.tableId);
      const rules = compileFormulaRules(
        input.rules,
        beforeRows,
        formulaContext.nativeSources,
        input.rules.type === 'formula' ? formulaContext.catalogRevision : undefined,
        formulaContext.authorNativeSources,
        formulaContext.restrictedDefinitionIds,
      );
      const defaultValue = validateDefinition(rules, input.hasDefault, input.defaultValue);
      const presentation = validatePresentation(
        input.presentation ?? null,
        null,
        rules,
        beforeRows,
        formulaContext.restrictedDefinitionIds ?? [],
        formulaContext.unavailableDefinitionIds ?? [],
        null,
        input.presentation !== undefined,
      );
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(appTableProperties)
        .where(
          and(
            eq(appTableProperties.orgId, ctx.tenantId),
            eq(appTableProperties.tableId, input.tableId),
            isNull(appTableProperties.archivedAt),
          ),
        );
      if (Number(n) >= CUSTOM_PROPERTIES_PER_TABLE_MAX)
        throw new CustomPropertyError(422, 'property_limit');
      const [row] = await tx
        .insert(appTableProperties)
        .values({
          orgId: ctx.tenantId,
          tableId: input.tableId,
          templateKey: formulaContext.templateKey,
          label,
          description,
          rules,
          hasDefault: input.hasDefault ? 1 : 0,
          defaultValue,
          presentation,
          createdBy: who,
          updatedBy: who,
        })
        .returning();
      const afterRows = await tableRows(tx, ctx.tenantId, input.tableId);
      assertFormulaGraph(afterRows);
      validateAllFormulaTypes(afterRows, formulaContext.nativeSources);
      return toDefinition(row);
    });
  } catch (e) {
    return mapDbError(e);
  }
}

export async function updateCustomProperty(
  ctx: CoreCtx,
  propertyId: string,
  input: UpdateCustomPropertyInput,
  formulaContext: FormulaMutationContext = { nativeSources: [] },
): Promise<CustomPropertyDefinition> {
  const who = actor(ctx);
  try {
    return await withOrgCore(ctx, async (tx) => {
      const [candidate] = await tx
        .select({ tableId: appTableProperties.tableId })
        .from(appTableProperties)
        .where(
          and(eq(appTableProperties.orgId, ctx.tenantId), eq(appTableProperties.id, propertyId)),
        )
        .limit(1);
      if (!candidate) throw new CustomPropertyError(404, 'property_unavailable');
      await lockTableGraph(tx, ctx.tenantId, candidate.tableId);
      const current = await lockProperty(tx, ctx.tenantId, propertyId);
      if (current.version !== input.expectedVersion)
        throw new CustomPropertyError(409, 'version_conflict');
      const oldRules = current.rules as CustomPropertyRules;
      const oldPresentation = (current.presentation as AnyColumnPresentation | null) ?? null;
      const rowsBefore = await tableRows(tx, ctx.tenantId, current.tableId);
      const restricted = new Set(formulaContext.restrictedDefinitionIds ?? []);
      const hasRestrictedVariables =
        oldRules.type === 'formula' &&
        formulaDependencies(oldRules).some((dependency) => restricted.has(dependency.id));
      const hasRestrictedLegacySecondary =
        oldPresentation?.version === 1 &&
        !!oldPresentation.secondary &&
        restricted.has(oldPresentation.secondary.propertyId);
      if (
        hasRestrictedLegacySecondary &&
        (input.presentation !== undefined ||
          (input.rules?.type === 'formula' && 'version' in input.rules))
      )
        throw new CustomPropertyError(422, 'presentation_restricted');
      if ((input.rules !== undefined || input.presentation !== undefined) && hasRestrictedVariables)
        throw new CustomPropertyError(422, 'formula_variables_restricted');
      if (input.presentation !== undefined && input.rules?.type !== 'formula')
        assertCatalogRevision(
          rowsBefore,
          formulaContext.authorNativeSources ?? formulaContext.nativeSources,
          formulaContext.restrictedDefinitionIds ?? [],
          formulaContext.catalogRevision,
        );
      const rules = input.rules
        ? compileFormulaRules(
            input.rules,
            rowsBefore,
            formulaContext.nativeSources,
            input.rules.type === 'formula' ? formulaContext.catalogRevision : undefined,
            formulaContext.authorNativeSources,
            formulaContext.restrictedDefinitionIds,
            propertyId,
          )
        : oldRules;
      if (rules.type !== oldRules.type)
        throw new CustomPropertyError(422, 'property_type_immutable');
      if (
        (oldRules.type === 'select' || oldRules.type === 'multi_select') &&
        (rules.type === 'select' || rules.type === 'multi_select')
      ) {
        const nextIds = new Set(rules.options.map((option) => option.id));
        if (oldRules.options.some((option) => !nextIds.has(option.id)))
          throw new CustomPropertyError(422, 'option_delete_forbidden');
      }
      const hasDefault = input.hasDefault ?? current.hasDefault === 1;
      const proposedDefault =
        input.defaultValue !== undefined ? input.defaultValue : current.defaultValue;
      const defaultValue = validateDefinition(rules, hasDefault, proposedDefault);
      const presentation = validatePresentation(
        input.presentation === undefined ? oldPresentation : input.presentation,
        propertyId,
        rules,
        rowsBefore,
        formulaContext.restrictedDefinitionIds ?? [],
        formulaContext.unavailableDefinitionIds ?? [],
        oldPresentation,
        input.presentation !== undefined,
      );
      const values = await tx
        .select({ value: appTablePropertyValues.value })
        .from(appTablePropertyValues)
        .where(
          and(
            eq(appTablePropertyValues.orgId, ctx.tenantId),
            eq(appTablePropertyValues.propertyId, propertyId),
          ),
        );
      for (const stored of values) {
        const retained = new Set(
          Array.isArray(stored.value)
            ? stored.value.filter((v): v is string => typeof v === 'string')
            : typeof stored.value === 'string'
              ? [stored.value]
              : [],
        );
        const valid = validateCustomPropertyValue(rules, stored.value, retained);
        if (!valid.ok) throw new CustomPropertyError(422, `existing_${valid.code}`);
      }
      const [row] = await tx
        .update(appTableProperties)
        .set({
          label: input.label === undefined ? current.label : cleanLabel(input.label),
          description:
            input.description === undefined
              ? current.description
              : cleanDescription(input.description),
          rules,
          hasDefault: hasDefault ? 1 : 0,
          defaultValue,
          presentation,
          version: current.version + 1,
          updatedBy: who,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(appTableProperties.orgId, ctx.tenantId),
            eq(appTableProperties.id, propertyId),
            eq(appTableProperties.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!row) throw new CustomPropertyError(409, 'version_conflict');
      const graphRows = await tableRows(tx, ctx.tenantId, current.tableId);
      assertFormulaGraph(graphRows);
      validateAllFormulaTypes(graphRows, formulaContext.nativeSources);
      const dependent = graphRows.filter((candidateRow) =>
        activeFormulaDependencies(candidateRow).includes(propertyId),
      );
      if (
        dependent.length &&
        oldRules.type === 'formula' &&
        rules.type === 'formula' &&
        !sameScalarType(primaryFormulaOutputType(oldRules), primaryFormulaOutputType(rules))
      )
        throw new CustomPropertyError(422, 'formula_dependent_type_invalid');
      return toDefinition(row);
    });
  } catch (e) {
    return mapDbError(e);
  }
}

export async function setCustomPropertyArchived(
  ctx: CoreCtx,
  propertyId: string,
  expectedVersion: number,
  archived: boolean,
  formulaContext: FormulaMutationContext = { nativeSources: [] },
): Promise<CustomPropertyDefinition> {
  const who = actor(ctx);
  try {
    return await withOrgCore(ctx, async (tx) => {
      const [candidate] = await tx
        .select({ tableId: appTableProperties.tableId })
        .from(appTableProperties)
        .where(
          and(eq(appTableProperties.orgId, ctx.tenantId), eq(appTableProperties.id, propertyId)),
        )
        .limit(1);
      if (!candidate) throw new CustomPropertyError(404, 'property_unavailable');
      await lockTableGraph(tx, ctx.tenantId, candidate.tableId);
      const current = await lockProperty(tx, ctx.tenantId, propertyId);
      if (current.version !== expectedVersion)
        throw new CustomPropertyError(409, 'version_conflict');
      if (archived ? current.archivedAt : !current.archivedAt) return toDefinition(current);
      const graphRows = await tableRows(tx, ctx.tenantId, current.tableId);
      if (archived && graphRows.some((row) => allFormulaDependencies(row).includes(propertyId)))
        throw new CustomPropertyError(409, 'formula_dependency_in_use');
      if (!archived) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(appTableProperties)
          .where(
            and(
              eq(appTableProperties.orgId, ctx.tenantId),
              eq(appTableProperties.tableId, current.tableId),
              isNull(appTableProperties.archivedAt),
            ),
          );
        if (Number(n) >= CUSTOM_PROPERTIES_PER_TABLE_MAX)
          throw new CustomPropertyError(422, 'property_limit');
      }
      const [row] = await tx
        .update(appTableProperties)
        .set({
          archivedAt: archived ? new Date() : null,
          version: current.version + 1,
          updatedBy: who,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(appTableProperties.orgId, ctx.tenantId),
            eq(appTableProperties.id, propertyId),
            eq(appTableProperties.version, expectedVersion),
          ),
        )
        .returning();
      if (!row) throw new CustomPropertyError(409, 'version_conflict');
      const afterRows = await tableRows(tx, ctx.tenantId, current.tableId);
      assertFormulaGraph(afterRows);
      validateAllFormulaTypes(afterRows, formulaContext.nativeSources);
      return toDefinition(row);
    });
  } catch (e) {
    return mapDbError(e);
  }
}

export async function readCustomPropertyValues(
  ctx: CoreCtx,
  tableId: string,
  recordIds: string[],
  suppliedDefinitions?: CustomPropertyDefinition[],
): Promise<Record<string, Record<string, CustomPropertyValueCell>>> {
  const defs = (suppliedDefinitions ?? (await listCustomProperties(ctx, tableId))).filter(
    (definition) => definition.rules.type !== 'formula',
  );
  const out: Record<string, Record<string, CustomPropertyValueCell>> = Object.fromEntries(
    recordIds.map((id) => [id, {}]),
  );
  if (!defs.length || !recordIds.length) return out;
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(appTablePropertyValues)
      .where(
        and(
          eq(appTablePropertyValues.orgId, ctx.tenantId),
          inArray(
            appTablePropertyValues.propertyId,
            defs.map((d) => d.id),
          ),
          inArray(appTablePropertyValues.recordId, recordIds),
        ),
      );
    const stored = new Map(rows.map((r) => [`${r.recordId}:${r.propertyId}`, r]));
    for (const recordId of recordIds)
      for (const def of defs) {
        const row = stored.get(`${recordId}:${def.id}`);
        const value = row ? (row.value as CustomPropertyValue) : null;
        out[recordId][def.id] = {
          propertyId: def.id,
          recordId,
          present: !!row,
          value,
          effectiveValue: row ? value : def.hasDefault ? def.defaultValue : null,
          version: row?.version ?? 0,
          updatedAt: row ? row.updatedAt.toISOString() : null,
        };
      }
    return out;
  });
}

export async function putCustomPropertyValue(
  ctx: CoreCtx,
  tableId: string,
  propertyId: string,
  recordId: string,
  value: unknown,
  expectedVersion: number,
): Promise<CustomPropertyValueCell> {
  customPropertyTablePolicy(tableId);
  const who = actor(ctx);
  return withOrgCore(ctx, async (tx) => {
    await lockTableGraph(tx, ctx.tenantId, tableId);
    const property = await lockProperty(tx, ctx.tenantId, propertyId);
    if (property.tableId !== tableId || property.archivedAt)
      throw new CustomPropertyError(404, 'property_unavailable');
    const [current] = await tx
      .select()
      .from(appTablePropertyValues)
      .where(
        and(
          eq(appTablePropertyValues.orgId, ctx.tenantId),
          eq(appTablePropertyValues.propertyId, propertyId),
          eq(appTablePropertyValues.recordId, recordId),
        ),
      )
      .limit(1);
    if ((current?.version ?? 0) !== expectedVersion)
      throw new CustomPropertyError(409, 'version_conflict');
    const retained = new Set(
      Array.isArray(current?.value)
        ? current.value.filter((v): v is string => typeof v === 'string')
        : typeof current?.value === 'string'
          ? [current.value]
          : [],
    );
    const valid = validateCustomPropertyValue(
      property.rules as CustomPropertyRules,
      value,
      retained,
    );
    if (!valid.ok) throw new CustomPropertyError(422, valid.code);
    const nextVersion = expectedVersion + 1;
    const now = new Date();
    const nowIso = now.toISOString();
    const jsonValue = JSON.stringify(valid.value);
    const written =
      await tx.execute(sql`insert into app_table_property_values(org_id,property_id,record_id,value,version,created_by,updated_by,created_at,updated_at)
      values(${ctx.tenantId},${propertyId}::uuid,${recordId},${jsonValue}::jsonb,${nextVersion},${who},${who},${nowIso}::timestamptz,${nowIso}::timestamptz)
      on conflict(org_id,property_id,record_id) do update set value=excluded.value,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at
      where app_table_property_values.version=${expectedVersion} returning version`);
    if (!(written as unknown[]).length) throw new CustomPropertyError(409, 'version_conflict');
    return {
      propertyId,
      recordId,
      present: true,
      value: valid.value,
      effectiveValue: valid.value,
      version: nextVersion,
      updatedAt: now.toISOString(),
    };
  });
}
