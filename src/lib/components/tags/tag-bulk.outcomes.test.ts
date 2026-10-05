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

  it('returns exact CRM successes and retries only the failed operation', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const first = await bulkLinkTags('crm', ['c1', 'c2'], ['t1'], ['t2']);
    expect(first.status).toBe('partial');
    expect(first.completed).toHaveLength(3);
    expect(first.pending).toEqual([{ targetId: 'c1', tagId: 't2', action: 'remove' }]);

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const repaired = await retryTagBulkOperations('crm', first.pending);
    expect(repaired.status).toBe('succeeded');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/crm/contacts/c1/tags?tagId=t2');
  });

  it('caps CRM request fanout while preserving every operation outcome', async () => {
    let active = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return new Response(null, { status: 200 });
    });
    const ids = Array.from({ length: 20 }, (_, index) => `c${index}`);

    const outcome = await bulkLinkTags('crm', ids, ['t1'], []);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.completed).toHaveLength(20);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
  });

  it('plans no work for an empty selection or empty intent', () => {
    expect(planTagBulkOperations([], ['t1'], [])).toEqual([]);
    expect(planTagBulkOperations(['i1'], [], [])).toEqual([]);
  });
});
