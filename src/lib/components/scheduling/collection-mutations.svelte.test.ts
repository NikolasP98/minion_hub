import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionRuntime } from '$lib/services/actions/runtime.svelte';
import {
  createCollectionMutations,
  reconcileLink,
  type Reconciliation,
} from './collection-mutations.svelte';

const draft = { title: 'Consultation', slug: 'consultation', eventTypeIds: ['a', 'b'] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setup(runtime?: ReturnType<typeof createActionRuntime>) {
  let scope = 'org-a';
  let reconciliation: Reconciliation = 'absent';
  const refresh = vi.fn().mockResolvedValue(undefined);
  const committed = vi.fn();
  const controller = createCollectionMutations({
    id: 'test.collection',
    runtime,
    scope: () => JSON.stringify([scope, runtime?.scopeVersion]),
    refresh,
    committed,
    reconcile: () => reconciliation,
    rejectionMessage: () => 'Rejected',
    deadlineMs: 50,
  });
  return {
    controller,
    refresh,
    committed,
    scope: (value: string) => {
      scope = value;
      controller.syncScope();
    },
    reconciliation: (value: Reconciliation) => {
      reconciliation = value;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});

describe('collection mutation ownership', () => {
  it.each(['committed', 'absent', 'matched'] as const)(
    'reconciles the original global attention after %s evidence',
    async (evidence) => {
      const runtime = createActionRuntime();
      const { controller, refresh, reconciliation } = setup(runtime);
      if (evidence === 'committed') refresh.mockRejectedValueOnce(new Error('load failed'));
      await controller.execute(
        evidence === 'matched' ? { kind: 'create', link: draft } : { kind: 'delete', id: 'a' },
        async () => {
          if (evidence !== 'committed') throw new TypeError('lost response');
          return new Response(null, { status: 204 });
        },
      );
      expect(runtime.attentionRequired).toBe(1);
      reconciliation(evidence === 'matched' ? 'matched' : 'absent');
      await controller.refresh();
      expect(controller.issue).toBeNull();
      expect(runtime.attentionRequired).toBe(0);
      expect(runtime.size).toBe(1);
      controller.dispose();
      runtime.dispose();
    },
  );

  it('repeated failed read repairs cannot fill confirmed-action capacity', async () => {
    const runtime = createActionRuntime();
    const { controller, refresh } = setup(runtime);
    await controller.execute({ kind: 'delete', id: 'a' }, async () => {
      throw new TypeError('lost');
    });
    refresh.mockRejectedValue(new Error('load failed'));
    for (let attempt = 0; attempt < 140; attempt++) await controller.refresh();
    expect(refresh).toHaveBeenCalledTimes(140);
    expect(controller.issue).toBe('unknown');
    expect(runtime.size).toBe(1);
    expect(runtime.attentionRequired).toBe(1);
    controller.dispose();
    runtime.dispose();
  });

  it('marks a still-present target as conflict and acknowledges it on deliberate retry', async () => {
    const runtime = createActionRuntime();
    const { controller, reconciliation } = setup(runtime);
    await controller.execute({ kind: 'delete', id: 'a' }, async () => {
      throw new TypeError('lost');
    });
    reconciliation('present');
    await controller.refresh();
    expect(runtime.attention.map((record) => record.status)).toEqual(['conflict']);
    await controller.execute(
      { kind: 'delete', id: 'a' },
      async () => new Response(null, { status: 204 }),
    );
    expect(runtime.attentionRequired).toBe(0);
    controller.dispose();
    runtime.dispose();
  });
  it.each([403, 409, 500])(
    'keeps a rejected %s write editable without invalidation',
    async (status) => {
      const { controller, refresh, committed } = setup();
      await controller.execute(
        { kind: 'create', link: draft },
        async () => new Response('', { status }),
      );
      expect(controller.issue).toBe('rejected');
      expect(controller.locked).toBe(false);
      expect(refresh).not.toHaveBeenCalled();
      expect(committed).not.toHaveBeenCalled();
      controller.dispose();
    },
  );

  it('serializes writes and repairs a committed refresh without replay', async () => {
    const { controller, refresh, committed } = setup();
    refresh.mockRejectedValueOnce(new Error('load failed'));
    const pending = deferred<Response>();
    const request = vi.fn(() => pending.promise);
    const operation = controller.execute({ kind: 'delete', id: 'a' }, request);
    await controller.execute({ kind: 'delete', id: 'b' }, request);
    expect(request).toHaveBeenCalledTimes(1);
    pending.resolve(new Response(null, { status: 204 }));
    await operation;
    expect(controller.issue).toBe('committed-refreshing');
    expect(committed).toHaveBeenCalledTimes(1);
    await controller.execute({ kind: 'delete', id: 'a' }, request);
    await controller.refresh();
    expect(controller.issue).toBeNull();
    expect(controller.locked).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it.each([false, true])(
    'ends a never-settling write and fences its late acknowledgement (runtime=%s)',
    async (withRuntime) => {
      vi.useFakeTimers();
      const runtime = withRuntime ? createActionRuntime() : undefined;
      const { controller, refresh, committed } = setup(runtime);
      const pending = deferred<Response>();
      let signal: AbortSignal | undefined;
      const operation = controller.execute({ kind: 'delete', id: 'a' }, (value) => {
        signal = value;
        return pending.promise;
      });
      await vi.advanceTimersByTimeAsync(51);
      await operation;
      expect(controller.busy).toBe(false);
      expect(controller.issue).toBe('unknown');
      expect(controller.locked).toBe(true);
      expect(signal?.aborted).toBe(true);
      pending.resolve(new Response(null, { status: 204 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(committed).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(runtime?.foregroundPending ?? 0).toBe(0);
      controller.dispose();
      runtime?.dispose();
    },
  );

  it('keeps committed classification when refresh times out', async () => {
    vi.useFakeTimers();
    const { controller, refresh, committed } = setup();
    refresh.mockReturnValueOnce(new Promise(() => {}));
    const operation = controller.execute(
      { kind: 'delete', id: 'a' },
      async () => new Response(null, { status: 204 }),
    );
    await vi.advanceTimersByTimeAsync(51);
    await operation;
    expect(committed).toHaveBeenCalledTimes(1);
    expect(controller.issue).toBe('committed-refreshing');
    controller.dispose();
  });

  it.each(['scope', 'runtime', 'dispose'] as const)(
    'suppresses late work after %s ownership ends',
    async (end) => {
      const runtime = createActionRuntime();
      const { controller, refresh, committed, scope } = setup(runtime);
      const pending = deferred<Response>();
      let signal: AbortSignal | undefined;
      const operation = controller.execute({ kind: 'delete', id: 'a' }, (value) => {
        signal = value;
        return pending.promise;
      });
      await vi.waitFor(() => expect(signal).toBeDefined());
      if (end === 'scope') scope('org-b');
      else if (end === 'runtime') {
        runtime.setScope('org-b');
        controller.syncScope();
      } else controller.dispose();
      await operation;
      expect(signal?.aborted).toBe(true);
      pending.resolve(new Response(null, { status: 204 }));
      await Promise.resolve();
      await Promise.resolve();
      expect(refresh).not.toHaveBeenCalled();
      expect(committed).not.toHaveBeenCalled();
      expect(controller.busy).toBe(false);
      expect(controller.issue).toBeNull();
      controller.dispose();
      runtime.dispose();
    },
  );

  it.each(['absent', 'present'] as const)(
    'reconciles an unknown delete from the authoritative %s projection',
    async (result) => {
      const { controller, reconciliation } = setup();
      const request = vi.fn().mockRejectedValue(new TypeError('lost response'));
      await controller.execute({ kind: 'delete', id: 'a' }, request);
      reconciliation(result);
      await controller.refresh();
      expect(controller.locked).toBe(false);
      expect(controller.issue).toBe(result === 'absent' ? null : 'unconfirmed');
      expect(request).toHaveBeenCalledTimes(1);
      controller.dispose();
    },
  );

  it.each(['absent', 'conflict', 'matched'] as const)(
    'reconciles an unknown create as %s without replaying it',
    async (result) => {
      const { controller, refresh, reconciliation, committed } = setup();
      const request = vi.fn().mockRejectedValue(new TypeError('lost response'));
      await controller.execute({ kind: 'create', link: draft }, request);
      expect(controller.canDiscard).toBe(false);
      refresh.mockRejectedValueOnce(new Error('refresh failed'));
      await controller.refresh();
      expect(controller.canDiscard).toBe(false);
      reconciliation(result);
      await controller.refresh();
      expect(controller.locked).toBe(result !== 'matched');
      expect(controller.canDiscard).toBe(result !== 'matched');
      expect(committed).toHaveBeenCalledTimes(result === 'matched' ? 1 : 0);
      expect(request).toHaveBeenCalledTimes(1);
      if (result !== 'matched') {
        expect(controller.discard()).toBe(true);
        expect(controller.locked).toBe(false);
      }
      controller.dispose();
    },
  );

  it('compares slug, trimmed submitted title and ID set without depending on order or duplicates', () => {
    expect(reconcileLink(draft, [{ ...draft, eventTypeIds: ['b', 'a', 'b'] }])).toBe('matched');
    expect(reconcileLink(draft, [{ ...draft, title: 'Someone else' }])).toBe('conflict');
    expect(reconcileLink(draft, [{ ...draft, eventTypeIds: ['a'] }])).toBe('conflict');
    expect(reconcileLink(draft, [{ ...draft, slug: 'other' }])).toBe('absent');
  });
});
