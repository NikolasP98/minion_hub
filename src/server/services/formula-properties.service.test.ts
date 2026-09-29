import { describe, it, expect } from 'vitest';
import { dependencyIds } from './formula-properties.service';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';

/** Minimal fixture — only the fields `dependencyIds` reads. */
function def(rules: CustomPropertyDefinition['rules']): CustomPropertyDefinition {
  return {
    id: 'p1',
    tableId: 'pos.catalog',
    label: 'Test',
    description: null,
    type: rules.type,
    rules,
    hasDefault: false,
    defaultValue: null,
    presentation: null,
    version: 1,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('dependencyIds', () => {
  it('returns [] for a non-formula definition', () => {
    expect(dependencyIds(def({ type: 'boolean' }))).toEqual([]);
  });

  it('returns the V1 dependency list', () => {
    const rules = {
      type: 'formula' as const,
      expression: '1',
      languageVersion: 1 as const,
      ast: { kind: 'literal', value: 1, valueType: 'number', from: 0, to: 1 } as never,
      outputType: {
        kind: 'number',
        dimension: 'unitless',
        currency: null,
        basis: null,
        nullable: false,
      } as never,
      dependencies: [{ id: 'native:x', source: 'native' as const }],
    };
    expect(dependencyIds(def(rules))).toEqual([{ id: 'native:x', source: 'native' }]);
  });

  it('never throws and returns [] for a legacy V1 shape missing `dependencies` (spec Bundle F #9)', () => {
    const rules = {
      type: 'formula' as const,
      expression: '1',
      languageVersion: 1 as const,
      ast: { kind: 'literal', value: 1, valueType: 'number', from: 0, to: 1 } as never,
      outputType: {
        kind: 'number',
        dimension: 'unitless',
        currency: null,
        basis: null,
        nullable: false,
      } as never,
      // `dependencies` intentionally absent — a legacy/malformed row shape.
    } as unknown as CustomPropertyDefinition['rules'];
    expect(() => dependencyIds(def(rules))).not.toThrow();
    expect(dependencyIds(def(rules))).toEqual([]);
  });

  it('never throws and returns [] for a V2 shape whose variable is missing `dependencies`', () => {
    const rules = {
      type: 'formula' as const,
      version: 2 as const,
      primaryVariableId: 'v1',
      variables: [
        {
          id: 'v1',
          name: null,
          expression: '1',
          languageVersion: 1 as const,
          ast: { kind: 'literal', value: 1, valueType: 'number', from: 0, to: 1 } as never,
          outputType: {
            kind: 'number',
            dimension: 'unitless',
            currency: null,
            basis: null,
            nullable: false,
          } as never,
          // `dependencies` intentionally absent.
        },
      ],
    } as unknown as CustomPropertyDefinition['rules'];
    expect(() => dependencyIds(def(rules))).not.toThrow();
    expect(dependencyIds(def(rules))).toEqual([]);
  });
});
