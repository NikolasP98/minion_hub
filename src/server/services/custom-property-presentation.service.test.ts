import { describe, expect, it } from 'vitest';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import { DEFAULT_COLUMN_PRESENTATION } from '$lib/tables/column-presentation';
import { projectCustomPropertyPresentations } from './custom-property-presentation.service';

const secondaryId = '00000000-0000-4000-8000-000000000002';
const definition = {
  id: '00000000-0000-4000-8000-000000000001',
  rules: { type: 'boolean' },
  presentation: {
    ...DEFAULT_COLUMN_PRESENTATION,
    secondary: { propertyId: secondaryId, format: DEFAULT_COLUMN_PRESENTATION.number },
  },
} as CustomPropertyDefinition;

describe('custom property presentation projection', () => {
  it('redacts a restricted secondary identity without mutating the canonical definition', () => {
    const [projected] = projectCustomPropertyPresentations([definition], new Set([secondaryId]));
    expect(projected).toMatchObject({
      presentation: { secondary: null },
      presentationRestricted: true,
    });
    expect(
      definition.presentation?.version === 1 ? definition.presentation.secondary?.propertyId : null,
    ).toBe(secondaryId);
  });

  it('preserves an authorized secondary presentation', () => {
    expect(projectCustomPropertyPresentations([definition], new Set())[0]).toBe(definition);
  });
});

it('redacts a restricted auxiliary variable and its formatting without exposing identity', () => {
  const primaryId = '00000000-0000-4000-8000-000000000010';
  const auxiliaryId = '00000000-0000-4000-8000-000000000011';
  const hiddenSource = '00000000-0000-4000-8000-000000000012';
  const numberType = {
    kind: 'number' as const,
    dimension: 'unitless' as const,
    currency: null,
    basis: null,
    nullable: false,
  };
  const literal = {
    kind: 'literal' as const,
    value: 1,
    valueType: 'number' as const,
    from: 0,
    to: 1,
  };
  const composite = {
    ...definition,
    rules: {
      type: 'formula' as const,
      version: 2 as const,
      primaryVariableId: primaryId,
      variables: [
        {
          id: primaryId,
          name: 'Primary',
          expression: '1',
          languageVersion: 1 as const,
          ast: literal,
          outputType: numberType,
          dependencies: [],
        },
        {
          id: auxiliaryId,
          name: 'Hidden',
          expression: '"Hidden"',
          languageVersion: 1 as const,
          ast: { kind: 'reference' as const, sourceId: hiddenSource, from: 0, to: 8 },
          outputType: numberType,
          dependencies: [{ id: hiddenSource, source: 'formula' as const }],
        },
      ],
    },
    presentation: {
      version: 2 as const,
      variables: [
        {
          variableId: primaryId,
          number: DEFAULT_COLUMN_PRESENTATION.number,
          tone: 'none' as const,
          emphasis: 'normal' as const,
        },
        {
          variableId: auxiliaryId,
          number: DEFAULT_COLUMN_PRESENTATION.number,
          tone: 'none' as const,
          emphasis: 'muted' as const,
        },
      ],
    },
  } satisfies CustomPropertyDefinition;
  const [projected] = projectCustomPropertyPresentations([composite], new Set([hiddenSource]));
  expect(projected.variablesRestricted).toBe(true);
  expect(projected.rules).toMatchObject({ variables: [{ id: primaryId }] });
  expect(projected.presentation).toMatchObject({ variables: [{ variableId: primaryId }] });
  expect(JSON.stringify(projected)).not.toContain(auxiliaryId);
  expect(JSON.stringify(projected)).not.toContain(hiddenSource);
});
