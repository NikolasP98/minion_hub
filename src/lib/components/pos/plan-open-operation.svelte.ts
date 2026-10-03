import * as m from '$lib/paraglide/messages';
import { tryUseActions } from '$lib/services/actions/context';
import type { CommandContext } from '$lib/services/actions/definition';
import { runCheckedMutation, runTrackedCommand } from '$lib/services/actions/mutations';
import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';
import {
  PlanOpenPersistence,
  PlanPersistenceError,
  sameFrozenCart,
  type FrozenPlanCartRow,
  type PendingPlanOperation,
  type PlanOpenContinuation,
  type PlanOperationIdentity,
} from './plan-open-persistence';
import {
  canonicalPlanContinuation,
  PlanContinuationError,
  planOpenIntent,
  samePlanContinuationContext,
  samePlanOperationIdentity,
  type PlanCreatedOwner,
  type PlanOpenBinding,
  type PlanOpenSubmission,
  type PreparedSellContinuation,
} from './plan-open-continuation';
import {
  SafeCancelledCreate,
  SafeIdentityChangedCreate,
  UnknownCreateResponse,
  cancelPlanOperation,
  createPlanOperation,
  lookupPlanOperation,
  resolvePlanIdentity,
  type PlanCancelReceipt,
  type PlanOperationReceipt,
} from './plan-open-transport';

export * from './plan-open-continuation';

type RequestOwner = {
  id: number;
  scope: string;
  identity: PlanOperationIdentity;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
};

interface PlanOperationOptions {
  currentScope: () => string;
  actions?: ActionRuntime | null;
  deadlineMs?: number;
  persistence?: PlanOpenPersistence;
}

interface ActionIds {
  create?: number;
  cancel?: number;
}

const liveActionIds = new WeakMap<ActionRuntime, Map<string, ActionIds>>();

function actionIds(runtime: ActionRuntime | undefined, operationId: string): ActionIds | undefined {
  if (!runtime) return undefined;
  let byOperation = liveActionIds.get(runtime);
  if (!byOperation) {
    byOperation = new Map();
    liveActionIds.set(runtime, byOperation);
  }
  let ids = byOperation.get(operationId);
  if (!ids) {
    ids = {};
    byOperation.set(operationId, ids);
  }
  return ids;
}

function forgetActionIds(runtime: ActionRuntime | undefined, operationId: string): void {
  if (!runtime) return;
  const byOperation = liveActionIds.get(runtime);
  byOperation?.delete(operationId);
  if (byOperation?.size === 0) liveActionIds.delete(runtime);
}

/** Durable owner for one plan create and its exact continuation. */
export class PlanOpenOperation {
  busy = $state(false);
  message = $state<string | null>(null);
  success = $state(false);

  #record = $state.raw<PendingPlanOperation | null>(null);
  #persistenceBlocked = $state(false);
  #restoreRequired = $state(false);
  #activeOwner: RequestOwner | null = null;
  #nextOwnerId = 0;
  #observedScope: string;
  #disposed = false;
  #binding: PlanOpenBinding | null = null;
  #unwatch: (() => void) | null = null;
  #watchedIdentity: PlanOperationIdentity | null = null;
  #storageDirty = false;
  readonly #currentScope: () => string;
  readonly #actions?: ActionRuntime;
  readonly #deadlineMs: number;
  readonly #persistence: PlanOpenPersistence;

  constructor(options: PlanOperationOptions) {
    this.#currentScope = options.currentScope;
    this.#actions =
      options.actions === undefined ? tryUseActions() : (options.actions ?? undefined);
    this.#deadlineMs = options.deadlineMs ?? 15_000;
    this.#persistence = options.persistence ?? new PlanOpenPersistence();
    this.#observedScope = options.currentScope();
  }

  get locked(): boolean {
    return this.#record !== null || this.#persistenceBlocked;
  }

  get canCancel(): boolean {
    return this.#record !== null && this.#record.planId === null;
  }

  get needsCartRestore(): boolean {
    return this.#restoreRequired;
  }

  get restoredIntent(): PendingPlanOperation['intent'] | null {
    return this.#record?.intent ?? null;
  }

  get pendingContinuation(): PlanOpenContinuation | null {
    return this.#record?.continuation ?? null;
  }

