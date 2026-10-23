import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pulse } from './pulse.svelte';

const id = 'proposal-read-order';
const receipt = (state = 'queued') => ({
  proposalId: id,
  revision: 1,
  decision: 'approved',
  decidedAt: '2026-10-23T00:00:00Z',
  receiptId: 'dispatch-read-order',
  dispatch: { state, reason: null, remoteJobId: state === 'scheduled' ? 'remote-known' : null },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let scope = 0;
beforeEach(() => pulse.setScope(`read-order-${++scope}`));
afterEach(() => vi.unstubAllGlobals());

describe('actual Pulse rune store read ordering', () => {
  it('pins the active decision through cache eviction and returns its newest receipt', async () => {
    const post = deferred<Response>();
    let failRefresh = false;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return post.promise;
      return Promise.resolve(
        failRefresh
          ? Response.json({}, { status: 503 })
          : Response.json({ ...receipt('scheduled'), proposalId: url.split('/').at(-2) }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const approving = pulse.approve(id, 1);
    await pulse.readReceipt(id);
    for (let n = 0; n < 50; n++) await pulse.readReceipt(`pressure-${n}`);
    expect(pulse.receipts).toHaveLength(50);
    expect(pulse.receipt(id)?.dispatch?.state).toBe('scheduled');
    failRefresh = true;
    post.resolve(Response.json(receipt()));
    const outcome = await approving;
    expect(outcome?.status).toBe('committed-refreshing');
    expect(outcome && 'value' in outcome ? outcome.value?.dispatch?.state : undefined).toBe(
      'scheduled',
    );
    expect(pulse.receipt(id)?.dispatch?.state).toBe('scheduled');
    expect(pulse.receipts).toHaveLength(50);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(
      1,
    );
    failRefresh = false;
    for (let n = 0; n < 50; n++) await pulse.readReceipt(`later-${n}`);
    expect(pulse.receipt(id)).toBeUndefined();
    expect(pulse.receipts).toHaveLength(50);
  });
  it('does not return an old active receipt after scope A switches away and back', async () => {
    const post = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options?: RequestInit) =>
        options?.method === 'POST'
          ? post.promise
          : Promise.resolve(Response.json(receipt('scheduled'))),
      ),
    );
    const approving = pulse.approve(id, 1);
    await pulse.readReceipt(id);
    pulse.setScope('replacement');
    pulse.setScope(`read-order-${scope}`);
    post.resolve(Response.json(receipt()));
    expect(await approving).toEqual({ status: 'unknown' });
    expect(pulse.receipts).toEqual([]);
    expect(pulse.receipt(id)).toBeUndefined();
    expect(pulse.error).toBeNull();
  });
  it('retains a newer read receipt when an older commit response arrives and its refresh fails', async () => {
    const post = deferred<Response>();
    let failRefresh = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options?: RequestInit) => {
        if (options?.method === 'POST') return post.promise;
        return Promise.resolve(
          failRefresh ? Response.json({}, { status: 503 }) : Response.json(receipt('scheduled')),
        );
      }),
    );
    const approving = pulse.approve(id, 1);
    await pulse.readReceipt(id);
    failRefresh = true;
    post.resolve(Response.json(receipt()));
    expect((await approving)?.status).toBe('committed-refreshing');
    expect(pulse.receipt(id)?.dispatch?.state).toBe('scheduled');
    expect(pulse.recovery).toBe('committed-refreshing');
  });
  it('cannot regress a newer scheduled receipt with an older queued response', async () => {
    const old = deferred<Response>();
    let count = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        ++count === 1 ? old.promise : Promise.resolve(Response.json(receipt('scheduled'))),
      ),
    );
    const reading = pulse.readReceipt(id);
    await pulse.readReceipt(id);
    old.resolve(Response.json(receipt()));
    await reading;
    expect(pulse.receipt(id)?.dispatch?.state).toBe('scheduled');
  });
  it('retires pre-mutation items, badge and receipt reads after the known commit', async () => {
    const oldItems = deferred<Response>(),
      oldCount = deferred<Response>(),
      oldReceipt = deferred<Response>();
    let items = 0,
      counts = 0,
      receipts = 0;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return Promise.resolve(Response.json(receipt()));
      if (url.endsWith('/count'))
        return ++counts === 1 ? oldCount.promise : Promise.resolve(Response.json({ count: 0 }));
      if (url.endsWith('/proposals'))
        return ++items === 1 ? oldItems.promise : Promise.resolve(Response.json({ proposals: [] }));
      return ++receipts === 1
        ? oldReceipt.promise
        : Promise.resolve(Response.json(receipt('scheduled')));
    });
    vi.stubGlobal('fetch', fetchMock);
    const projection = pulse.refresh();
    const reading = pulse.readReceipt(id);
    const publishOldShellCount = pulse.beginCountRead();
    await pulse.approve(id, 1);
    expect(pulse.receipt(id)?.dispatch?.state).toBe('scheduled');
    oldItems.resolve(Response.json({ proposals: [{ id, revision: 1, status: 'pending' }] }));
    oldCount.resolve(Response.json({ count: 1 }));
    oldReceipt.resolve(Response.json(receipt()));
    publishOldShellCount(1);
    await Promise.all([projection, reading]);
    expect(pulse.items).toEqual([]);
    expect(pulse.pendingCount).toBe(0);
    expect(pulse.receipt(id)?.dispatch?.state).toBe('scheduled');
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(
      1,
    );
  });
  it('does not publish a stale read failure after a newer successful projection', async () => {
    const oldItems = deferred<Response>();
    let items = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/count')
          ? Promise.resolve(Response.json({ count: 0 }))
          : ++items === 1
            ? oldItems.promise
            : Promise.resolve(Response.json({ proposals: [] })),
      ),
    );
    const old = pulse.refresh();
    await pulse.refresh();
    oldItems.reject(new Error('old transport failure'));
    await old;
    expect(pulse.error).toBeNull();
  });
  it('drops old-scope failures and count publishers after an owner switch', async () => {
    const old = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => old.promise),
    );
    const refresh = pulse.refresh();
    const publish = pulse.beginCountRead();
    pulse.setScope('new-owner');
    old.reject(new Error('old owner transport failure'));
    publish(99);
    await refresh;
    expect(pulse.error).toBeNull();
    expect(pulse.pendingCount).toBe(0);
    expect(pulse.receipts).toEqual([]);
  });
  it('bounds retained receipts while completing individual request tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json({ ...receipt(), proposalId: url.split('/').at(-2) }),
      ),
    );
    for (let n = 0; n < 60; n++) await pulse.readReceipt(`proposal-${n}`);
    expect(pulse.receipts).toHaveLength(50);
    expect(pulse.receipt('proposal-0')).toBeUndefined();
    expect(pulse.receipt('proposal-59')).toBeDefined();
  });
});
