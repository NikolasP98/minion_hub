// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomPropertyCell from './CustomPropertyCell.svelte';
import type {
  CustomPropertyDefinition,
  CustomPropertyValueCell,
} from '$lib/tables/custom-properties';

afterEach(cleanup);

const definition: CustomPropertyDefinition = {
  id: '10000000-0000-4000-8000-000000000001',
  tableId: 'stock.items',
  label: 'Note',
  description: null,
  type: 'text',
  rules: { type: 'text', maxLength: 100 },
  hasDefault: false,
  defaultValue: null,
  presentation: null,
  version: 1,
  archivedAt: null,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
};
const cell: CustomPropertyValueCell = {
  propertyId: definition.id,
  recordId: 'record-1',
  present: true,
  value: 'Before',
  effectiveValue: 'Before',
  version: 2,
  updatedAt: '2026-09-26T00:00:00.000Z',
};

function presentedFormulaDefinition(): CustomPropertyDefinition {
  return {
    ...definition,
    label: 'Margin copy',
    type: 'formula',
    rules: {
      type: 'formula',
      expression: '120',
      languageVersion: 1,
      ast: { kind: 'literal', value: 120, valueType: 'number', from: 0, to: 3 },
      outputType: {
        kind: 'number',
        dimension: 'money',
        currency: 'PEN',
        basis: null,
        nullable: true,
      },
      dependencies: [],
    },
    presentation: {
      version: 1,
      number: {
        style: 'currency',
        decimals: 2,
        currencyDisplay: 'symbol',
        percentScale: 'whole',
      },
      tone: 'sign',
      secondary: {
        propertyId: '20000000-0000-4000-8000-000000000002',
        format: {
          style: 'percent',
          decimals: 1,
          currencyDisplay: 'symbol',
          percentScale: 'ratio',
        },
      },
    },
  };
}

function legacySecondaryId(definition: CustomPropertyDefinition): string {
  if (
    !definition.presentation ||
    definition.presentation.version !== 1 ||
    !definition.presentation.secondary
  )
    throw new Error('legacy secondary required');
  return definition.presentation.secondary.propertyId;
}

function computedCell(
  definition: CustomPropertyDefinition,
  value: number | null,
  quality: 'valid' | 'blank' | 'partial' | 'restricted' | 'error',
  code: string | null = null,
): CustomPropertyValueCell {
  return {
    ...cell,
    propertyId: definition.id,
    value,
    effectiveValue: value,
    computed: true,
    definitionVersion: definition.version,
    formula: { quality, code, currency: 'PEN', sourceUpdatedAt: cell.updatedAt },
  };
}

