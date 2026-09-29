// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomPropertyHttpError } from './api';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';

vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: CustomPropertyManager } = await import('./CustomPropertyManager.svelte');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const existing: CustomPropertyDefinition = {
  id: '10000000-0000-4000-8000-000000000001',
  tableId: 'stock.items',
  label: 'Duplicate',
  description: null,
  type: 'text',
  rules: { type: 'text', maxLength: null },
  hasDefault: false,
  defaultValue: null,
  presentation: null,
  version: 1,
  archivedAt: null,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
};
const legacyVariableId = '10000000-0000-4000-8000-000000000011';
const formulaDefinition: CustomPropertyDefinition = {
  ...existing,
  id: '10000000-0000-4000-8000-000000000010',
  label: 'Margin copy',
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
    dependencies: [],
  },
  presentation: {
    version: 1,
    number: { style: 'decimal', decimals: 2, currencyDisplay: 'symbol', percentScale: 'whole' },
    tone: 'none',
    secondary: null,
  },
  formulaEditor: {
    state: 'ready',
    sourceVersion: 1,
    rules: {
      type: 'formula',
      version: 2,
      primaryVariableId: legacyVariableId,
      variables: [{ id: legacyVariableId, name: null, expression: '1' }],
    },
    presentation: {
      version: 2,
      variables: [
        {
          variableId: legacyVariableId,
          number: {
            style: 'decimal',
            decimals: 2,
            currencyDisplay: 'symbol',
            percentScale: 'whole',
          },
          tone: 'none',
          emphasis: 'normal',
        },
      ],
    },
  },
};

function formulaCatalogFetch(...revisions: string[]) {
  let index = 0;
  const values = revisions.length ? revisions : ['catalog-v1'];
  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          fields: [],
          functions: [],
          canManage: true,
          revision: values[Math.min(index++, values.length - 1)],
        }),
        { status: 200 },
      ),
    ),
  );
}

