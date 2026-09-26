// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomPropertyCell from './CustomPropertyCell.svelte';
import type { CustomPropertyDefinition, CustomPropertyValueCell } from '$lib/tables/custom-properties';

afterEach(cleanup);

const definition: CustomPropertyDefinition = {
  id: '10000000-0000-4000-8000-000000000001', tableId: 'stock.items', label: 'Note', description: null,
  type: 'text', rules: { type: 'text', maxLength: 100 }, hasDefault: false, defaultValue: null,
  version: 1, archivedAt: null, createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
};
const cell: CustomPropertyValueCell = {
  propertyId: definition.id, recordId: 'record-1', present: true, value: 'Before', effectiveValue: 'Before', version: 2, updatedAt: '2026-09-26T00:00:00.000Z',
};

describe('CustomPropertyCell', () => {
  it('preserves the rejected draft and retries that intent', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({
      cell: { ...cell, value: 'After', effectiveValue: 'After', version: 3 }, refreshFailed: false,
    });
    const onconfirmed = vi.fn();
    const read = vi.fn().mockResolvedValue(cell);
    render(CustomPropertyCell, { props: { definition, cell, recordId: cell.recordId, canEdit: true, actions: { save, read }, onconfirmed } });

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
    await waitFor(() => expect(save).toHaveBeenCalledWith(selectDefinition, selectCell.recordId, null, 2));
  });
});
