import { untrack } from 'svelte';
import { PosTicketRejected } from './pos-ticket-transport';

export type PaymentPolicyRecoveryState = 'idle' | 'loading' | 'review' | 'failed';

interface PaymentPolicyOwner {
  actorId: string;
  orgId: string;
}

interface PaymentPolicyRecoveryOptions {
  owner: () => PaymentPolicyOwner;
  revision: () => string;
  reload: () => Promise<void>;
}

export interface PaymentPolicyAttemptOwner {
  readonly ownerKey: string;
  readonly generation: number;
}

export interface PaymentPolicyRecovery {
  readonly state: PaymentPolicyRecoveryState;
  readonly rejectedRevision: string | null;
  readonly submitting: boolean;
  readonly blocksFinish: boolean;
  refresh(rejectedRevision: string): Promise<void>;
  retry(): Promise<void>;
  captureAttempt(): PaymentPolicyAttemptOwner;
  isAttemptCurrent(attempt: PaymentPolicyAttemptOwner): boolean;
  refreshAttempt(
    rejectedRevision: string,
    attempt: PaymentPolicyAttemptOwner,
  ): Promise<'current' | 'stale'>;
  releaseAttempt(attempt: PaymentPolicyAttemptOwner): void;
  completeAttempt(attempt: PaymentPolicyAttemptOwner): boolean;
}

function ownerKey(owner: PaymentPolicyOwner): string {
  return JSON.stringify([owner.actorId, owner.orgId]);
}

/**
 * Own the post-rejection policy read without owning the ticket write. A rejected
 * ticket is never replayed: a changed policy only makes a later, explicit Finish
 * attempt eligible. Both the write result and its optional reload are admitted by
 * an immutable actor/org generation so A -> B -> A cannot revive A's old observer.
 */
export function createPaymentPolicyRecovery(
  options: PaymentPolicyRecoveryOptions,
): PaymentPolicyRecovery {
  let state = $state<PaymentPolicyRecoveryState>('idle');
  let rejectedRevision = $state<string | null>(null);
  let nextRequestId = 0;
  let observedOwner = ownerKey(options.owner());
  let ownerGeneration = 0;
  // Identity is the ownership token. Keep it raw so Svelte does not wrap it in
  // a proxy whose identity differs from the token held by the async caller.
  let activeAttempt = $state.raw<PaymentPolicyAttemptOwner | null>(null);

  $effect(() => {
    const currentOwner = ownerKey(options.owner());
    if (currentOwner !== observedOwner) {
      untrack(() => {
        observedOwner = currentOwner;
        ownerGeneration += 1;
        nextRequestId += 1;
        activeAttempt = null;
        state = 'idle';
        rejectedRevision = null;
      });
    }
    return () => {
      // Cleanup runs before each owner re-evaluation and on unmount. Incrementing
      // here retires even a same-key owner that left and later returned.
      ownerGeneration += 1;
      nextRequestId += 1;
      activeAttempt = null;
    };
  });

  function captureAttempt(): PaymentPolicyAttemptOwner {
    const attempt = Object.freeze({
      ownerKey: ownerKey(options.owner()),
      generation: ownerGeneration,
    });
    activeAttempt = attempt;
    return attempt;
  }

  function isAttemptCurrent(attempt: PaymentPolicyAttemptOwner): boolean {
    return attempt.generation === ownerGeneration && attempt.ownerKey === ownerKey(options.owner());
  }

  function isRefreshCurrent(requestId: number, attempt: PaymentPolicyAttemptOwner): boolean {
    return requestId === nextRequestId && isAttemptCurrent(attempt);
  }

  function releaseAttempt(attempt: PaymentPolicyAttemptOwner): void {
    if (activeAttempt === attempt) activeAttempt = null;
  }

  async function refreshAttempt(
    rejected: string,
    attempt: PaymentPolicyAttemptOwner,
  ): Promise<'current' | 'stale'> {
    if (!isAttemptCurrent(attempt)) return 'stale';
    const requestId = ++nextRequestId;
    rejectedRevision = rejected;
    state = 'loading';
    try {
      await options.reload();
      if (!isRefreshCurrent(requestId, attempt)) return 'stale';
      state = options.revision() === rejected ? 'failed' : 'review';
      return 'current';
    } catch {
      if (!isRefreshCurrent(requestId, attempt)) return 'stale';
      state = 'failed';
      return 'current';
    }
  }

  async function refresh(rejected: string): Promise<void> {
    const attempt = captureAttempt();
    await refreshAttempt(rejected, attempt);
    releaseAttempt(attempt);
  }

  return {
    get state() {
      return state;
    },
    get rejectedRevision() {
      return rejectedRevision;
    },
    get submitting() {
      return activeAttempt !== null && isAttemptCurrent(activeAttempt);
    },
    get blocksFinish() {
      return state === 'loading' || state === 'failed';
    },
    refresh,
    captureAttempt,
    isAttemptCurrent,
    refreshAttempt,
    releaseAttempt,
    async retry() {
      if (state !== 'failed' || rejectedRevision === null) return;
      await refresh(rejectedRevision);
    },
    completeAttempt(attempt) {
      if (!isAttemptCurrent(attempt)) {
        releaseAttempt(attempt);
        return false;
      }
      releaseAttempt(attempt);
      nextRequestId += 1;
      state = 'idle';
      rejectedRevision = null;
      return true;
    },
  };
}

