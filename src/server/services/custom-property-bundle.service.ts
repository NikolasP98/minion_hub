import type { CoreCtx } from '$server/auth/core-ctx';
import type { CustomPropertyBundle } from '$lib/tables/custom-properties';
import { authorizeCustomPropertyRecords } from './custom-property-entities.service';
import { inspectCustomPropertyAccess } from './custom-properties-access';
import {
  CustomPropertyError,
  listCustomProperties,
  readCustomPropertyValues,
} from './custom-properties.service';
import {
  evaluateFormulaDefinitions,
  formulaInputsFromCustomValues,
  loadFormulaCatalog,
  loadFormulaInputs,
} from './formula-properties.service';
import type { FormulaRecordInputs } from './formula-properties.service';

/** Canonical page-loader/API bundle. Authorization precedes every definition/value read. */
export async function loadCustomPropertyBundle(
  locals: App.Locals,
  ctx: CoreCtx,
  tableId: string,
  requestedRecordIds: string[],
  options: {
    formulaNativeInputs?: FormulaRecordInputs;
  } = {},
): Promise<CustomPropertyBundle> {
  const caps = await inspectCustomPropertyAccess(locals, ctx, tableId, 'view');
  if (!caps)
    return { definitions: [], values: {}, recordAccess: {}, canManage: false, canEdit: false };
  const requested = [...new Set(requestedRecordIds)];
  const chunks: string[][] = [];
  for (let offset = 0; offset < requested.length; offset += 500)
    chunks.push(requested.slice(offset, offset + 500));
  const accessChunks = await Promise.all(
    chunks.map((ids) => authorizeCustomPropertyRecords(locals, ctx, tableId, ids, 'view')),
  );
  const recordAccess = Object.assign({}, ...accessChunks) as CustomPropertyBundle['recordAccess'];
  const recordIds = Object.keys(recordAccess);

  const valueChunks: string[][] = [];
  for (let offset = 0; offset < recordIds.length; offset += 500)
    valueChunks.push(recordIds.slice(offset, offset + 500));

  const fingerprint = (definitions: Awaited<ReturnType<typeof listCustomProperties>>) =>
    definitions
      .map(({ id, version, archivedAt }) => [id, version, archivedAt] as const)
      .sort(([left], [right]) => left.localeCompare(right));

  // A definition may be renamed, reconfigured, archived, or created between
  // the separate definition/value statements. Re-read its version snapshot
  // after evaluation and rebuild once so a page never combines values with a
  // different formula graph.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const allDefinitions = await listCustomProperties(ctx, tableId);
    const catalog = await loadFormulaCatalog(locals, ctx, tableId, allDefinitions);
    const definitions = catalog.definitions;
    const readChunks = await Promise.all(
      valueChunks.map((ids) => readCustomPropertyValues(ctx, tableId, ids, definitions)),
    );
    const values = Object.assign({}, ...readChunks) as CustomPropertyBundle['values'];
    const versions = new Map(definitions.map((definition) => [definition.id, definition.version]));
    for (const recordValues of Object.values(values)) {
      for (const cell of Object.values(recordValues)) {
        const definitionVersion = versions.get(cell.propertyId);
        if (definitionVersion !== undefined) cell.definitionVersion = definitionVersion;
      }
    }

    const formulas = definitions.filter(
      (definition) =>
        definition.rules.type === 'formula' && !catalog.unavailableDefinitionIds.has(definition.id),
    );
    const unavailableFormulas = definitions.filter(
      (definition) =>
        definition.rules.type === 'formula' && catalog.unavailableDefinitionIds.has(definition.id),
    );
    if (formulas.length) {
      const inputs = options.formulaNativeInputs
        ? formulaInputsFromCustomValues(recordIds, values)
        : await loadFormulaInputs(ctx, tableId, recordIds, values);
      for (const recordId of recordIds)
        Object.assign((inputs[recordId] ??= {}), options.formulaNativeInputs?.[recordId] ?? {});
      const evaluated = await evaluateFormulaDefinitions(ctx, formulas, catalog.fields, inputs);
      for (const recordId of recordIds)
        Object.assign((values[recordId] ??= {}), evaluated.cells[recordId] ?? {});
    }
    for (const recordId of recordIds) {
      for (const definition of unavailableFormulas) {
        if (definition.rules.type !== 'formula') continue;
        const currency =
          definition.rules.outputType.kind === 'number' &&
          definition.rules.outputType.dimension === 'money'
            ? definition.rules.outputType.currency
            : null;
        (values[recordId] ??= {})[definition.id] = {
          propertyId: definition.id,
          recordId,
          present: false,
          value: null,
          effectiveValue: null,
          version: 0,
          updatedAt: null,
          computed: true,
          definitionVersion: definition.version,
          formula: {
            quality: 'error',
            code: 'source_type_changed',
            currency,
            sourceUpdatedAt: null,
          },
        };
      }
    }

    const after = await listCustomProperties(ctx, tableId);
    if (JSON.stringify(fingerprint(allDefinitions)) === JSON.stringify(fingerprint(after)))
      return { definitions, values, recordAccess, ...caps };
  }

  throw new CustomPropertyError(409, 'definition_snapshot_changed');
}
