import { SvelteMap } from 'svelte/reactivity';
import {
  defineCommandAction,
  type ActionVisibility,
  type ReadAction,
  type CommandAction,
  type CommandContext,
  type CommandOutcome,
} from './definition';

export type ActionStatus =
  | 'pending'
  | 'acknowledged'
  | 'job-running'
  | 'succeeded'
  | 'failed'
  | 'conflict'
  | 'unknown'
  | 'committed-refreshing'
  | 'partial'
  | 'cancelled';
export interface ActionAttempt {
  readonly id: number;
  readonly definitionId: string;
  readonly status: 'pending' | 'succeeded' | 'failed';
}
export interface ActionRecord {
  readonly id: number;
  readonly definitionId: string;
  readonly policy: 'read' | 'confirmed';
  readonly visibility: ActionVisibility;
  readonly status: ActionStatus;
  readonly startedAt: number;
  readonly settledAt?: number;
  readonly jobId?: string;
  readonly progress?: Readonly<{ completed: number; total: number }>;
  readonly attempts: readonly ActionAttempt[];
}
export type ActionResult<T> = CommandOutcome<T> | { status: 'cancelled' };
export interface ActionHandle<T> {
  readonly id: number;
  readonly result: Promise<ActionResult<T>>;
  cancel(): void;
}
export interface ActionEvent {
  readonly type: 'started' | 'acknowledged' | 'attempt' | 'job-attached' | 'progress' | 'settled';
  readonly action: ActionRecord;
}
const HISTORY_LIMIT = 100;
const HISTORY_TTL = 5 * 60_000;
const ACTIVE_LIMIT = 128;
const ATTEMPT_LIMIT = 32;
const INDICATOR_DELAY = 150;
const attentionStatuses = new Set<ActionStatus>([
  'failed',
  'conflict',
  'unknown',
  'committed-refreshing',
  'partial',
]);

