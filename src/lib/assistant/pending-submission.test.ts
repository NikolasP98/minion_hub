import { describe, expect, it, vi } from 'vitest';
import { createPendingSubmissions } from './pending-submission';
const scope = { actorId: 'actor', orgId: 'org', agentId: 'agent', sessionKey: 'session' };
describe('pending submission ownership', () => {
  it('invalidates A → B → A and aborts preparation', () => {
    const manager = createPendingSubmissions();
    manager.setScope(scope);
    const pending = manager.begin(1, 1);
    manager.setScope({ ...scope, sessionKey: 'other' });
    manager.setScope(scope);
    expect(pending.signal.aborted).toBe(true);
    expect(manager.isCurrent(pending, 1)).toBe(false);
    expect(pending.phase).toBe('invalidated');
  });
  it('commits once only on a real submitted result; rejection retains ownership evidence', () => {
    const manager = createPendingSubmissions();
    manager.setScope(scope);
    const first = manager.begin(3, 4);
    const dispatch = vi.fn(() => ({ status: 'submitted' as const, runId: first.submissionId }));
    expect(manager.commit(first, 4, dispatch)).toBe(true);
    expect(manager.commit(first, 4, dispatch)).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const second = manager.begin(3, 4);
    expect(
      manager.commit(second, 4, () => ({ status: 'rejected', runId: second.submissionId })),
    ).toBe(false);
    expect(second.phase).toBe('rejected');
  });
  it('cancellation and context change fence dispatch; stale finish cannot clear newer work', () => {
    const manager = createPendingSubmissions();
    manager.setScope(scope);
    const old = manager.begin(1, 2);
    manager.cancel();
    const current = manager.begin(1, 2);
    manager.finish(old);
    expect(manager.current).toBe(current);
    const send = vi.fn();
    expect(manager.commit(current, 3, send)).toBe(false);
    expect(current.phase).toBe('invalidated');
    expect(send).not.toHaveBeenCalled();
  });
});
