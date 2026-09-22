import { describe, expect, it, vi } from 'vitest';
import { createRowSaveController, summarizeRowOutcomes, type RowSaveResult } from './row-save';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('serialized row saves', () => {
  it('serializes same-row snapshots without sending future or failed drafts', async () => {
    const controller = createRowSaveController(() => {});
    const first = deferred<RowSaveResult>();
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
    const a = controller.save('r', {}, { a: 'old', b: 'old' }, { a: 'new' }, persist);
    const b = controller.save('r', {}, { a: 'old', b: 'old' }, { b: 'new' }, persist);
    await flush();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][1]).toEqual({ a: 'new', b: 'old' });
    first.resolve(true);
    await a;
    await b;
    expect(persist.mock.calls[1][1]).toEqual({ a: 'new', b: 'new' });
  });
  it('older rejection cannot clear or mark a newer cell revision failed', async () => {
    const controller = createRowSaveController(() => {});
    const first = deferred<RowSaveResult>();
    const second = deferred<RowSaveResult>();
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = controller.save('r', {}, { a: 'old' }, { a: 'one' }, persist);
    const b = controller.save('r', {}, { a: 'old' }, { a: 'two' }, persist);
    await flush();
    first.resolve(false);
    await a;
    expect(controller.view().values.get('r')).toEqual({ a: 'two' });
    expect(controller.view().failed.size).toBe(0);
    expect(controller.view().pending.size).toBe(1);
    second.resolve(true);
    await b;
    expect(controller.view().pending.size).toBe(0);
  });
  it('retains failed drafts and does not silently resend them through a sibling edit', async () => {
    const controller = createRowSaveController(() => {});
    await controller.save(
      'r',
      {},
      { a: 'old', b: 'old' },
      { a: 'failed draft' },
      async () => false,
    );
    const persist = vi.fn().mockResolvedValue(true);
    await controller.save('r', {}, { a: 'old', b: 'old' }, { b: 'new' }, persist);
    expect(persist.mock.calls[0][1]).toEqual({ a: 'old', b: 'new' });
    expect(controller.view().values.get('r')?.a).toBe('failed draft');
  });
  it('acknowledged writes survive refresh failure and reconcile only with matching canonical data', async () => {
    const controller = createRowSaveController(() => {});
    await controller.save('r', {}, { a: 'old' }, { a: 'new' }, async () => ({
      status: 'committed-refreshing',
    }));
    controller.reconcile('r', { a: 'old' });
    expect(controller.view().values.get('r')?.a).toBe('new');
    expect(controller.view().failed.size).toBe(0);
    controller.reconcile('r', { a: 'new' });
    expect(controller.view().values.has('r')).toBe(false);
  });
  it('blocks queued and subsequent writes after unknown outcomes', async () => {
    const controller = createRowSaveController(() => {});
    const first = deferred<RowSaveResult>();
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
    const a = controller.save('r', {}, { a: 'old', b: 'old' }, { a: 'new' }, persist);
    const b = controller.save('r', {}, { a: 'old', b: 'old' }, { b: 'new' }, persist);
    await flush();
    first.resolve({ status: 'unknown' });
    await a;
    await b;
    await controller.save('r', {}, {}, { a: 'again' }, persist);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(controller.view().pending.size).toBe(0);
    expect(controller.view().failed.size).toBe(2);
  });
  it('does not block independent rows and fences disposed callbacks', async () => {
    const changed = vi.fn();
    const controller = createRowSaveController(changed);
    const first = deferred<RowSaveResult>();
    const a = controller.save('a', {}, {}, { a: 'new' }, () => first.promise);
    const b = await controller.save('b', {}, {}, { a: 'new' }, async () => true);
    expect(b.status).toBe('succeeded');
    controller.dispose();
    const count = changed.mock.calls.length;
    first.resolve(true);
    await a;
    expect(changed).toHaveBeenCalledTimes(count);
    expect(controller.view().values.size).toBe(0);
  });
});