export type PaymentPolicyTicketAttempt<T> =
  | { status: 'committed'; value: T; owner: PaymentPolicyCommittedOwner }
  | { status: 'committed-stale'; value: T }
  | { status: 'policy-changed' }
  | { status: 'rejected'; error: unknown }
  | { status: 'rejected-stale'; error: unknown };

export interface PaymentPolicyCommittedOwner {
  /** True only while the original actor/org generation still owns UI effects. */
  current(): boolean;
}

export type PaymentPolicyCommittedRepair =
  { status: 'current' } | { status: 'stale' } | { status: 'committed-refreshing'; error: unknown };

/**
 * The one production seam that owns the submit result and classifies
 * `pos_settings_changed`. A stale committed receipt remains committed, while
 * every stale route effect and policy reload is suppressed. No branch retries
 * the supplied mutation.
 */
export async function runPaymentPolicyTicketAttempt<T>(options: {
  recovery: PaymentPolicyRecovery;
  paymentPolicyRevision: string;
  submit: () => Promise<T>;
}): Promise<PaymentPolicyTicketAttempt<T>> {
  const attempt = options.recovery.captureAttempt();
  try {
    const value = await options.submit();
    if (!options.recovery.completeAttempt(attempt)) {
      return { status: 'committed-stale', value };
    }
    return {
      status: 'committed',
      value,
      owner: Object.freeze({ current: () => options.recovery.isAttemptCurrent(attempt) }),
    };
  } catch (error) {
    if (!options.recovery.isAttemptCurrent(attempt)) {
      options.recovery.releaseAttempt(attempt);
      return { status: 'rejected-stale', error };
    }
    if (error instanceof PosTicketRejected && error.code === 'pos_settings_changed') {
      const admission = await options.recovery.refreshAttempt(
        options.paymentPolicyRevision,
        attempt,
      );
      options.recovery.releaseAttempt(attempt);
      if (admission === 'stale') return { status: 'rejected-stale', error };
      return { status: 'policy-changed' };
    }
    options.recovery.releaseAttempt(attempt);
    return { status: 'rejected', error };
  }
}

/**
 * Repair projections after a known committed ticket without ever replaying it.
 * Each read and the final navigation belong to the ticket attempt's immutable
 * owner; a scope change makes every later callback inert. A current read failure
 * is explicitly committed-refreshing rather than a failed sale.
 */
export async function repairCommittedTicketView(options: {
  owner: PaymentPolicyCommittedOwner;
  refreshes: readonly (() => Promise<void>)[];
  onCommittedRefreshFailure: (error: unknown) => void;
  onReady: () => void;
}): Promise<PaymentPolicyCommittedRepair> {
  for (const refresh of options.refreshes) {
    if (!options.owner.current()) return { status: 'stale' };
    try {
      await refresh();
    } catch (error) {
      if (!options.owner.current()) return { status: 'stale' };
      try {
        options.onCommittedRefreshFailure(error);
      } catch {
        // A reporting failure cannot turn a committed sale into a rejected one.
      }
      return { status: 'committed-refreshing', error };
    }
    if (!options.owner.current()) return { status: 'stale' };
  }
  if (!options.owner.current()) return { status: 'stale' };
  options.onReady();
  return { status: 'current' };
}
