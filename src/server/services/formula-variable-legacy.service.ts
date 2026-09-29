import { createHash } from 'node:crypto';
import type {
  CustomPropertyDefinition,
  LegacyFormulaEditorProjection,
} from '$lib/tables/custom-properties';
import type { ColumnPresentationV2 } from '$lib/tables/column-presentation';
import { primaryFormulaOutputType } from '$lib/tables/formula';

const PRIMARY_NAME = 'minion:formula-variable:primary:v1';
const secondaryName = (id: string) => `minion:formula-variable:legacy-secondary:${id}:v1`;

function uuidBytes(id: string): Buffer {
  return Buffer.from(id.replaceAll('-', ''), 'hex');
}

/** RFC 4122 UUIDv5 using the owning property UUID as namespace. */
export function legacyFormulaVariableId(propertyId: string, discriminator: string): string {
  const bytes = createHash('sha1')
    .update(Buffer.concat([uuidBytes(propertyId), Buffer.from(discriminator, 'utf8')]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function legacyPrimaryFormulaVariableId(propertyId: string): string {
  return legacyFormulaVariableId(propertyId, PRIMARY_NAME);
}

function baseName(label: string): string {
  return [...label.trim().normalize('NFKC')].slice(0, 40).join('') || 'Value';
}

function distinctNames(labels: string[]): string[] {
  const used = new Set<string>();
  return labels.map((label) => {
    const base = baseName(label);
    let value = base;
    let suffix = 2;
    while (used.has(value.toLocaleLowerCase('und'))) {
      const tail = ` ${suffix++}`;
      value = `${[...base].slice(0, 40 - tail.length).join('')}${tail}`;
    }
    used.add(value.toLocaleLowerCase('und'));
    return value;
  });
}

function quoteLabel(label: string): string {
  return `"${label.replaceAll('"', '""')}"`;
}

export function legacyFormulaEditorProjection(
  definition: CustomPropertyDefinition,
  allDefinitions: CustomPropertyDefinition[],
  restrictedDefinitionIds: ReadonlySet<string>,
  unavailableDefinitionIds: ReadonlySet<string>,
): LegacyFormulaEditorProjection | undefined {
  if (definition.rules.type !== 'formula' || 'version' in definition.rules) return undefined;
  const primaryId = legacyPrimaryFormulaVariableId(definition.id);
  const presentation = definition.presentation;
  if (!presentation || presentation.version !== 1 || !presentation.secondary)
    return {
      state: 'ready',
      sourceVersion: 1,
      rules: {
        type: 'formula',
        version: 2,
        primaryVariableId: primaryId,
        variables: [{ id: primaryId, name: null, expression: definition.rules.expression }],
      },
      presentation:
        presentation?.version === 1
          ? {
              version: 2,
              variables: [
                {
                  variableId: primaryId,
                  number: presentation.number,
                  tone: presentation.tone,
                  emphasis: 'normal',
                },
              ],
            }
          : null,
    };
  const secondaryId = presentation.secondary.propertyId;
  if (restrictedDefinitionIds.has(secondaryId))
    return {
      state: 'restricted',
      sourceVersion: 1,
      code: 'legacy_secondary_restricted',
      canClearLegacyPresentation: false,
    };
  const secondary = allDefinitions.find((candidate) => candidate.id === secondaryId);
  const code = !secondary
    ? 'legacy_secondary_unavailable'
    : secondary.archivedAt
      ? 'legacy_secondary_archived'
      : secondary.rules.type !== 'formula' ||
          primaryFormulaOutputType(secondary.rules).kind !== 'number'
        ? 'legacy_secondary_nonnumeric'
        : unavailableDefinitionIds.has(secondaryId)
          ? 'legacy_secondary_unavailable'
          : null;
  if (code)
    return {
      state: 'unavailable',
      sourceVersion: 1,
      code,
      canClearLegacyPresentation: true,
    };
  const auxiliaryId = legacyFormulaVariableId(definition.id, secondaryName(secondaryId));
  if (auxiliaryId === primaryId) throw new Error('legacy_formula_variable_identity_collision');
  const [primaryLabel, auxiliaryLabel] = distinctNames([definition.label, secondary!.label]);
  const adaptedPresentation: ColumnPresentationV2 = {
    version: 2,
    variables: [
      {
        variableId: primaryId,
        number: presentation.number,
        tone: presentation.tone,
        emphasis: 'normal',
      },
      {
        variableId: auxiliaryId,
        number: presentation.secondary.format,
        tone: 'none',
        emphasis: 'muted',
      },
    ],
  };
  return {
    state: 'ready',
    sourceVersion: 1,
    rules: {
      type: 'formula',
      version: 2,
      primaryVariableId: primaryId,
      variables: [
        { id: primaryId, name: primaryLabel, expression: definition.rules.expression },
        { id: auxiliaryId, name: auxiliaryLabel, expression: quoteLabel(secondary!.label) },
      ],
    },
    presentation: adaptedPresentation,
  };
}

export function projectLegacyFormulaEditors(
  definitions: CustomPropertyDefinition[],
  allDefinitions: CustomPropertyDefinition[],
  restrictedDefinitionIds: ReadonlySet<string>,
  unavailableDefinitionIds: ReadonlySet<string>,
): CustomPropertyDefinition[] {
  return definitions.map((definition) => {
    const canonical =
      allDefinitions.find((candidate) => candidate.id === definition.id) ?? definition;
    const formulaEditor = legacyFormulaEditorProjection(
      canonical,
      allDefinitions,
      restrictedDefinitionIds,
      unavailableDefinitionIds,
    );
    return formulaEditor ? { ...definition, formulaEditor } : definition;
  });
}