describe('PATCH acknowledgement boundary', () => {
  it('never treats refresh failure as a rejected PATCH', async () => {
    const { saveRowPatch } = await import('./row-save');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    try {
      const outcome = await saveRowPatch('/api/test', {}, async () => {
        throw new Error('refresh failed');
      });
      expect(outcome.status).toBe('committed-refreshing');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });
  it.each([
    [422, 'failed'],
    [409, 'conflict'],
    [500, 'unknown'],
  ] as const)('classifies HTTP %s as %s without refresh or retry', async (status, expected) => {
    const { saveRowPatch } = await import('./row-save');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status }));
    const refresh = vi.fn();
    try {
      expect((await saveRowPatch('/api/test', {}, refresh)).status).toBe(expected);
      expect(refresh).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

it('does not acknowledge mixed committed and unknown batch results', () => {
  const acknowledge = vi.fn();
  expect(
    summarizeRowOutcomes([{ status: 'succeeded' }, { status: 'unknown' }], { acknowledge }),
  ).toEqual({ status: 'unknown' });
  expect(acknowledge).not.toHaveBeenCalled();
  summarizeRowOutcomes([{ status: 'succeeded' }, { status: 'committed-refreshing' }], {
    acknowledge,
  });
  expect(acknowledge).toHaveBeenCalledTimes(1);
  expect(
    summarizeRowOutcomes([{ status: 'committed-refreshing' }, { status: 'failed' }]).status,
  ).toBe('partial');
});

it('refreshes a three-row fill once after every write, preserving acknowledged overlays on refresh failure', async () => {
  const { completeRowSaves } = await import('./row-save');
  const controller = createRowSaveController();
  const writes = vi.fn().mockResolvedValue({ status: 'succeeded' });
  const results = await Promise.all(
    ['a', 'b', 'c'].map((id) =>
      controller.save(id, {}, { field: 'old' }, { field: 'new' }, writes),
    ),
  );
  const refresh = vi.fn().mockRejectedValue(new Error('projection unavailable'));
  expect((await completeRowSaves(results, refresh)).status).toBe('committed-refreshing');
  expect(writes).toHaveBeenCalledTimes(3);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(controller.view().values.size).toBe(3);
  expect(controller.view().failed.size).toBe(0);
});

it.each(['failed', 'unknown'] as const)(
  'refreshes committed rows without hiding a sibling %s outcome',
  async (status) => {
    const { completeRowSaves } = await import('./row-save');
    const refresh = vi.fn().mockRejectedValue(new Error('projection unavailable'));
    const result = await completeRowSaves([{ status: 'succeeded' }, { status }], refresh);
    expect(result.status).toBe(status === 'unknown' ? 'unknown' : 'partial');
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);

it('recognizes explicit domain rejection in a successful HTTP response', async () => {
  const { saveRowPatch } = await import('./row-save');
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: false }));
  const refresh = vi.fn();
  try {
    expect((await saveRowPatch('/api/test', {}, refresh)).status).toBe('failed');
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    fetchMock.mockRestore();
  }
});

it('reconciles canonical data arriving before the save settles so later remote changes remain visible', async () => {
  const controller = createRowSaveController();
  const pending = deferred<RowSaveResult>();
  const save = controller.save(
    'r',
    {},
    { active: 'false' },
    { active: 'true' },
    () => pending.promise,
  );
  await flush();
  controller.reconcile('r', { active: 'true' });
  expect(controller.view().pending.size).toBe(1);
  pending.resolve(true);
  await save;
  expect(controller.view().values.has('r')).toBe(false);
  controller.reconcile('r', { active: 'false' });
  expect(controller.view().values.has('r')).toBe(false);
});

it('keeps committed predecessors until queued snapshots have consumed them', async () => {
  const controller = createRowSaveController();
  const first = deferred<RowSaveResult>();
  const second = deferred<RowSaveResult>();
  const persist = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = controller.save('r', {}, { a: 'old', b: 'old' }, { a: 'new' }, persist);
  const b = controller.save('r', {}, { a: 'old', b: 'old' }, { b: 'new' }, persist);
  await flush();
  controller.reconcile('r', { a: 'new', b: 'old' });
  first.resolve(true);
  await a;
  await flush();
  expect(persist.mock.calls[1][1]).toEqual({ a: 'new', b: 'new' });
  controller.reconcile('r', { a: 'new', b: 'new' });
  second.resolve(true);
  await b;
  expect(controller.view().values.has('r')).toBe(false);
});

it('clears failed, blocked and pending drafts on scope reset and fences late settlements and queued writes', async () => {
  const controller = createRowSaveController();
  controller.reset(1);
  await controller.save('failed', {}, {}, { name: 'failed' }, async () => false);
  await controller.save('blocked', {}, {}, { name: 'unknown' }, async () => ({
    status: 'unknown',
  }));
  const first = deferred<RowSaveResult>();
  const persist = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
  const pending = controller.save('same-id', {}, {}, { name: 'old tenant' }, persist);
  const queued = controller.save('same-id', {}, {}, { name: 'queued old tenant' }, persist);
  await flush();
  controller.reset(2);
  expect(controller.view().values.size).toBe(0);
  expect(controller.view().blocked.size).toBe(0);
  expect(controller.view().failed.size).toBe(0);
  await controller.save('same-id', {}, {}, { name: 'new tenant' }, async () => true);
  first.resolve(true);
  await pending;
  await queued;
  expect(persist).toHaveBeenCalledTimes(1);
  expect(controller.view().values.get('same-id')).toEqual({ name: 'new tenant' });
  controller.reset(2);
  expect(controller.view().values.get('same-id')).toEqual({ name: 'new tenant' });
});

it('retains an unsent draft for explicit retry when action admission reaches capacity', async () => {
  const { runDraftCommand } = await import('./row-save');
  const controller = createRowSaveController();
  const execute = vi.fn();
  const runtime = {
    runCommand: vi.fn().mockRejectedValue(new Error('Action runtime capacity reached')),
  };
  const result = await runDraftCommand(
    runtime,
    'table.save',
    execute,
    controller.prepareAdmissionFailure('r', { name: 'kept draft' }),
  );
  expect(result.status).toBe('failed');
  expect(execute).not.toHaveBeenCalled();
  expect(controller.view().values.get('r')).toEqual({ name: 'kept draft' });
  expect(controller.view().failed.has(controller.key('r', 'name'))).toBe(true);
  expect(controller.view().pending.size).toBe(0);
  const retry = vi.fn().mockResolvedValue(true);
  await controller.save('r', {}, {}, { name: 'kept draft' }, retry);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(controller.view().failed.size).toBe(0);
});

it('admission rejection does not overwrite a newer edit or a new scope', async () => {
  const controller = createRowSaveController();
  controller.reset(1);
  const retainOld = controller.prepareAdmissionFailure('r', { active: 'true' });
  await controller.save('r', {}, {}, { active: 'false' }, async () => true);
  retainOld();
  expect(controller.view().values.get('r')).toEqual({ active: 'false' });
  expect(controller.view().failed.size).toBe(0);
  const retainOldScope = controller.prepareAdmissionFailure('r', { active: 'true' });
  controller.reset(2);
  retainOldScope();
  expect(controller.view().values.size).toBe(0);
});

it('does not classify a started command rejection as safe to retry', async () => {
  const { runDraftCommand } = await import('./row-save');
  const retain = vi.fn();
  const result = await runDraftCommand(
    undefined,
    'table.save',
    async () => {
      throw new Error('after dispatch');
    },
    retain,
  );
  expect(result.status).toBe('unknown');
  expect(retain).not.toHaveBeenCalled();
});
