import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bulkLinkTags, planTagBulkOperations, retryTagBulkOperations } from './tag-bulk';

describe('bulk tag command outcomes', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('retains the atomic plan when the bulk endpoint rejects it', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const outcome = await bulkLinkTags('stock', ['i1'], ['t1'], ['t2']);
    expect(outcome.status).toBe('failed');
    expect(outcome.completed).toEqual([]);
    expect(outcome.pending).toEqual([
      { targetId: 'i1', tagId: 't1', action: 'add' },
      { targetId: 'i1', tagId: 't2', action: 'remove' },
    ]);
  });

  it('treats every rejected fetch as transport-unknown regardless of error class', async () => {
    fetchMock.mockRejectedValue(new Error('socket closed after dispatch'));
    const outcome = await bulkLinkTags('stock', ['i1'], ['t1'], []);
    expect(outcome.status).toBe('unknown');
    expect(outcome.pending).toEqual([{ targetId: 'i1', tagId: 't1', action: 'add' }]);
  });

  it('groups an arbitrary atomic repair without adding target-tag pairs', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const operations = [
      { targetId: 'i1', tagId: 't1', action: 'add' as const },
      { targetId: 'i2', tagId: 't2', action: 'add' as const },
    ];

    const outcome = await retryTagBulkOperations('stock', operations);

    expect(outcome.status).toBe('succeeded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toEqual(
      expect.arrayContaining([
        {
          scope: 'stock',
          add: ['t1'],
          remove: [],
          targets: [{ type: 'item', id: 'i1' }],
        },
        {
          scope: 'stock',
          add: ['t2'],
          remove: [],
          targets: [{ type: 'item', id: 'i2' }],
        },
      ]),
    );
  });

  it('plans no work for an empty selection or empty intent', () => {
    expect(planTagBulkOperations([], ['t1'], [])).toEqual([]);
    expect(planTagBulkOperations(['i1'], [], [])).toEqual([]);
  });
});
