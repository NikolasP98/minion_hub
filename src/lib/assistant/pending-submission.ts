/** Preparation ownership only. Accepted gateway runs remain in chat state. */
export interface SubmissionScope {
  actorId: string;
  orgId: string;
  agentId: string;
  sessionKey: string;
}
export interface PendingSubmission extends SubmissionScope {
  readonly submissionId: string;
  readonly scopeEpoch: number;
  readonly composerRevision: number;
  readonly pageContextRevision: number;
  phase: 'preparing' | 'submitted' | 'canceled' | 'invalidated' | 'rejected';
  readonly signal: AbortSignal;
}
export type SubmissionResult = { status: 'submitted' | 'rejected'; runId: string };
export function createPendingSubmissions() {
  let scope: SubmissionScope | null = null;
  let epoch = 0;
  let pending: PendingSubmission | null = null;
  let controller: AbortController | null = null;
  const invalidate = (phase: 'canceled' | 'invalidated') => {
    if (pending?.phase === 'preparing') pending.phase = phase;
    controller?.abort();
  };
  const isCurrent = (turn: PendingSubmission, contextRevision: number) => {
    const current =
      pending === turn &&
      turn.phase === 'preparing' &&
      turn.scopeEpoch === epoch &&
      turn.pageContextRevision === contextRevision;
    if (!current && pending === turn && turn.phase === 'preparing') invalidate('invalidated');
    return current;
  };
  return {
    get current() {
      return pending;
    },
    setScope(next: SubmissionScope) {
      if (
        scope &&
        Object.keys(next).every(
          (key) => next[key as keyof SubmissionScope] === scope![key as keyof SubmissionScope],
        )
      )
        return;
      invalidate('invalidated');
      epoch++;
      scope = { ...next };
    },
    begin(composerRevision: number, pageContextRevision: number): PendingSubmission {
      if (!scope) throw new Error('Submission scope is required');
      invalidate('invalidated');
      controller = new AbortController();
      pending = {
        ...scope,
        submissionId: crypto.randomUUID(),
        scopeEpoch: epoch,
        composerRevision,
        pageContextRevision,
        phase: 'preparing',
        signal: controller.signal,
      };
      return pending;
    },
    isCurrent,
    ownsScope(turn: PendingSubmission): boolean {
      return turn.scopeEpoch === epoch;
    },
    commit(
      turn: PendingSubmission,
      contextRevision: number,
      dispatch: () => SubmissionResult,
    ): boolean {
      if (!isCurrent(turn, contextRevision)) return false;
      // No await between ownership check and transport dispatch.
      try {
        const result = dispatch();
        turn.phase = result.status === 'submitted' ? 'submitted' : 'rejected';
      } catch {
        turn.phase = 'rejected';
      }
      return turn.phase === 'submitted';
    },
    cancel() {
      invalidate('canceled');
    },
    invalidate() {
      invalidate('invalidated');
      epoch++;
    },
    finish(turn: PendingSubmission) {
      if (pending === turn) {
        if (turn.phase === 'preparing') turn.phase = 'rejected';
        controller?.abort();
        pending = null;
        controller = null;
      }
    },
  };
}
