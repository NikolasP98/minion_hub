// @vitest-environment happy-dom
import { afterAll, beforeAll, cleanup, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { page } from '$app/state';

vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: Harness } = await import('./DataTable.custom-edit.fixture.svelte');

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
    return this.tagName === 'TR' ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});

afterAll(() => vi.restoreAllMocks());

async function policy(canEdit: boolean, tableConfig: unknown = undefined) {
  page.data = { tableConfig };
  const view = render(Harness, { props: { canEdit } });
  await waitFor(() => expect(view.getByTestId('custom-policy')).toBeTruthy());
  const result = view.getByTestId('custom-policy').textContent;
  view.unmount();
  return result;
}

describe('DataTable custom cell edit policy', () => {
  it('allows a customEditable column when the table is editable', async () => {
    expect(await policy(true)).toBe('true');
  });

  it('denies a customEditable column when the table is read-only', async () => {
    expect(await policy(false)).toBe('false');
  });

  it('denies a customEditable column disabled by organization table config', async () => {
    expect(
      await policy(true, {
        'stock.items': { fields: { name: { editable: false } } },
      }),
    ).toBe('false');
  });
});
