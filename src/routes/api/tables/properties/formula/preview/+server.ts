import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireCustomPropertyAccess } from '$server/services/custom-properties-access';
import { authorizeCustomPropertyRecords } from '$server/services/custom-property-entities.service';
import {
  listCustomProperties,
  readCustomPropertyValues,
} from '$server/services/custom-properties.service';
import {
  POS_FORMULA_SOURCE_IDS,
  analyzeFormulaDraft,
  evaluateFormulaDefinitions,
  loadFormulaCatalog,
  loadFormulaInputs,
  nativeMarginComparison,
  persistedFormulaRules,
  formulaCatalogRevision,
} from '$server/services/formula-properties.service';
import {
  CUSTOM_PROPERTY_TABLE_IDS,
  type CustomPropertyDefinition,
  formulaDraftRulesV2WireSchema,
  formulaDraftRulesV2Schema,
} from '$lib/tables/custom-properties';
import {
  formulaPrimaryDependencies,
  primaryFormulaVariable,
  primaryFormulaOutputType,
  type FormulaAst,
  type FormulaRulesV2,
} from '$lib/tables/formula';
import { columnPresentationV2Schema } from '$lib/tables/column-presentation';
import { propertyApiError, requireActor } from '../../api';

const v1Schema = z
  .object({
    tableId: z.enum(CUSTOM_PROPERTY_TABLE_IDS),
    expression: z.string().max(2_000),
    recordIds: z.array(z.string().min(1).max(500)).max(20),
    propertyId: z.string().uuid().optional(),
    catalogRevision: z.string(),
  })
  .strict();
const v2Schema = z
  .object({
    tableId: z.enum(CUSTOM_PROPERTY_TABLE_IDS),
    rules: formulaDraftRulesV2WireSchema,
    presentation: columnPresentationV2Schema.nullable().optional(),
    recordIds: z.array(z.string().min(1).max(500)).max(20),
    propertyId: z.string().uuid().optional(),
    catalogRevision: z.string(),
  })
  .strict();
const schema = z.union([v1Schema, v2Schema]);

function semanticAst(ast: FormulaAst): unknown {
  if (ast.kind === 'literal') return { kind: ast.kind, value: ast.value, valueType: ast.valueType };
  if (ast.kind === 'reference') return { kind: ast.kind, sourceId: ast.sourceId };
  if (ast.kind === 'unary')
    return { kind: ast.kind, operator: ast.operator, operand: semanticAst(ast.operand) };
  if (ast.kind === 'binary')
    return {
      kind: ast.kind,
      operator: ast.operator,
      left: semanticAst(ast.left),
      right: semanticAst(ast.right),
    };
  if (ast.kind === 'is_null')
    return { kind: ast.kind, negated: ast.negated, operand: semanticAst(ast.operand) };
  if (ast.kind === 'call')
    return { kind: ast.kind, name: ast.name, arguments: ast.arguments.map(semanticAst) };
  return {
    kind: ast.kind,
    branches: ast.branches.map((branch) => ({
      when: semanticAst(branch.when),
      then: semanticAst(branch.then),
    })),
    otherwise: semanticAst(ast.otherwise),
  };
}

function referencedFormulaIds(ast: FormulaAst): string[] {
  if (ast.kind === 'reference') return [ast.sourceId];
  if (ast.kind === 'literal') return [];
  if (ast.kind === 'unary' || ast.kind === 'is_null') return referencedFormulaIds(ast.operand);
  if (ast.kind === 'binary')
    return [...referencedFormulaIds(ast.left), ...referencedFormulaIds(ast.right)];
  if (ast.kind === 'call') return ast.arguments.flatMap(referencedFormulaIds);
  return [
    ...ast.branches.flatMap((branch) => [
      ...referencedFormulaIds(branch.when),
      ...referencedFormulaIds(branch.then),
    ]),
    ...referencedFormulaIds(ast.otherwise),
  ];
}

function draftCreatesCycle(
  propertyId: string,
  draftAst: FormulaAst,
  definitions: CustomPropertyDefinition[],
): boolean {
  const graph = new Map<string, string[]>();
  for (const definition of definitions)
    if (definition.rules.type === 'formula')
      graph.set(
        definition.id,
        formulaPrimaryDependencies(definition.rules).map((dependency) => dependency.id),
      );
  graph.set(propertyId, referencedFormulaIds(draftAst));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? [])
      if (graph.has(dependency) && visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return visit(propertyId);
}

