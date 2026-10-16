// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import type { CrmTagBulkOperation } from '$lib/tags/crm-bulk-contract';
import { crmTagOperationKey } from '$lib/tags/crm-bulk-contract';

vi.mock('$app/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app/environment')>()),
  browser: true,
}));
const notices = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('$lib/state/ui/toast.svelte', () => ({
  toastSuccess: notices.success,
  toastWarning: notices.warning,
  toastError: notices.error,
}));
const { default: DataTable } = await import('./DataTable.svelte');
type Row = { id: string; name: string };
const Table = DataTable as Component<{
  data: Row[];
  columns: { key: string; label: string }[];
  getRowId: (row: Row) => string;
  selectable: boolean;
  variant: 'plain';
  tagScope: 'crm';
  tagsOf: (row: Row) => string[];
  onSaveComplete: () => Promise<void>;
}>;
const contact = '00000000-0000-4000-8000-000000000001';
const tag = '00000000-0000-4000-8000-000000000002';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mountCommand(reply: (operations: CrmTagBulkOperation[]) => Response) {
  const mutations: CrmTagBulkOperation[][] = [];
  const refresh = vi.fn(async () => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init) => {
      if (String(input) === '/api/tags?scope=crm') {
        return Response.json({ tags: [{ id: tag, name: 'Urgent', color: null }] });
      }
      if (String(input) === '/api/crm/contacts/tags/bulk') {
        const ops = (JSON.parse(String(init?.body)) as { operations: CrmTagBulkOperation[] })
          .operations;
        mutations.push(ops);
        return reply(ops);
      }
      throw new Error('Unexpected test transport');
    }),
  );
  render(Table, {
    props: {
      data: [{ id: contact, name: 'Synthetic contact' }],
      columns: [{ key: 'name', label: 'Name' }],
      getRowId: (row) => row.id,
      selectable: true,
      variant: 'plain',
      tagScope: 'crm',
      tagsOf: () => [],
      onSaveComplete: refresh,
    },
  });
  await fireEvent.click(screen.getByRole('checkbox', { name: /^select (?!all$)/i }));
  await fireEvent.click(await screen.findByRole('button', { name: /^tags$/i }));
  await fireEvent.click(await screen.findByRole('option', { name: /urgent/i }));
  const apply = screen.getByRole('button', { name: /^apply$/i });
  await waitFor(() => expect(apply.hasAttribute('disabled')).toBe(false));
  await fireEvent.click(apply);
  return { mutations, refresh, apply };
}

describe('CRM bulk tag acknowledgements in the actual table', () => {
  it('shows a saved-with-refresh warning and does not offer the committed write for retry', async () => {
    const { mutations, refresh } = await mountCommand((ops) =>
      Response.json({
        version: 1,
        cacheInvalidation: 'failed',
        results: ops.map((operation) => ({
          operation,
          operationKey: crmTagOperationKey(operation),
          disposition: 'completed',
        })),
      }),
    );
    await screen.findByText('Saved. Refreshing the latest view failed.');
    expect(notices.warning).toHaveBeenCalledOnce();
    expect(notices.success).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^retry$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^apply$/i }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mutations).toHaveLength(1);
  });

  it('keeps an invalid200 unresolved and sends another write only on explicit retry', async () => {
    const { mutations, refresh } = await mountCommand(() =>
      Response.json({ version: 1, results: [] }),
    );
    const retry = await screen.findByRole('button', { name: /^retry$/i });
    await screen.findByText(/only pending tag changes will be retried/i);
    expect(notices.error).toHaveBeenCalledWith(
      'Outcome unknown. Check the latest record before another edit.',
    );
    expect(notices.success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(mutations).toHaveLength(1);
    await fireEvent.click(retry);
    await waitFor(() => expect(mutations).toHaveLength(2));
    expect(mutations[1]).toEqual(mutations[0]);
  });
});
