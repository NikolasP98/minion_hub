import { afterEach, describe, expect, it, vi } from 'vitest';
import { bulkLinkTags, retryTagBulkOperations, type TagBulkOperation } from './tag-bulk';
import { crmTagOperationKey, type CrmTagBulkResponse } from '$lib/tags/crm-bulk-contract';

const monitor = vi.hoisted(() => vi.fn());
vi.mock('./crm-tag-bulk-monitor', () => ({ reportCrmTagBulkFailure: monitor }));

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const operations = (n: number): TagBulkOperation[] =>
  Array.from({ length: n }, (_, i) => ({
    targetId: uuid(i + 1),
    tagId: uuid(9000),
    action: 'add',
  }));
function receipt(ops: TagBulkOperation[]): CrmTagBulkResponse {
  return {
    version: 1,
    cacheInvalidation: 'ok',
    results: ops.map((operation) => ({
      operationKey: crmTagOperationKey(operation),
      operation,
      disposition: 'completed',
    })),
  };
}
function parse(init: RequestInit): TagBulkOperation[] {
  return (JSON.parse(String(init.body)) as { operations: TagBulkOperation[] }).operations;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('CRM bulk operation protocol', () => {
  it.each([
    [0, 0],
    [1, 1],
    [20, 1],
    [2000, 1],
    [4001, 3],
  ])('%i operations require exactly %i requests', async (size, requests) => {
    const fetcher = vi.fn(async (_url, init) => Response.json(receipt(parse(init))));
    vi.stubGlobal('fetch', fetcher);
    const planned = operations(size);
    const result = await retryTagBulkOperations('crm', planned);
    expect(result).toEqual({ status: 'succeeded', completed: planned, pending: [] });
    expect(fetcher).toHaveBeenCalledTimes(requests);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('/api/crm/contacts/tags/bulk');
      expect(parse(init).length).toBeLessThanOrEqual(2000);
      expect(new TextEncoder().encode(String(init.body)).length).toBeLessThan(524288);
    }
  });

  it('normalizes identity and removes duplicates without growing the intended set', async () => {
    const first = { targetId: uuid(10), tagId: uuid(20), action: 'add' as const };
    const fetcher = vi.fn(async (_url, init) => Response.json(receipt(parse(init))));
    vi.stubGlobal('fetch', fetcher);
    const result = await retryTagBulkOperations('crm', [
      first,
      { ...first, tagId: first.tagId.toUpperCase() },
    ]);
    expect(result.completed).toEqual([first]);
    expect(parse(fetcher.mock.calls[0]![1])).toEqual([first]);
  });

  it('rejects a contradictory complete plan before any chunk starts', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const planned = operations(4001);
    planned.push({ ...planned[0]!, action: 'remove' });
    const result = await retryTagBulkOperations('crm', planned);
    expect(result.status).toBe('failed');
    expect(result.pending).toEqual(planned);
    expect(fetcher).not.toHaveBeenCalled();
    expect(monitor).toHaveBeenCalledExactlyOnceWith('failed');
  });

  const corruptions: [string, (body: CrmTagBulkResponse) => unknown][] = [
    ['extra top-level field', (b) => ({ ...b, diagnostic: 'must not admit raw content' })],
    ['extra result field', (b) => ({ ...b, results: b.results.map((r) => ({ ...r, raw: 'no' })) })],
    [
      'extra operation field',
      (b) => ({
        ...b,
        results: b.results.map((r) => ({ ...r, operation: { ...r.operation, raw: 'no' } })),
      }),
    ],
    ['missing version', (b) => ({ ...b, version: undefined })],
    ['wrong version', (b) => ({ ...b, version: 2 })],
    ['missing results', (b) => ({ ...b, results: undefined })],
    ['truncated', (b) => ({ ...b, results: b.results.slice(1) })],
    ['duplicate', (b) => ({ ...b, results: [b.results[0], b.results[0]] })],
    ['reordered', (b) => ({ ...b, results: [...b.results].reverse() })],
    [
      'invented operation',
      (b) => ({ ...b, results: [b.results[0], { ...b.results[1], operationKey: 'invented' }] }),
    ],
    [
      'wrong echoed operation',
      (b) => ({
        ...b,
        results: [b.results[0], { ...b.results[1], operation: b.results[0]!.operation }],
      }),
    ],
    [
      'invalid disposition',
      (b) => ({ ...b, results: b.results.map((r) => ({ ...r, disposition: 'saved' })) }),
    ],
    [
      'unbounded error',
      (b) => ({
        ...b,
        results: b.results.map((r) => ({
          ...r,
          disposition: 'pending',
          errorCode: 'raw database error',
        })),
      }),
    ],
    ['invalid cache state', (b) => ({ ...b, cacheInvalidation: 'maybe' })],
    ['array cache state', (b) => ({ ...b, cacheInvalidation: ['failed'] })],
    ['nested array cache state', (b) => ({ ...b, cacheInvalidation: [['ok']] })],
    ['null', () => null],
  ];
  it.each(corruptions)('keeps the whole plan unknown for %s 200', async (_name, corrupt) => {
    const plan = operations(2);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(corrupt(receipt(plan)))),
    );
    const result = await retryTagBulkOperations('crm', plan);
    expect(result.status).toBe('unknown');
    expect(result.completed).toEqual([]);
    expect(result.pending).toEqual(plan);
  });

  it.each([
    () =>
      Promise.resolve(
        Response.json({ version: 1, error: { code: 'forbidden' }, raw: 'no' }, { status: 403 }),
      ),
    () =>
      Promise.resolve(
        Response.json({ version: 1, error: { code: 'forbidden', raw: 'no' } }, { status: 403 }),
      ),
    () => Promise.resolve(new Response('not json', { status: 200 })),
    () => Promise.reject(new Error('secret transport diagnostic')),
    () => Promise.resolve(new Response('proxy failed', { status: 503 })),
    () =>
      Promise.resolve(Response.json({ version: 1, error: { code: 'forbidden' } }, { status: 500 })),
  ])('does not infer rollback from an invalid or lost response', async (reply) => {
    const plan = operations(1);
    const fetcher = vi.fn(reply);
    vi.stubGlobal('fetch', fetcher);
    const result = await retryTagBulkOperations('crm', plan);
    expect(result.status).toBe('unknown');
    expect(result.pending).toEqual(plan);
    expect(String('error' in result ? result.error : '')).not.toContain('secret transport');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('admits a documented rejection and retries only explicit pending pairs', async () => {
    const plan = operations(3);
    const partial = receipt(plan);
    partial.results[1] = {
      ...partial.results[1]!,
      disposition: 'pending',
      errorCode: 'invalid_operation',
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(partial))
      .mockImplementationOnce(async (_url, init) => Response.json(receipt(parse(init))));
    vi.stubGlobal('fetch', fetcher);
    const first = await retryTagBulkOperations('crm', plan);
    expect(first.status).toBe('partial');
    expect(first.completed).toEqual([plan[0], plan[2]]);
    expect(first.pending).toEqual([plan[1]]);
    const retry = await retryTagBulkOperations('crm', first.pending);
    expect(retry.status).toBe('succeeded');
    expect(parse(fetcher.mock.calls[1]![1])).toEqual([plan[1]]);
    fetcher.mockResolvedValueOnce(
      Response.json({ version: 1, error: { code: 'forbidden' } }, { status: 403 }),
    );
    const denied = await retryTagBulkOperations('crm', plan);
    expect(denied.status).toBe('failed');
    expect(denied.pending).toEqual(plan);
  });

  it('keeps committed operations out of retry when cache invalidation fails', async () => {
    const plan = operations(2);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...receipt(plan), cacheInvalidation: 'failed' })),
    );
    const result = await retryTagBulkOperations('crm', plan);
    expect(result).toEqual({
      status: 'succeeded',
      completed: plan,
      pending: [],
      warning: { code: 'committed-refresh-failed' },
    });
  });

  it('runs only two chunks concurrently and aggregates by plan order after reversed completion', async () => {
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    const fetcher = vi.fn(async (_url, init) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return Response.json(receipt(parse(init)));
    });
    vi.stubGlobal('fetch', fetcher);
    const plan = operations(4001);
    const pending = retryTagBulkOperations('crm', plan);
    expect(fetcher).toHaveBeenCalledTimes(2);
    releases[1]!();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    releases[2]!();
    releases[0]!();
    expect((await pending).completed).toEqual(plan);
    expect(peak).toBe(2);
  });

  it('uses the bulk entrypoint with the same exact add/remove intent', async () => {
    const fetcher = vi.fn(async (_url, init) => Response.json(receipt(parse(init))));
    vi.stubGlobal('fetch', fetcher);
    const result = await bulkLinkTags('crm', [uuid(1), uuid(2)], [uuid(3)], [uuid(4)]);
    expect(result.status).toBe('succeeded');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.completed).toHaveLength(4);
  });
});