describe('CustomPropertyManager', () => {
  it('preserves restricted formula variables during metadata-only edits', async () => {
    const restricted: CustomPropertyDefinition = {
      ...formulaDefinition,
      variablesRestricted: true,
      presentationRestricted: true,
      formulaEditor: {
        state: 'restricted',
        sourceVersion: 1,
        code: 'legacy_secondary_restricted',
        canClearLegacyPresentation: false,
      },
    };
    const update = vi.fn().mockResolvedValue({ ...restricted, label: 'Renamed', version: 2 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(CustomPropertyManager, {
      props: {
        open: true,
        scopeKey: 'org-1:stock.items',
        tableId: 'stock.items',
        definitions: [restricted],
        canManage: true,
        selectedId: restricted.id,
        actions: { list: vi.fn(), create: vi.fn(), update, lifecycle: vi.fn() },
        onchanged: vi.fn(),
        onloaded: vi.fn(),
        isScopeCurrent: () => true,
        onreload: vi.fn(),
      },
    });

    const name = await screen.findByLabelText(/Column name|Nombre de la columna/i);
    await fireEvent.input(name, { target: { value: 'Renamed' } });
    const save = screen.getByRole('button', { name: /^Save$|^Guardar$/i });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(save);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const payload = update.mock.calls[0][1];
    expect(payload.label).toBe('Renamed');
    expect(payload).not.toHaveProperty('rules');
    expect(payload).not.toHaveProperty('presentation');
    expect(payload).not.toHaveProperty('catalogRevision');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers a clear-only repair for an unavailable legacy related value', async () => {
    const unavailable: CustomPropertyDefinition = {
      ...formulaDefinition,
      formulaEditor: {
        state: 'unavailable',
        sourceVersion: 1,
        code: 'legacy_secondary_archived',
        canClearLegacyPresentation: true,
      },
    };
    const update = vi.fn().mockResolvedValue({ ...unavailable, presentation: null, version: 2 });
    vi.stubGlobal('fetch', formulaCatalogFetch());
    render(CustomPropertyManager, {
      props: {
        open: true,
        scopeKey: 'org-1:stock.items',
        tableId: 'stock.items',
        definitions: [unavailable],
        canManage: true,
        selectedId: unavailable.id,
        actions: { list: vi.fn(), create: vi.fn(), update, lifecycle: vi.fn() },
        onchanged: vi.fn(),
        onloaded: vi.fn(),
        isScopeCurrent: () => true,
        onreload: vi.fn(),
      },
    });

    const clear = await screen.findByRole('button', {
      name: /Clear old related formatting|Borrar formato relacionado anterior/i,
    });
    await waitFor(() => expect((clear as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(clear);
    await fireEvent.click(screen.getByRole('button', { name: /^Save$|^Guardar$/i }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({
      presentation: null,
      catalogRevision: 'catalog-v1',
    });
    expect(update.mock.calls[0][1]).not.toHaveProperty('rules');
  });

  it('keeps a conflicting create draft instead of treating an existing match as success', async () => {
    const onchanged = vi.fn();
    render(CustomPropertyManager, {
      props: {
        open: true,
        scopeKey: 'org-1:stock.items',
        tableId: 'stock.items',
        definitions: [],
        canManage: true,
        loadFailed: false,
        createOnOpen: true,
        actions: {
          list: vi.fn().mockResolvedValue([existing]),
          create: vi.fn().mockRejectedValue(new CustomPropertyHttpError(409, 'duplicate_label')),
          update: vi.fn(),
          lifecycle: vi.fn(),
        },
        onchanged,
        onloaded: vi.fn(),
        isScopeCurrent: () => true,
        onreload: vi.fn(),
      },
    });

    const name = await screen.findByLabelText(/Column name|Nombre de la columna/i);
    await fireEvent.input(name, { target: { value: 'Duplicate' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Save$|^Guardar$/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /changed elsewhere|cambió en otra sesión/i,
    );
    expect((name as HTMLInputElement).value).toBe('Duplicate');
    expect(onchanged).not.toHaveBeenCalled();
  });

  it('shows formula diagnostics and disables save until the draft is valid', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ fields: [], functions: [], canManage: true, revision: 'catalog-v1' }),
            { status: 200 },
          ),
        ),
    );
    render(CustomPropertyManager, {
      props: {
        open: true,
        scopeKey: 'org-1:stock.items',
        tableId: 'stock.items',
        definitions: [],
        canManage: true,
        createOnOpen: true,
        actions: {
          list: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          lifecycle: vi.fn(),
        },
        onchanged: vi.fn(),
        onloaded: vi.fn(),
        isScopeCurrent: () => true,
        onreload: vi.fn(),
      },
    });

    await fireEvent.change(await screen.findByLabelText(/^Type$|^Tipo$/i), {
      target: { value: 'formula' },
    });

    const save = screen.getByRole('button', { name: /^Save$|^Guardar$/i });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /syntax|sintaxis|field|campo|formula|fórmula/i,
    );
  });

  it('sends presentation-only changes without reparsing rules and blocks invalid precision', async () => {
    const fetchMock = formulaCatalogFetch('catalog-v1', 'catalog-v2');
    vi.stubGlobal('fetch', fetchMock);
    const update = vi
      .fn()
      .mockImplementation(async (_base, input) => ({ ...formulaDefinition, ...input, version: 2 }));
    render(CustomPropertyManager, {
      props: {
        open: true,
        scopeKey: 'org-1:stock.items',
        tableId: 'stock.items',
        definitions: [formulaDefinition],
        canManage: true,
        selectedId: formulaDefinition.id,
        actions: { list: vi.fn(), create: vi.fn(), update, lifecycle: vi.fn() },
        onchanged: vi.fn(),
        onloaded: vi.fn(),
        isScopeCurrent: () => true,
        onreload: vi.fn(),
      },
    });
    const decimals = await screen.findByLabelText(/Decimal places|Decimales/i);
    await fireEvent.input(decimals, { target: { value: '7' } });
    const save = screen.getByRole('button', { name: /^Save$|^Guardar$/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.input(decimals, { target: { value: '1' } });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(save);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const payload = update.mock.calls[0][1];
    expect(payload.rules).toBeUndefined();
    expect(payload.catalogRevision).toBe('catalog-v1');
    expect(payload.presentation.variables[0].number.decimals).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByRole('button', { name: /^Edit$|^Editar$/i }));
    const reopenedDecimals = await screen.findByLabelText(/Decimal places|Decimales/i);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await fireEvent.input(reopenedDecimals, { target: { value: '3' } });
    const reopenedSave = screen.getByRole('button', { name: /^Save$|^Guardar$/i });
    await waitFor(() => expect((reopenedSave as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(reopenedSave);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toMatchObject({ catalogRevision: 'catalog-v2' });
  });
});