/** One instance per application context (or SSR request), never a module singleton. */
export function createActionRuntime() {
  const records = new SvelteMap<number, ActionRecord>();
  const active = new Map<number, () => void>();
  const settled = new Map<number, number>();
  const attentionIds = new SvelteMap<number, true>();
  const jobIds = new SvelteMap<number, true>();
  const listeners = new Set<(event: ActionEvent) => void>();
  let foregroundPending = $state(0);
  let backgroundPending = $state(0);
  let indicatorVisible = $state(false);
  let indicatorTimer: ReturnType<typeof setTimeout> | undefined;
  let retentionTimer: ReturnType<typeof setTimeout> | undefined;
  let nextId = 0;
  let navigationPending = 0;
  let disposed = false;
  let clearing = false;
  let scopeKey: string | undefined;
  let generation = $state(0);

  function emit(type: ActionEvent['type'], action: ActionRecord) {
    const event = Object.freeze({ type, action });
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        /* Observers cannot change task outcomes. */
      }
    }
  }
  function updateCount(visibility: ActionVisibility, delta: number) {
    if (visibility === 'background') {
      backgroundPending += delta;
      return;
    }
    foregroundPending += delta;
    if (foregroundPending === 0) {
      clearTimeout(indicatorTimer);
      indicatorTimer = undefined;
      indicatorVisible = false;
    } else if (!indicatorVisible && indicatorTimer === undefined) {
      indicatorTimer = setTimeout(() => {
        indicatorTimer = undefined;
        indicatorVisible = foregroundPending > 0;
      }, INDICATOR_DELAY);
    }
  }
  function prune() {
    clearTimeout(retentionTimer);
    retentionTimer = undefined;
    const cutoff = Date.now() - HISTORY_TTL;
    for (const [id, time] of settled) {
      if (time > cutoff && settled.size <= HISTORY_LIMIT) break;
      settled.delete(id);
      records.delete(id);
    }
    const oldest = settled.values().next().value;
    if (oldest !== undefined)
      retentionTimer = setTimeout(prune, Math.max(1, oldest + HISTORY_TTL - Date.now()));
  }

  function begin<I, O>(
    definition: ReadAction<I, O> | CommandAction<I, O>,
    input: I,
  ): ActionHandle<O> {
    if (disposed || clearing) throw new Error('Action runtime is unavailable');
    if (!['read', 'confirmed'].includes(definition.policy))
      throw new TypeError('Unsupported action policy');
    // Unresolved command identities cannot be silently evicted to admit more writes.
    const navigation = definition.policy === 'read' && definition.id === 'navigation.load';
    const used =
      active.size - navigationPending + (definition.policy === 'confirmed' ? attentionIds.size : 0);
    if (navigation ? navigationPending >= 2 : used >= ACTIVE_LIMIT)
      throw new Error('Action runtime capacity reached');
    const id = ++nextId,
      capturedGeneration = generation;
    const controller = new AbortController();
    let record: ActionRecord = Object.freeze({
      id,
      definitionId: definition.id,
      policy: definition.policy,
      visibility: definition.visibility,
      status: 'pending',
      startedAt: Date.now(),
      attempts: Object.freeze([]),
    });
    let resolve!: (result: ActionResult<O>) => void;
    const result = new Promise<ActionResult<O>>((done) => {
      resolve = done;
    });
    let finished = false,
      acknowledged = false,
      executing = false,
      job = false;
    let attemptId = 0;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingProgress: Readonly<{ completed: number; total: number }> | undefined;
    let lastProgressAt = -Infinity;
    const isCurrent = () =>
      !disposed && !clearing && capturedGeneration === generation && !finished;
    function publish(patch: Partial<ActionRecord>, type: ActionEvent['type']) {
      if (!isCurrent()) return;
      record = Object.freeze({ ...record, ...patch });
      records.set(id, record);
      emit(type, record);
    }
    function finish(outcome: ActionResult<O>) {
      if (finished) return;
      finished = true;
      clearTimeout(progressTimer);
      active.delete(id);
      if (navigation) navigationPending--;
      if (job) jobIds.delete(id);
      else updateCount(record.visibility, -1);
      record = Object.freeze({ ...record, status: outcome.status, settledAt: Date.now() });
      records.set(id, record);
      if (definition.policy === 'confirmed' && attentionStatuses.has(outcome.status))
        attentionIds.set(id, true);
      else {
        settled.set(id, record.settledAt!);
        prune();
      }
      resolve(outcome);
      emit('settled', record);
    }
    function cancel() {
      if (finished) return;
      if (definition.policy === 'read') finish({ status: 'cancelled' });
      else
        finish({
          status: acknowledged && !job ? 'committed-refreshing' : executing ? 'unknown' : 'failed',
          error: new DOMException('Observation cancelled', 'AbortError'),
        });
      controller.abort(); // Stops local observation/reads; never promises server-side Undo.
    }
    const context: CommandContext = {
      signal: controller.signal,
      actionId: id,
      isCurrent,
      acknowledge() {
        if (!isCurrent()) return;
        acknowledged = true;
        if (!job) publish({ status: 'acknowledged' }, 'acknowledged');
      },
      async attempt<T>(definitionId: string, work: () => Promise<T>): Promise<T> {
        if (!isCurrent()) throw new DOMException('Action scope changed', 'AbortError');
        if (!/^[a-z][a-z0-9.-]*$/.test(definitionId))
          throw new TypeError('Attempt requires a stable id');
        const childId = ++attemptId;
        const child: ActionAttempt = Object.freeze({
          id: childId,
          definitionId,
          status: 'pending',
        });
        publish(
          { attempts: Object.freeze([...record.attempts.slice(-(ATTEMPT_LIMIT - 1)), child]) },
          'attempt',
        );
        if (!isCurrent())
          throw new DOMException('Action scope changed before dispatch', 'AbortError');
        const settleAttempt = (status: 'succeeded' | 'failed') => {
          publish(
            {
              attempts: Object.freeze(
                record.attempts.map((a) =>
                  a.id === childId ? Object.freeze({ ...a, status }) : a,
                ),
              ),
            },
            'attempt',
          );
        };
        try {
          const value = await work();
          settleAttempt('succeeded');
          return value;
        } catch (error) {
          settleAttempt('failed');
          throw error;
        }
      },
      attachJob(jobId: string) {
        if (!isCurrent()) return;
        if (!jobId || jobId.length > 200)
          throw new TypeError('Job requires a bounded durable identity');
        if (record.jobId && record.jobId !== jobId)
          throw new Error('Action already owns a different job');
        acknowledged = true;
        if (!job) {
          job = true;
          updateCount(record.visibility, -1);
          jobIds.set(id, true);
        }
        publish({ status: 'job-running', jobId }, 'job-attached');
      },
      progress(completed, total) {
        if (!isCurrent() || !Number.isFinite(completed) || !Number.isFinite(total) || total <= 0)
          return;
        pendingProgress = Object.freeze({
          completed: Math.max(0, Math.min(completed, total)),
          total,
        });
        const flush = () => {
          progressTimer = undefined;
          if (!pendingProgress) return;
          lastProgressAt = Date.now();
          publish({ progress: pendingProgress }, 'progress');
          pendingProgress = undefined;
        };
        if (Date.now() - lastProgressAt >= 100 || completed >= total) {
          clearTimeout(progressTimer);
          flush();
        } else if (progressTimer === undefined)
          progressTimer = setTimeout(flush, 100 - (Date.now() - lastProgressAt));
      },
    };
    active.set(id, cancel);
    if (navigation) navigationPending++;
    records.set(id, record);
    updateCount(record.visibility, 1);
    emit('started', record);
    void Promise.resolve().then(async () => {
      if (finished) return;
      executing = true;
      try {
        if (definition.policy === 'read') {
          const value = await definition.execute(input, { signal: controller.signal });
          finish({ status: 'succeeded', value });
        } else {
          const outcome = await definition.execute(input, context);
          // No `false`/undefined/HTTP-success inference for confirmed commands.
          if (
            !outcome ||
            ![
              'succeeded',
              'failed',
              'conflict',
              'unknown',
              'committed-refreshing',
              'partial',
            ].includes(outcome.status)
          ) {
            throw new TypeError('Command adapter must classify its outcome');
          }
          finish(outcome);
        }
      } catch (error) {
        if (definition.policy === 'read') finish({ status: 'failed', error });
        else if (acknowledged && !job) finish({ status: 'committed-refreshing', error });
        else finish({ status: 'unknown', error });
      }
    });
    return Object.freeze({ id, result, cancel });
  }
  function clearScope() {
    if (clearing) return;
    clearing = true;
    generation++;
    for (const cancel of [...active.values()]) cancel();
    records.clear();
    settled.clear();
    attentionIds.clear();
    jobIds.clear();
    clearTimeout(retentionTimer);
    retentionTimer = undefined;
    clearing = false;
  }
  return {
    get scopeVersion() {
      return generation;
    },
    get foregroundPending() {
      return foregroundPending;
    },
    get backgroundPending() {
      return backgroundPending;
    },
    get backgroundJobs() {
      return jobIds.size;
    },
    get attentionRequired() {
      return attentionIds.size;
    },
    get attention() {
      return [...attentionIds.keys()].map((id) => records.get(id)!);
    },
    get jobs() {
      return [...jobIds.keys()].map((id) => records.get(id)!);
    },
    get indicatorVisible() {
      return indicatorVisible;
    },
    get size() {
      return records.size;
    },
    get(id: number) {
      return records.get(id);
    },
    start: begin,
    run<I, O>(definition: ReadAction<I, O> | CommandAction<I, O>, input: I) {
      return begin(definition, input).result;
    },
    async runCommand<O>(
      id: string,
      execute: (context: CommandContext) => Promise<CommandOutcome<O>>,
    ): Promise<CommandOutcome<O>> {
      const definition = defineCommandAction({
        id,
        policy: 'confirmed',
        visibility: 'foreground',
        execute: (_: undefined, context: CommandContext) => execute(context),
      });
      const result = await begin(definition, undefined).result;
      return result.status === 'cancelled' ? { status: 'failed' } : result;
    },
    /** Only known rejected/partial outcomes may be acknowledged without reconciliation. */
    dismiss(id: number) {
      const record = records.get(id);
      if (
        !record ||
        !['failed', 'conflict', 'partial'].includes(record.status) ||
        !attentionIds.has(id)
      )
        return false;
      attentionIds.delete(id);
      settled.set(id, Date.now());
      prune();
      return true;
    },
    /** Adapter-only reconciliation after an authoritative read of the SAME operation. */
    reconcile(id: number, status: 'succeeded' | 'failed' | 'conflict') {
      const record = records.get(id);
      if (!record || !attentionIds.has(id)) return false;
      const next = Object.freeze({ ...record, status, settledAt: Date.now() });
      records.set(id, next);
      if (status === 'succeeded') {
        attentionIds.delete(id);
        settled.set(id, next.settledAt);
        prune();
      }
      emit('settled', next);
      return true;
    },
    subscribe(listener: (event: ActionEvent) => void) {
      if (disposed) throw new Error('Action runtime is disposed');
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setScope(key: string) {
      if (scopeKey === key) return;
      scopeKey = key;
      clearScope();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearScope();
      listeners.clear();
      clearTimeout(indicatorTimer);
    },
  };
}
export type ActionRuntime = ReturnType<typeof createActionRuntime>;