  /** Returns true when the caller must reset its scope-owned form drafts. */
  syncScope(scope: string): boolean {
    if (this.#observedScope === scope) return false;
    this.#observedScope = scope;
    this.#cancelActiveOwner();
    this.#stopWatching();
    this.busy = false;
    this.#record = null;
    this.#binding = null;
    this.#persistenceBlocked = false;
    this.#restoreRequired = false;
    this.message = null;
    this.success = false;
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelActiveOwner();
    this.#stopWatching();
    this.busy = false;
    this.#record = null;
    this.#binding = null;
  }

  #stopWatching(): void {
    this.#unwatch?.();
    this.#unwatch = null;
    this.#watchedIdentity = null;
  }

  #watch(binding: PlanOpenBinding): void {
    if (this.#watchedIdentity && samePlanOperationIdentity(this.#watchedIdentity, binding.identity))
      return;
    this.#stopWatching();
    this.#watchedIdentity = binding.identity;
    this.#unwatch = this.#persistence.watch(binding.identity, () => {
      if (this.#disposed) return;
      if (this.busy) {
        this.#storageDirty = true;
        return;
      }
      const current = this.#binding;
      if (current) void this.initialize(current);
    });
  }

  #ownsUi(owner: RequestOwner): boolean {
    const binding = this.#binding;
    return (
      !this.#disposed &&
      this.#activeOwner === owner &&
      owner.scope === this.#currentScope() &&
      owner.scope === this.#observedScope &&
      binding !== null &&
      samePlanOperationIdentity(owner.identity, binding.identity)
    );
  }

  #isOwnerCurrent(owner: RequestOwner): boolean {
    return this.#ownsUi(owner) && !owner.controller.signal.aborted;
  }

  #abortReason(owner: RequestOwner): unknown {
    return (
      owner.controller.signal.reason ?? new DOMException('Observation cancelled', 'AbortError')
    );
  }

  #beginOwner(scope: string, identity: PlanOperationIdentity): RequestOwner {
    const controller = new AbortController();
    const owner: RequestOwner = {
      id: ++this.#nextOwnerId,
      scope,
      identity,
      controller,
      timer: setTimeout(() => {
        controller.abort(new DOMException('Plan observation timed out', 'TimeoutError'));
      }, this.#deadlineMs),
    };
    this.#activeOwner = owner;
    return owner;
  }

  #cancelActiveOwner(): void {
    const owner = this.#activeOwner;
    if (!owner) return;
    this.#activeOwner = null;
    clearTimeout(owner.timer);
    owner.controller.abort(new DOMException('Plan owner changed', 'AbortError'));
  }

  #releaseOwner(owner: RequestOwner): void {
    clearTimeout(owner.timer);
    if (this.#activeOwner !== owner) return;
    this.#activeOwner = null;
    this.busy = false;
    if (this.#storageDirty) {
      this.#storageDirty = false;
      const binding = this.#binding;
      if (binding) queueMicrotask(() => void this.initialize(binding));
    }
  }

  /** Settle even when a transport ignores owner cancellation. */
  #observe<T>(owner: RequestOwner, work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        owner.controller.signal.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () => finish(() => reject(this.#abortReason(owner)));
      if (!this.#isOwnerCurrent(owner)) {
        onAbort();
        return;
      }
      owner.controller.signal.addEventListener('abort', onAbort, { once: true });
      work.then(
        (value) =>
          finish(() =>
            this.#isOwnerCurrent(owner) ? resolve(value) : reject(this.#abortReason(owner)),
          ),
        (error) => finish(() => reject(error)),
      );
    });
  }

  #linkContext(owner: RequestOwner, context?: CommandContext): () => void {
    const signal = context?.signal;
    if (!signal) return () => {};
    const cancel = () => owner.controller.abort(signal.reason);
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    return () => signal.removeEventListener('abort', cancel);
  }

  #bindingMatches(record: PendingPlanOperation): boolean {
    const binding = this.#binding;
    return (
      binding !== null &&
      samePlanOperationIdentity(binding.identity, {
        actorId: record.actorId,
        orgId: record.orgId,
      }) &&
      samePlanContinuationContext(record.continuation, binding.continuation)
    );
  }

  #recordMessage(record: PendingPlanOperation): string {
    if (!this.#bindingMatches(record)) return m.pos_plan_pending_other_context();
    if (record.stage === 'continuation_applied') return m.pos_plan_recovery_finishing();
    if (record.planId) return m.pos_plan_created_refresh_failed();
    return m.pos_plan_create_unknown();
  }

  async initialize(binding: PlanOpenBinding): Promise<PendingPlanOperation['intent'] | null> {
    if (
      this.#disposed ||
      !binding.scope ||
      !binding.identity.actorId ||
      !binding.identity.orgId ||
      binding.scope !== this.#currentScope()
    ) {
      return null;
    }
    if (this.busy) {
      this.#storageDirty = true;
      return this.restoredIntent;
    }
    this.#binding = binding;
    this.#watch(binding);
    const owner = this.#beginOwner(binding.scope, binding.identity);
    this.busy = true;
    this.success = false;
    try {
      const record = await this.#persistence.read(binding.identity, owner.controller.signal);
      if (!this.#ownsUi(owner)) return null;
      this.#record = record;
      this.#persistenceBlocked = false;
      this.#restoreRequired = false;
      this.message = record ? this.#recordMessage(record) : null;
      return record && this.#bindingMatches(record) ? record.intent : null;
    } catch (error) {
      if (this.#ownsUi(owner)) {
        this.#record = null;
        this.#persistenceBlocked = true;
        this.message =
          error instanceof PlanPersistenceError &&
          (error.code === 'record_invalid' || error.code === 'record_too_large')
            ? m.pos_plan_recovery_invalid()
            : m.pos_plan_persistence_unavailable();
      }
      return null;
    } finally {
      this.#releaseOwner(owner);
    }
  }

  async #persistPlan(
    owner: RequestOwner,
    record: PendingPlanOperation,
    plan: { id: string },
  ): Promise<PendingPlanOperation> {
    const updated = await this.#persistence.update(
      owner.identity,
      record.operationId,
      owner.controller.signal,
      (current) => {
        if (current.planId && current.planId !== plan.id) {
          throw new PlanPersistenceError('record_invalid');
        }
        if (current.stage === 'continuation_applied') return current;
        return { ...current, planId: plan.id, stage: 'committed_refresh' };
      },
    );
    if (this.#ownsUi(owner)) this.#record = updated;
    return updated;
  }

  async #adoptReceiptIdentity(
    owner: RequestOwner,
    record: PendingPlanOperation,
    receipt: PlanOperationReceipt,
  ): Promise<PendingPlanOperation> {
    if (record.version === 2) {
      if (receipt.identityVersion !== 2 || receipt.clientKey !== record.intent.clientKey) {
        throw new PlanPersistenceError('record_invalid');
      }
      return record;
    }
    return this.#persistence.update(
      owner.identity,
      record.operationId,
      owner.controller.signal,
      (current) => {
        if (current.version !== 1) throw new PlanPersistenceError('record_invalid');
        const continuation: PlanOpenContinuation =
          current.continuation.kind === 'account'
            ? { ...current.continuation, clientKey: receipt.clientKey }
            : receipt.clientKey.startsWith('party:')
              ? { ...current.continuation, partyId: receipt.clientKey.slice('party:'.length) }
              : current.continuation;
        return { ...current, continuation };
      },
    );
  }

  async #prepareSellContinuation(
    owner: RequestOwner,
    operationId: string,
    postCart: FrozenPlanCartRow[],
  ): Promise<PreparedSellContinuation> {
    const updated = await this.#persistence.update(
      owner.identity,
      operationId,
      owner.controller.signal,
      (current) => {
        if (current.continuation.kind !== 'sell' || !current.planId) {
          throw new PlanPersistenceError('record_invalid');
        }
        if (
          current.continuation.postCart &&
          !sameFrozenCart(current.continuation.postCart, postCart)
        ) {
          throw new PlanPersistenceError('record_invalid');
        }
        if (current.stage === 'continuation_applied') return current;
        return {
          ...current,
          stage: 'continuation_pending',
          continuation: { ...current.continuation, postCart },
        };
      },
    );
    if (updated.continuation.kind !== 'sell' || updated.continuation.postCart === null) {
      throw new PlanPersistenceError('record_invalid');
    }
    if (this.#ownsUi(owner)) this.#record = updated;
    return {
      preCart: updated.continuation.preCart,
      postCart: updated.continuation.postCart,
    };
  }

  #publicOwner(
    owner: RequestOwner,
    record: PendingPlanOperation,
    allowCartReplace: boolean,
  ): PlanCreatedOwner {
    return {
      scope: owner.scope,
      operationId: record.operationId,
      stage: record.stage,
      allowCartReplace,
      isCurrent: () => this.#isOwnerCurrent(owner),
      prepareSellContinuation: (postCart) =>
        this.#prepareSellContinuation(owner, record.operationId, postCart),
    };
  }

  async #continuePlan(
    owner: RequestOwner,
    record: PendingPlanOperation,
    plan: { id: string },
    allowCartReplace: boolean,
  ): Promise<void> {
    const binding = this.#binding;
    if (!binding || !this.#bindingMatches(record)) {
      throw new PlanContinuationError('continuation_context_mismatch');
    }
    if (record.stage === 'continuation_applied') {
      const cleared = await this.#persistence.clear(
        owner.identity,
        record.operationId,
        owner.controller.signal,
      );
      if (!cleared) throw new PlanPersistenceError('operation_replaced');
      if (this.#ownsUi(owner)) this.#record = null;
      return;
    }
    await this.#observe(
      owner,
      Promise.resolve().then(() =>
        binding.afterCreated(plan, this.#publicOwner(owner, record, allowCartReplace)),
      ),
    );
    if (!this.#isOwnerCurrent(owner)) throw this.#abortReason(owner);
    const applied = await this.#persistence.update(
      owner.identity,
      record.operationId,
      owner.controller.signal,
      (current) => {
        if (current.planId !== plan.id) throw new PlanPersistenceError('record_invalid');
        if (
          current.continuation.kind === 'sell' &&
          (current.continuation.postCart === null ||
            !['continuation_pending', 'continuation_applied'].includes(current.stage))
        ) {
          throw new PlanPersistenceError('record_invalid');
        }
        return { ...current, stage: 'continuation_applied' };
      },
    );
    if (this.#ownsUi(owner)) this.#record = applied;
    const cleared = await this.#persistence.clear(
      owner.identity,
      record.operationId,
      owner.controller.signal,
    );
    if (!cleared) throw new PlanPersistenceError('operation_replaced');
    if (this.#ownsUi(owner)) this.#record = null;
  }

  #resolveOriginal(operationId: string, status: 'succeeded' | 'failed'): void {
    const ids = actionIds(this.#actions, operationId);
    if (!ids) return;
    if (ids.create !== undefined) {
      this.#actions?.reconcile(ids.create, status);
      if (status === 'failed') this.#actions?.dismiss(ids.create);
    }
    if (ids.cancel !== undefined) this.#actions?.reconcile(ids.cancel, 'succeeded');
    forgetActionIds(this.#actions, operationId);
  }

  async submit(input: PlanOpenSubmission): Promise<void> {
    if (
      this.#disposed ||
      this.busy ||
      this.locked ||
      input.scope !== this.#currentScope() ||
      !input.identity.actorId ||
      !input.identity.orgId
    ) {
      return;
    }
    this.#binding = input;
    this.#watch(input);
    const owner = this.#beginOwner(input.scope, input.identity);
    this.busy = true;
    this.message = null;
    this.success = false;
    let admitted: PendingPlanOperation | null = null;
    let identityResolved = false;
    let fetchInvoked = false;
    let completed = false;
    try {
      const canonicalIdentity = await resolvePlanIdentity({
        partyId: input.partyId,
        crmContactId: input.crmContactId,
        signal: owner.controller.signal,
        observe: (work) => this.#observe(owner, work),
      });
      identityResolved = true;
      if (!this.#ownsUi(owner)) return;
      const canonicalContinuation = canonicalPlanContinuation(
        input.continuation,
        canonicalIdentity,
      );
      const canonicalInput: PlanOpenSubmission = {
        ...input,
        partyId: canonicalIdentity.partyId,
        crmContactId: canonicalIdentity.crmContactId,
        continuation: canonicalContinuation,
      };
      this.#binding = canonicalInput;
      const admission = await this.#persistence.admit(
        input.identity,
        planOpenIntent(canonicalInput, canonicalIdentity),
        canonicalContinuation,
        owner.controller.signal,
      );
      if (!this.#ownsUi(owner)) return;
      admitted = admission.record;
      this.#record = admission.record;
      if (!admission.created) {
        this.message = this.#recordMessage(admission.record);
        return;
      }

      let acknowledgedPlan: { id: string } | null = null;
      const outcome = await runTrackedCommand(this.#actions, 'pos.plan.create', async (context) => {
        const unlink = this.#linkContext(owner, context);
        const ids = actionIds(this.#actions, admission.record.operationId);
        if (ids && context) ids.create = context.actionId;
        try {
          return await runCheckedMutation({
            context,
            attemptId: 'pos.plan.write',
            mutate: async () => {
              fetchInvoked = true;
              return createPlanOperation({
                record: admission.record,
                signal: owner.controller.signal,
                observe: (work) => this.#observe(owner, work),
              });
            },
            onCommitted: (plan) => {
              acknowledgedPlan = plan;
            },
            refresh: async () => {
              if (!acknowledgedPlan) throw new Error(m.pos_plan_created_refresh_failed());
              const current = await this.#persistPlan(owner, admission.record, acknowledgedPlan);
              await this.#continuePlan(owner, current, acknowledgedPlan, false);
            },
          });
        } finally {
          unlink();
        }
      });
      if (!this.#ownsUi(owner)) return;
      const ids = actionIds(this.#actions, admission.record.operationId);
      if (outcome.status === 'unknown') {
        try {
          this.#record = await this.#persistence.update(
            input.identity,
            admission.record.operationId,
            owner.controller.signal,
            (current) =>
              current.planId || current.stage === 'continuation_applied'
                ? current
                : { ...current, stage: 'unknown' },
          );
        } catch {
          this.#record = admission.record;
        }
        this.message =
          outcome.error instanceof UnknownCreateResponse
            ? outcome.error.detail
            : m.pos_plan_create_unknown();
      } else if (outcome.status === 'committed-refreshing') {
        this.message = m.pos_plan_created_refresh_failed();
      } else if (outcome.status === 'failed' || outcome.status === 'conflict') {
        if (
          outcome.error instanceof SafeCancelledCreate ||
          outcome.error instanceof SafeIdentityChangedCreate
        ) {
          const cleared = await this.#persistence.clear(
            input.identity,
            admission.record.operationId,
            owner.controller.signal,
          );
          if (cleared) {
            this.#record = null;
            if (ids?.create !== undefined) this.#actions?.dismiss(ids.create);
            forgetActionIds(this.#actions, admission.record.operationId);
            this.message =
              outcome.error instanceof SafeIdentityChangedCreate
                ? m.pos_plan_identity_changed()
                : m.pos_plan_request_cancelled();
          }
        } else if (!fetchInvoked) {
          const cleared = await this.#persistence.clear(
            input.identity,
            admission.record.operationId,
            owner.controller.signal,
          );
          if (cleared) this.#record = null;
          this.message = m.pos_plan_create_failed();
        } else {
          this.message = m.pos_plan_create_unknown();
        }
      } else if (outcome.status === 'succeeded') {
        this.success = true;
        this.message = m.pos_plan_reconciled();
        completed = true;
      }
    } catch (error) {
      if (this.#ownsUi(owner)) {
        if (error instanceof PlanContinuationError && error.code === 'cart_restore_required') {
          this.#restoreRequired = true;
          this.message = m.pos_plan_restore_required();
        } else if (!identityResolved) {
          this.#persistenceBlocked = false;
          this.message = m.pos_plan_identity_failed();
        } else if (
          admitted === null &&
          error instanceof PlanPersistenceError &&
          (error.code === 'record_invalid' || error.code === 'record_too_large')
        ) {
          this.#persistenceBlocked = false;
          this.message = m.pos_plan_request_invalid();
        } else {
          this.#persistenceBlocked = admitted === null;
          this.message = admitted
            ? m.pos_plan_create_unknown()
            : m.pos_plan_persistence_unavailable();
        }
      }
    } finally {
      const publishCompletion = completed && this.#ownsUi(owner);
      this.#releaseOwner(owner);
      if (publishCompletion && this.#currentScope() === input.scope) input.afterCompleted();
    }
  }

  async reconcile(options: { allowCartReplace?: boolean } = {}): Promise<void> {
    const record = this.#record;
    const binding = this.#binding;
    if (
      this.#disposed ||
      !record ||
      !binding ||
      this.busy ||
      !binding.scope ||
      binding.scope !== this.#currentScope()
    ) {
      return;
    }
    const owner = this.#beginOwner(binding.scope, binding.identity);
    let completed = false;
    this.busy = true;
    this.success = false;
    this.#restoreRequired = false;
    try {
      let current = record;
      let plan = current.planId ? { id: current.planId } : null;
      if (!plan) {
        const found = await lookupPlanOperation({
          record: current,
          signal: owner.controller.signal,
          observe: (work) => this.#observe(owner, work),
        });
        if (!found) {
          this.message = m.pos_plan_reconcile_missing();
          return;
        }
        current = await this.#adoptReceiptIdentity(owner, current, found);
        current = await this.#persistPlan(owner, current, found);
        plan = { id: found.id };
      }
      await this.#continuePlan(owner, current, plan, options.allowCartReplace ?? false);
      if (!this.#isOwnerCurrent(owner)) return;
      this.#resolveOriginal(record.operationId, 'succeeded');
      this.success = true;
      this.message = m.pos_plan_reconciled();
      completed = true;
    } catch (error) {
      if (!this.#ownsUi(owner)) return;
      if (error instanceof PlanContinuationError && error.code === 'cart_restore_required') {
        this.#restoreRequired = true;
        this.message = m.pos_plan_restore_required();
      } else if (
        error instanceof PlanContinuationError &&
        error.code === 'continuation_context_mismatch'
      ) {
        this.message = m.pos_plan_pending_other_context();
      } else {
        this.message = m.pos_plan_reconcile_failed();
      }
    } finally {
      const publishCompletion = completed && this.#ownsUi(owner);
      this.#releaseOwner(owner);
      if (publishCompletion && this.#currentScope() === binding.scope) binding.afterCompleted();
    }
  }

  async cancel(): Promise<void> {
    const record = this.#record;
    const binding = this.#binding;
    if (
      this.#disposed ||
      !record ||
      record.planId ||
      !binding ||
      this.busy ||
      binding.scope !== this.#currentScope()
    ) {
      return;
    }
    const owner = this.#beginOwner(binding.scope, binding.identity);
    let completed = false;
    this.busy = true;
    this.success = false;
    try {
      const receiptBox: { current: PlanCancelReceipt | null } = { current: null };
      const execute = async (context?: CommandContext) => {
        const unlink = this.#linkContext(owner, context);
        const ids = actionIds(this.#actions, record.operationId);
        if (ids && context && ids.cancel === undefined) ids.cancel = context.actionId;
        try {
          return await runCheckedMutation({
            context,
            attemptId: 'pos.plan.cancel-admission',
            mutate: () =>
              cancelPlanOperation({
                record,
                signal: owner.controller.signal,
                observe: (work) => this.#observe(owner, work),
              }),
            onCommitted: (receipt) => {
              receiptBox.current = receipt;
            },
            refresh: async () => {
              const receipt = receiptBox.current;
              if (!receipt) throw new Error(m.pos_plan_cancel_request_failed());
              if (receipt.status === 'cancelled') {
                const cleared = await this.#persistence.clear(
                  binding.identity,
                  record.operationId,
                  owner.controller.signal,
                );
                if (!cleared) throw new PlanPersistenceError('operation_replaced');
                if (this.#ownsUi(owner)) this.#record = null;
                return;
              }
              const found = await lookupPlanOperation({
                record,
                signal: owner.controller.signal,
                observe: (work) => this.#observe(owner, work),
              });
              if (!found || found.id !== receipt.plan.id) {
                throw new Error(m.pos_plan_reconcile_failed());
              }
              const identified = await this.#adoptReceiptIdentity(owner, record, found);
              const current = await this.#persistPlan(owner, identified, receipt.plan);
              await this.#continuePlan(owner, current, receipt.plan, false);
            },
          });
        } finally {
          unlink();
        }
      };
      const ids = actionIds(this.#actions, record.operationId);
      const outcome =
        ids?.cancel === undefined
          ? await runTrackedCommand(this.#actions, 'pos.plan.cancel-admission', execute)
          : await execute();
      if (!this.#ownsUi(owner)) return;
      const acknowledged = receiptBox.current;
      if (outcome.status === 'succeeded' && acknowledged) {
        this.#resolveOriginal(
          record.operationId,
          acknowledged.status === 'cancelled' ? 'failed' : 'succeeded',
        );
        this.success = true;
        this.message =
          acknowledged.status === 'cancelled'
            ? m.pos_plan_request_cancelled()
            : m.pos_plan_reconciled();
        completed = true;
      } else if (outcome.status === 'committed-refreshing') {
        if (
          outcome.error instanceof PlanContinuationError &&
          outcome.error.code === 'cart_restore_required'
        ) {
          this.#restoreRequired = true;
          this.message = m.pos_plan_restore_required();
        } else {
          this.message =
            acknowledged?.status === 'cancelled'
              ? m.pos_plan_cancelled_local_pending()
              : m.pos_plan_created_refresh_failed();
        }
      } else {
        this.message = m.pos_plan_cancel_request_failed();
      }
    } catch {
      if (this.#ownsUi(owner)) this.message = m.pos_plan_cancel_request_failed();
    } finally {
      const publishCompletion = completed && this.#ownsUi(owner);
      this.#releaseOwner(owner);
      if (publishCompletion && this.#currentScope() === binding.scope) binding.afterCompleted();
    }
  }
}