describe('CustomPropertyCell', () => {
  it('renders formula variables in configured order with one partial warning and one blank placeholder', async () => {
    const primaryId = '30000000-0000-4000-8000-000000000001';
    const secondaryId = '30000000-0000-4000-8000-000000000002';
    const variableDefinition: CustomPropertyDefinition = {
      ...definition,
      type: 'formula',
      rules: {
        type: 'formula',
        version: 2,
        primaryVariableId: primaryId,
        variables: [
          {
            id: primaryId,
            name: 'Amount',
            expression: '55',
            languageVersion: 1,
            ast: { kind: 'literal', value: 55, valueType: 'number', from: 0, to: 2 },
            outputType: {
              kind: 'number',
              dimension: 'money',
              currency: 'PEN',
              basis: null,
              nullable: false,
            },
            dependencies: [],
          },
          {
            id: secondaryId,
            name: 'Margin',
            expression: '1',
            languageVersion: 1,
            ast: { kind: 'literal', value: 1, valueType: 'number', from: 0, to: 1 },
            outputType: {
              kind: 'number',
              dimension: 'percent',
              currency: null,
              basis: 'ratio',
              nullable: false,
            },
            dependencies: [],
          },
        ],
      },
      presentation: {
        version: 2,
        variables: [
          {
            variableId: primaryId,
            number: {
              style: 'currency',
              decimals: 2,
              currencyDisplay: 'symbol',
              percentScale: 'whole',
            },
            tone: 'sign',
            emphasis: 'normal',
          },
          {
            variableId: secondaryId,
            number: {
              style: 'percent',
              decimals: 1,
              currencyDisplay: 'symbol',
              percentScale: 'ratio',
            },
            tone: 'none',
            emphasis: 'muted',
          },
        ],
      },
    };
    const variableCell: CustomPropertyValueCell = {
      ...cell,
      propertyId: variableDefinition.id,
      value: 55,
      effectiveValue: 55,
      computed: true,
      formula: {
        quality: 'partial',
        code: 'partial_dependency',
        currency: 'PEN',
        sourceUpdatedAt: cell.updatedAt,
      },
      formulaVariables: [
        {
          variableId: secondaryId,
          name: 'Margin',
          value: 1,
          formula: {
            quality: 'partial',
            code: 'partial_dependency',
            currency: null,
            sourceUpdatedAt: cell.updatedAt,
          },
        },
        {
          variableId: primaryId,
          name: 'Amount',
          value: 55,
          formula: {
            quality: 'partial',
            code: 'partial_dependency',
            currency: 'PEN',
            sourceUpdatedAt: cell.updatedAt,
          },
        },
      ],
    };

    const { container, rerender } = render(CustomPropertyCell, {
      props: {
        definition: variableDefinition,
        cell: variableCell,
        recordId: cell.recordId,
        canEdit: false,
        actions: { save: vi.fn(), read: vi.fn() },
        onconfirmed: vi.fn(),
      },
    });

    expect(container.textContent).toMatch(/55\.00.*100\.0%/s);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(container.querySelector('.tone-positive')).toBeNull();

    await rerender({
      definition: variableDefinition,
      cell: {
        ...variableCell,
        formulaVariables: variableCell.formulaVariables?.map((entry) => ({
          ...entry,
          value: null,
          formula: { ...entry.formula, quality: 'blank' as const, code: null },
        })),
      },
      recordId: cell.recordId,
      canEdit: false,
      actions: { save: vi.fn(), read: vi.fn() },
      onconfirmed: vi.fn(),
    });
    expect(container.textContent?.trim()).toBe('—');
  });
  it('preserves the rejected draft and retries that intent', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce({
        cell: { ...cell, value: 'After', effectiveValue: 'After', version: 3 },
        refreshFailed: false,
      });
    const onconfirmed = vi.fn();
    const read = vi.fn().mockResolvedValue(cell);
    render(CustomPropertyCell, {
      props: {
        definition,
        cell,
        recordId: cell.recordId,
        canEdit: true,
        actions: { save, read },
        onconfirmed,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: /Before/i }));
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'After' } });
    await fireEvent.click(screen.getByRole('button', { name: /Save|Guardar/i }));
    await screen.findByRole('button', { name: /Retry|Reintentar/i });
    await fireEvent.click(screen.getByRole('button', { name: /Retry|Reintentar/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls.map((call) => call[2])).toEqual(['After', 'After']);
    expect(onconfirmed).toHaveBeenCalledWith(expect.objectContaining({ value: 'After' }));
  });

  it('clears a stored single-select value explicitly', async () => {
    const selectDefinition: CustomPropertyDefinition = {
      ...definition,
      type: 'select',
      rules: {
        type: 'select',
        options: [
          {
            id: '20000000-0000-4000-8000-000000000001',
            label: 'Blue',
            color: '#3b82f6',
            archivedAt: null,
          },
        ],
      },
    };
    const selectCell: CustomPropertyValueCell = {
      ...cell,
      propertyId: selectDefinition.id,
      value: '20000000-0000-4000-8000-000000000001',
      effectiveValue: '20000000-0000-4000-8000-000000000001',
    };
    const cleared = { ...selectCell, value: null, effectiveValue: null, version: 3 };
    const save = vi.fn().mockResolvedValue({ cell: cleared, refreshFailed: false });
    render(CustomPropertyCell, {
      props: {
        definition: selectDefinition,
        cell: selectCell,
        recordId: selectCell.recordId,
        canEdit: true,
        actions: { save, read: vi.fn() },
        onconfirmed: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: /Blue/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Clear value|Borrar valor/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(selectDefinition, selectCell.recordId, null, 2),
    );
  });

  it('renders calculated values without exposing an editor or value write', () => {
    const formulaDefinition: CustomPropertyDefinition = {
      ...definition,
      label: 'Margin copy',
      type: 'formula',
      rules: {
        type: 'formula',
        expression: 'ROUND("Sale price" - "Estimated unit cost", 2)',
        languageVersion: 1,
        ast: { kind: 'literal', value: 12.5, valueType: 'number', from: 0, to: 4 },
        outputType: {
          kind: 'number',
          dimension: 'money',
          currency: 'PEN',
          basis: null,
          nullable: false,
        },
        dependencies: [],
      },
      presentation: {
        version: 1,
        number: {
          style: 'currency',
          decimals: 2,
          currencyDisplay: 'symbol',
          percentScale: 'whole',
        },
        tone: 'sign',
        secondary: null,
      },
    };
    const formulaCell: CustomPropertyValueCell = {
      ...cell,
      propertyId: formulaDefinition.id,
      value: 12.5,
      effectiveValue: 12.5,
      computed: true,
      definitionVersion: 1,
      formula: {
        quality: 'valid',
        code: null,
        currency: 'PEN',
        sourceUpdatedAt: cell.updatedAt,
      },
    };
    const save = vi.fn();

    render(CustomPropertyCell, {
      props: {
        definition: formulaDefinition,
        cell: formulaCell,
        recordId: formulaCell.recordId,
        canEdit: true,
        actions: { save, read: vi.fn() },
        onconfirmed: vi.fn(),
      },
    });

    expect(screen.getByText(/S\/|PEN|12/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('fails closed when configured money has no currency and qualifies secondary partial state', () => {
    const formulaDefinition: CustomPropertyDefinition = {
      ...definition,
      type: 'formula',
      presentation: {
        version: 1,
        number: {
          style: 'currency',
          decimals: 2,
          currencyDisplay: 'symbol',
          percentScale: 'whole',
        },
        tone: 'sign',
        secondary: {
          propertyId: '20000000-0000-4000-8000-000000000002',
          format: {
            style: 'percent',
            decimals: 1,
            currencyDisplay: 'symbol',
            percentScale: 'ratio',
          },
        },
      },
      rules: {
        type: 'formula',
        expression: '1',
        languageVersion: 1,
        ast: { kind: 'literal', value: 1, valueType: 'number', from: 0, to: 1 },
        outputType: {
          kind: 'number',
          dimension: 'money',
          currency: null,
          basis: null,
          nullable: false,
        },
        dependencies: [],
      },
    };
    const secondaryDefinition: CustomPropertyDefinition = {
      ...formulaDefinition,
      id: legacySecondaryId(formulaDefinition),
      label: 'Margin %',
      presentation: null,
      rules: {
        type: 'formula',
        expression: '0.15',
        languageVersion: 1,
        ast: { kind: 'literal', value: 0.15, valueType: 'number', from: 0, to: 4 },
        outputType: {
          kind: 'number',
          dimension: 'percent',
          currency: null,
          basis: null,
          nullable: true,
        },
        dependencies: [],
      },
    };
    const primaryCell = {
      ...cell,
      effectiveValue: 15,
      value: 15,
      computed: true as const,
      definitionVersion: 1,
      formula: {
        quality: 'valid' as const,
        code: null,
        currency: null,
        sourceUpdatedAt: cell.updatedAt,
      },
    };
    const secondaryCell = {
      ...primaryCell,
      propertyId: secondaryDefinition.id,
      effectiveValue: 0.15,
      value: 0.15,
      formula: { ...primaryCell.formula, quality: 'partial' as const },
    };
    render(CustomPropertyCell, {
      props: {
        definition: formulaDefinition,
        cell: primaryCell,
        secondaryDefinition,
        secondaryCell,
        recordId: cell.recordId,
        canEdit: false,
        actions: { save: vi.fn(), read: vi.fn() },
        onconfirmed: vi.fn(),
      },
    });
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('keeps partial primary and secondary numbers visible with one accessible warning', async () => {
    const primary = presentedFormulaDefinition();
    const secondary: CustomPropertyDefinition = {
      ...primary,
      id: legacySecondaryId(primary),
      label: 'Margin %',
      presentation: null,
      rules: {
        type: 'formula',
        expression: '0.6',
        languageVersion: 1,
        ast: { kind: 'literal', value: 0.6, valueType: 'number', from: 0, to: 3 },
        outputType: {
          kind: 'number',
          dimension: 'percent',
          currency: null,
          basis: null,
          nullable: true,
        },
        dependencies: [],
      },
    };
    render(CustomPropertyCell, {
      props: {
        definition: primary,
        cell: computedCell(primary, 120, 'partial'),
        secondaryDefinition: secondary,
        secondaryCell: computedCell(secondary, 0.6, 'partial'),
        recordId: cell.recordId,
        canEdit: false,
        actions: { save: vi.fn(), read: vi.fn() },
        onconfirmed: vi.fn(),
      },
    });
    expect(screen.getByText(/S\/\s*120\.00/)).toBeTruthy();
    expect(screen.getByText('60.0%')).toBeTruthy();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByText(/^Partial$|^Parcial$/i)).toBeNull();
    const warning = screen.getByRole('status', { name: /incomplete source|origen incompletos/i });
    await fireEvent.pointerEnter(warning);
    await fireEvent.pointerMove(warning);
    expect(await screen.findByText(/Calculated from incomplete|Calculado con datos/i)).toBeTruthy();
  });

  it('preserves the legacy partial label when no presentation is configured', () => {
    const legacy = { ...presentedFormulaDefinition(), presentation: null };
    render(CustomPropertyCell, {
      props: {
        definition: legacy,
        cell: computedCell(legacy, 120, 'partial', 'partial_dependency'),
        recordId: cell.recordId,
        canEdit: false,
        actions: { save: vi.fn(), read: vi.fn() },
        onconfirmed: vi.fn(),
      },
    });
    expect(screen.getByText(/^Partial$|^Parcial$/i)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a numeric partial secondary beside a valid primary without duplicate text', () => {
    const primary = presentedFormulaDefinition();
    const secondary = {
      ...primary,
      id: legacySecondaryId(primary),
      presentation: null,
    };
    render(CustomPropertyCell, {
      props: {
        definition: primary,
        cell: computedCell(primary, 120, 'valid'),
        secondaryDefinition: secondary,
        secondaryCell: computedCell(secondary, 0.6, 'partial'),
        recordId: cell.recordId,
        canEdit: false,
        actions: { save: vi.fn(), read: vi.fn() },
        onconfirmed: vi.fn(),
      },
    });
    expect(screen.getByText('60.0%')).toBeTruthy();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('suppresses the redundant secondary placeholder when both results are blank', () => {
    const primary = presentedFormulaDefinition();
    const secondary = {
      ...primary,
      id: legacySecondaryId(primary),
      presentation: null,
    };
    render(CustomPropertyCell, {
      props: {
        definition: primary,
        cell: computedCell(primary, null, 'blank'),
        secondaryDefinition: secondary,
        secondaryCell: computedCell(secondary, null, 'blank'),
        recordId: cell.recordId,
        canEdit: false,
        actions: { save: vi.fn(), read: vi.fn() },
        onconfirmed: vi.fn(),
      },
    });
    expect(screen.getAllByText('—')).toHaveLength(1);
  });

  it('preserves explicit error and restricted secondary states', () => {
    const primary = presentedFormulaDefinition();
    const secondary = {
      ...primary,
      id: legacySecondaryId(primary),
      presentation: null,
    };
    render(CustomPropertyCell, {
      props: {
        definition: primary,
        cell: computedCell(primary, null, 'error', 'division_by_zero'),
        secondaryDefinition: secondary,
        secondaryCell: computedCell(secondary, null, 'restricted', 'restricted'),
        recordId: cell.recordId,
        canEdit: false,
        actions: { save: vi.fn(), read: vi.fn() },
        onconfirmed: vi.fn(),
      },
    });
    expect(screen.getByText(/divides|divide|división/i)).toBeTruthy();
    expect(screen.getByText(/access|required source|acceso|fuente/i)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
