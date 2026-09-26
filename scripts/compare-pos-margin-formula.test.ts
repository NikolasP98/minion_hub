import { describe, expect, it } from 'vitest';
import {
  authorizeInChunks,
  formulaPrerequisites,
  parseOptions,
} from './compare-pos-margin-formula';
import type { CustomPropertyDefinition } from '../src/lib/tables/custom-properties';

function formula(id: string, dependencies: string[]): CustomPropertyDefinition {
  return {
    id,
    tableId: 'pos.catalog',
    label: id,
    description: null,
    type: 'formula',
    rules: {
      type: 'formula',
      expression: '1',
      languageVersion: 1,
      ast: { kind: 'literal', value: 1, valueType: 'number', from: 0, to: 1 },
      outputType: {
        kind: 'number',
        dimension: 'unitless',
        currency: null,
        basis: null,
        nullable: false,
      },
      dependencies: dependencies.map((dependency) => ({ id: dependency, source: 'formula' })),
    },
    hasDefault: false,
    defaultValue: null,
    version: 1,
    archivedAt: null,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
  };
}

describe('POS margin formula comparison arguments', () => {
  it('requires every organization and actor guard', () => {
    expect(() => parseOptions([])).toThrow('--org-id is required');
    expect(() => parseOptions(['--org-id', 'org'])).toThrow('--expected-org-slug is required');
    expect(() => parseOptions(['--org-id', 'org', '--expected-org-slug', 'slug'])).toThrow(
      '--actor-profile-id is required',
    );
  });

  it('returns the explicit read-only target', () => {
    expect(
      parseOptions([
        '--org-id',
        'org',
        '--expected-org-slug',
        'slug',
        '--actor-profile-id',
        'actor',
      ]),
    ).toEqual({ orgId: 'org', expectedOrgSlug: 'slug', actorProfileId: 'actor' });
  });

  it('evaluates only the target formula dependency closure', () => {
    const base = formula('base', []);
    const middle = formula('middle', ['base']);
    const target = formula('target', ['middle']);
    const unrelated = formula('unrelated', []);

    expect(
      formulaPrerequisites(target, [unrelated, target, middle, base]).map(({ id }) => id),
    ).toEqual(['base', 'middle']);
  });

  it('authorizes catalogs larger than the 500-record service boundary in chunks', async () => {
    const ids = Array.from({ length: 501 }, (_, index) => `record-${index}`);
    const calls: string[][] = [];
    const access = await authorizeInChunks(ids, async (chunk) => {
      calls.push(chunk);
      return Object.fromEntries(chunk.map((id) => [id, { canEdit: false }]));
    });

    expect(calls.map((chunk) => chunk.length)).toEqual([500, 1]);
    expect(Object.keys(access)).toHaveLength(501);
  });
});
