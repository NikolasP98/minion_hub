import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: vi.fn(async (_ctx, callback) => callback({ execute: mocks.execute })),
}));
vi.mock('./rbac.service', () => ({ shouldMaskSensitive: vi.fn() }));
vi.mock('./finance.service', () => ({ getFinSettings: vi.fn() }));
vi.mock('./pos.service', () => ({ listSellables: vi.fn() }));
vi.mock('./item-cost.service', () => ({ costForProducts: vi.fn() }));

import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import { FORMULA_VARIABLE_EVALUATIONS_PER_STATEMENT_MAX } from '$lib/tables/formula';
import { evaluateFormulaDefinitions, type FormulaRecordInputs } from './formula-properties.service';

describe('formula variable evaluation statement budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue([]);
  });

  it('splits 501 record-variable evaluations into two SQL statements', async () => {
    const variableId = '00000000-0000-4000-8000-000000000001';
    const definition = {
      id: '00000000-0000-4000-8000-000000000002',
      tableId: 'stock.items',
      label: 'Bounded formula',
      description: null,
      type: 'formula',
      rules: {
        type: 'formula',
        version: 2,
        primaryVariableId: variableId,
        variables: [
          {
            id: variableId,
            name: null,
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
            dependencies: [],
          },
        ],
      },
      hasDefault: false,
      defaultValue: null,
      presentation: null,
      version: 1,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    } satisfies CustomPropertyDefinition;
    const inputs = Object.fromEntries(
      Array.from({ length: FORMULA_VARIABLE_EVALUATIONS_PER_STATEMENT_MAX + 1 }, (_, index) => [
        `record-${index}`,
        {},
      ]),
    ) as FormulaRecordInputs;

    await evaluateFormulaDefinitions(
      { tenantId: 'org', profileId: 'profile', db: {} } as never,
      [definition],
      [],
      inputs,
    );

    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