export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    const ctx = await requireCoreCtx(locals);
    requireActor(ctx);
    const body = await parseBody(request, schema);
    await requireCustomPropertyAccess(locals, ctx, body.tableId, 'view');
    const recordIds = [...new Set(body.recordIds)];
    const access = await authorizeCustomPropertyRecords(
      locals,
      ctx,
      body.tableId,
      recordIds,
      'view',
    );
    if (recordIds.some((recordId) => !access[recordId])) throw error(404, 'record_unavailable');

    const allDefinitions = await listCustomProperties(ctx, body.tableId);
    const catalog = await loadFormulaCatalog(locals, ctx, body.tableId, allDefinitions);
    const nativeSources = catalog.fields.filter((field) => field.source === 'native');
    if (body.catalogRevision !== formulaCatalogRevision(catalog.definitions, nativeSources))
      throw error(409, 'catalog_changed');
    if (body.propertyId && catalog.restrictedDefinitionIds.has(body.propertyId))
      throw error(403, 'formula_unavailable');
    if (body.propertyId && catalog.unavailableDefinitionIds.has(body.propertyId))
      throw error(409, 'source_type_changed');
    if ('rules' in body) {
      const validDraft = formulaDraftRulesV2Schema.safeParse(body.rules);
      if (!validDraft.success) {
        const diagnostics = validDraft.error.issues.map((issue) => {
          const variableIndex = issue.path[0] === 'variables' ? Number(issue.path[1]) : -1;
          return {
            code: 'syntax_error' as const,
            messageKey: `formula_variable_${issue.message}`,
            severity: 'error' as const,
            from: 0,
            to: 0,
            variableId: body.rules.variables[variableIndex]?.id ?? body.rules.primaryVariableId,
          };
        });
        return json({
          diagnostics: diagnostics.filter(
            ({ variableId }) => variableId === body.rules.primaryVariableId,
          ),
          outputType: null,
          dependencies: [],
          variables: body.rules.variables.map((variable) => ({
            variableId: variable.id,
            outputType: null,
            dependencies: [],
            diagnostics: diagnostics.filter(({ variableId }) => variableId === variable.id),
          })),
          rows: [],
        });
      }
      const analyses = body.rules.variables.map((variable) => ({
        variable,
        analysis: analyzeFormulaDraft(variable.expression, catalog),
      }));
      const variableAnalyses = analyses.map(({ variable, analysis }) => ({
        variableId: variable.id,
        outputType: analysis.outputType,
        dependencies: analysis.dependencies,
        diagnostics: analysis.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          variableId: variable.id,
        })),
      }));
      const primaryAnalysis = analyses.find(
        ({ variable }) => variable.id === body.rules.primaryVariableId,
      )?.analysis;
      if (
        !primaryAnalysis ||
        analyses.some(
          ({ analysis }) => analysis.diagnostics.length || !analysis.ast || !analysis.outputType,
        )
      )
        return json({
          diagnostics: primaryAnalysis?.diagnostics ?? [],
          outputType: primaryAnalysis?.outputType ?? null,
          dependencies: primaryAnalysis?.dependencies ?? [],
          variables: variableAnalyses,
          rows: [],
        });
      const compiledRules: FormulaRulesV2 = {
        type: 'formula',
        version: 2,
        primaryVariableId: body.rules.primaryVariableId,
        variables: analyses.map(({ variable, analysis }) => ({
          ...variable,
          languageVersion: 1,
          ast: analysis.ast!,
          outputType: analysis.outputType!,
          dependencies: analysis.dependencies,
        })),
      };
      const primary = primaryFormulaVariable(compiledRules);
      if (body.propertyId && draftCreatesCycle(body.propertyId, primary.ast, catalog.definitions))
        return json({
          diagnostics: [
            {
              code: 'formula_cycle',
              messageKey: 'formula_formula_cycle',
              severity: 'error',
              from: primary.ast.from,
              to: primary.ast.to,
            },
          ],
          outputType: primary.outputType,
          dependencies: primary.dependencies,
          variables: variableAnalyses,
          rows: [],
        });
      if (
        body.propertyId &&
        compiledRules.variables.some((variable) =>
          variable.dependencies.some((dependency) => dependency.id === body.propertyId),
        )
      )
        throw error(422, 'formula_cycle');
      if (body.presentation) {
        const outputs = new Map(
          compiledRules.variables.map((variable) => [variable.id, variable.outputType]),
        );
        const seen = new Set<string>();
        for (const entry of body.presentation.variables) {
          if (seen.has(entry.variableId)) throw error(422, 'invalid_presentation');
          seen.add(entry.variableId);
          const output = outputs.get(entry.variableId);
          if (!output) throw error(422, 'presentation_variable_invalid');
          if (output.kind !== 'number' && (entry.number !== null || entry.tone !== 'none'))
            throw error(422, 'presentation_incompatible');
          if (
            output.kind === 'number' &&
            entry.number &&
            ((entry.number.style === 'currency' && output.dimension !== 'money') ||
              (output.dimension === 'money' && !['auto', 'currency'].includes(entry.number.style)))
          )
            throw error(422, 'presentation_incompatible');
        }
      }
      const previewDefinition: CustomPropertyDefinition = {
        id: body.propertyId ?? '00000000-0000-4000-8000-000000000000',
        tableId: body.tableId,
        label: 'Preview',
        description: null,
        type: 'formula',
        rules: compiledRules,
        hasDefault: false,
        defaultValue: null,
        presentation: body.presentation ?? null,
        version: 0,
        archivedAt: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      const customValues = await readCustomPropertyValues(
        ctx,
        body.tableId,
        recordIds,
        catalog.definitions,
      );
      const inputs = await loadFormulaInputs(ctx, body.tableId, recordIds, customValues);
      const required = new Set(
        compiledRules.variables.flatMap((variable) =>
          variable.dependencies.filter(({ source }) => source === 'formula').map(({ id }) => id),
        ),
      );
      let added = true;
      while (added) {
        added = false;
        for (const definition of catalog.definitions) {
          if (!required.has(definition.id) || definition.rules.type !== 'formula') continue;
          for (const dependency of formulaPrimaryDependencies(definition.rules))
            if (dependency.source === 'formula' && !required.has(dependency.id)) {
              required.add(dependency.id);
              added = true;
            }
        }
      }
      const prerequisiteFormulas = catalog.definitions.filter(
        (definition) => definition.rules.type === 'formula' && required.has(definition.id),
      );
      const evaluated = await evaluateFormulaDefinitions(
        ctx,
        [...prerequisiteFormulas, previewDefinition],
        [
          ...catalog.fields,
          {
            id: previewDefinition.id,
            label: previewDefinition.label,
            aliases: [],
            type: primary.outputType,
            nullable: primary.outputType.nullable,
            source: 'formula',
          },
        ],
        inputs,
        previewDefinition.id,
      );
      return json({
        diagnostics: primaryAnalysis.diagnostics,
        outputType: primary.outputType,
        dependencies: primary.dependencies,
        variables: variableAnalyses,
        rows: recordIds.flatMap((recordId) =>
          evaluated.previewRows[recordId] ? [evaluated.previewRows[recordId]] : [],
        ),
      });
    }
    const analysis = analyzeFormulaDraft(body.expression, catalog);
    if (analysis.diagnostics.length || !analysis.ast || !analysis.outputType)
      return json({ ...analysis, rows: [] });
    if (body.propertyId && draftCreatesCycle(body.propertyId, analysis.ast, catalog.definitions))
      return json({
        ...analysis,
        diagnostics: [
          {
            code: 'formula_cycle',
            messageKey: 'formula_formula_cycle',
            severity: 'error',
            from: analysis.ast.from,
            to: analysis.ast.to,
          },
        ],
        rows: [],
      });

    const previewRules = persistedFormulaRules(body.expression, analysis);
    const previewOutputType = primaryFormulaOutputType(previewRules);
    const previewDefinition: CustomPropertyDefinition = {
      id: body.propertyId ?? '00000000-0000-4000-8000-000000000000',
      tableId: body.tableId,
      label: 'Preview',
      description: null,
      type: 'formula',
      rules: previewRules,
      hasDefault: false,
      defaultValue: null,
      presentation: null,
      version: 0,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const customValues = await readCustomPropertyValues(
      ctx,
      body.tableId,
      recordIds,
      catalog.definitions,
    );
    const inputs = await loadFormulaInputs(ctx, body.tableId, recordIds, customValues);
    const availableFormulas = new Map(
      catalog.definitions
        .filter(
          (definition) =>
            definition.rules.type === 'formula' &&
            definition.id !== previewDefinition.id &&
            !catalog.unavailableDefinitionIds.has(definition.id),
        )
        .map((definition) => [definition.id, definition]),
    );
    const prerequisiteIds = new Set<string>();
    const addPrerequisite = (id: string): void => {
      if (prerequisiteIds.has(id)) return;
      const definition = availableFormulas.get(id);
      if (!definition || definition.rules.type !== 'formula') return;
      prerequisiteIds.add(id);
      for (const dependency of formulaPrimaryDependencies(definition.rules))
        if (dependency.source === 'formula') addPrerequisite(dependency.id);
    };
    for (const dependency of analysis.dependencies)
      if (dependency.source === 'formula') addPrerequisite(dependency.id);
    const prerequisiteFormulas = [...availableFormulas.values()].filter((definition) =>
      prerequisiteIds.has(definition.id),
    );
    const evaluated = await evaluateFormulaDefinitions(
      ctx,
      [...prerequisiteFormulas, previewDefinition],
      [
        ...catalog.fields,
        {
          id: previewDefinition.id,
          label: previewDefinition.label,
          aliases: [],
          type: previewOutputType,
          nullable: previewOutputType.nullable,
          source: 'formula',
        },
      ],
      inputs,
      previewDefinition.id,
    );

    let compareMargin = false;
    if (body.tableId === 'pos.catalog') {
      const template = analyzeFormulaDraft(
        'ROUND("Sale price" - "Estimated unit cost", 2)',
        catalog,
      );
      compareMargin =
        !!template.ast &&
        JSON.stringify(semanticAst(template.ast)) === JSON.stringify(semanticAst(analysis.ast));
    }
    const rows = recordIds
      .map((recordId) => {
        const row = evaluated.previewRows[recordId];
        if (!row) return null;
        if (compareMargin)
          row.nativeComparison = nativeMarginComparison(
            row.result.value,
            inputs[recordId][POS_FORMULA_SOURCE_IDS.nativeMargin],
          );
        return row;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    return json({
      diagnostics: analysis.diagnostics,
      outputType: analysis.outputType,
      dependencies: analysis.dependencies,
      rows,
    });
  } catch (cause) {
    return propertyApiError(cause);
  }
};
