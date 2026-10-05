import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';
import type { CommandContext, CommandOutcome } from '$lib/services/actions/definition';
import { requireOk, runCheckedMutation, runTrackedCommand } from '$lib/services/actions/mutations';

export interface LinkDraft {
  title: string;
  slug: string;
  eventTypeIds: string[];
}
export type CollectionIntent = { kind: 'delete'; id: string } | { kind: 'create'; link: LinkDraft };
export type Reconciliation = 'matched' | 'absent' | 'present' | 'conflict';
export type CollectionIssue = 'rejected' | 'unknown' | 'committed-refreshing' | 'unconfirmed';

/** Compare the canonical identity returned by the org-scoped link projection. */
export function reconcileLink(draft: LinkDraft, rows: readonly LinkDraft[]): Reconciliation {
  const row = rows.find((candidate) => candidate.slug === draft.slug);
  if (!row) return 'absent';
  const ids = (values: readonly string[]) => JSON.stringify([...new Set(values)].sort());
  return row.title === draft.title && ids(row.eventTypeIds) === ids(draft.eventTypeIds)
    ? 'matched'
    : 'conflict';
}

/**
 * One bounded mutation owner per collection page. A deadline ends observation,
 * never asserts rollback. Unknown writes retain one snapshot for read-only repair.
 * The local fence also protects standalone mounts without an application runtime.
 */
export function createCollectionMutations(options: {
  id: string;
  runtime?: ActionRuntime;
  scope: () => string;
  refresh: () => Promise<void>;
  reconcile: (intent: CollectionIntent) => Reconciliation;
  committed: (intent: CollectionIntent) => void;
  rejectionMessage: () => string;
  deadlineMs?: number;
}) {
  let busy = $state(false);
  let issue = $state<CollectionIssue | null>(null);
  let retained = $state<CollectionIntent | null>(null);
  let reconciled = $state(false);
  let generation = 0;
  let disposed = false;
  let ownerScope = options.scope();
  let cancel: (() => void) | undefined;
  let originalActionId: number | undefined;

  function reset() {
    generation++;
    cancel?.();
    cancel = undefined;
    busy = false;
    issue = null;
    retained = null;
    reconciled = false;
    originalActionId = undefined;
    ownerScope = options.scope();
  }

  function syncScope() {
    if (ownerScope !== options.scope()) reset();
  }

  async function observe(
    run: (context: CommandContext, live: () => boolean) => Promise<CommandOutcome<void>>,
    commandId: string,
    trackWrite = true,
  ): Promise<CommandOutcome<void> | undefined> {
    const ownGeneration = ++generation;
    const scope = options.scope();
    const controller = new AbortController();
    let alive = true;
    let acknowledged = false;
    const current = () =>
      alive && !disposed && generation === ownGeneration && options.scope() === scope;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelObservation: (() => void) | undefined;
    const outcome = await runTrackedCommand(
      trackWrite ? options.runtime : undefined,
      commandId,
      async (parent) => {
        if (trackWrite) originalActionId = parent?.actionId;
        const live = () => current() && (parent?.isCurrent() ?? true);
        const context: CommandContext = {
          signal: controller.signal,
          actionId: parent?.actionId ?? ownGeneration,
          isCurrent: live,
          acknowledge() {
            if (!live()) return;
            acknowledged = true;
            parent?.acknowledge();
          },
          attempt: (id, work) => {
            if (!live()) return Promise.reject(new DOMException('Scope changed', 'AbortError'));
            return parent ? parent.attempt(id, work) : work();
          },
          attachJob: (id) => parent?.attachJob(id),
          progress: (completed, total) => parent?.progress(completed, total),
        };
        const stopped = new Promise<CommandOutcome<void>>((resolve) => {
          cancelObservation = () => {
            alive = false;
            controller.abort();
            resolve({ status: acknowledged ? 'committed-refreshing' : 'unknown' });
          };
          cancel = cancelObservation;
          timer = setTimeout(cancelObservation, options.deadlineMs ?? 15_000);
        });
        parent?.signal.addEventListener('abort', cancelObservation!, { once: true });
        try {
          if (parent?.signal.aborted) cancelObservation!();
          return await Promise.race([stopped, run(context, live)]);
        } finally {
          parent?.signal.removeEventListener('abort', cancelObservation!);
          clearTimeout(timer);
        }
      },
    );
    alive = false;
    clearTimeout(timer);
    if (cancel === cancelObservation) cancel = undefined;
    if (disposed || generation !== ownGeneration || options.scope() !== scope) return;
    return outcome;
  }

  function resolveOriginal(status: 'succeeded' | 'conflict') {
    if (originalActionId !== undefined) options.runtime?.reconcile(originalActionId, status);
    if (status === 'succeeded') originalActionId = undefined;
  }

  return {
    get busy() {
      return busy;
    },
    get locked() {
      return busy || retained !== null;
    },
    get issue() {
      return issue;
    },
    get canRefresh() {
      return retained !== null;
    },
    get canDiscard() {
      return retained?.kind === 'create' && reconciled && !busy;
    },
    syncScope,
    dispose() {
      reset();
      disposed = true;
    },
    discard() {
      if (retained?.kind !== 'create' || !reconciled || busy) return false;
      reset();
      return true;
    },
    async execute(intent: CollectionIntent, request: (signal: AbortSignal) => Promise<Response>) {
      syncScope();
      if (disposed || busy || retained) return;
      // A deliberate retry acknowledges the preceding known rejection/conflict.
      // Unknown outcomes stay retained and cannot enter this path.
      if (originalActionId !== undefined) options.runtime?.dismiss(originalActionId);
      // Never retain a mutable form proxy or an unbounded history of submissions.
      const snapshot: CollectionIntent =
        intent.kind === 'delete'
          ? { ...intent }
          : {
              kind: 'create',
              link: { ...intent.link, eventTypeIds: [...intent.link.eventTypeIds] },
            };
      retained = snapshot;
      reconciled = false;
      busy = true;
      issue = null;
      const outcome = await observe(
        (context, live) =>
          runCheckedMutation({
            context,
            attemptId: `${options.id}.${snapshot.kind}.write`,
            mutate: async () => {
              if (!live()) throw new DOMException('Scope changed', 'AbortError');
              await requireOk(await request(context.signal), options.rejectionMessage());
            },
            onCommitted: () => options.committed(snapshot),
            refresh: async () => {
              if (live()) await options.refresh();
            },
          }),
        `${options.id}.${snapshot.kind}`,
      );
      if (!outcome) return;
      busy = false;
      if (outcome.status === 'succeeded') {
        retained = null;
      } else if (outcome.status === 'unknown' || outcome.status === 'committed-refreshing') {
        issue = outcome.status;
      } else {
        retained = null;
        issue = 'rejected';
      }
    },
    async refresh() {
      syncScope();
      if (disposed || busy || !retained) return;
      const intent = retained;
      const priorIssue = issue;
      busy = true;
      const outcome = await observe(
        async (_context, live) => {
          try {
            if (!live()) return { status: 'unknown' };
            await options.refresh();
            return live() ? { status: 'succeeded', value: undefined } : { status: 'unknown' };
          } catch {
            return { status: 'failed' };
          }
        },
        `${options.id}.reconcile`,
        false,
      );
      if (!outcome) return;
      busy = false;
      if (outcome.status !== 'succeeded') return; // Preserve both snapshot and original uncertainty.
      if (priorIssue === 'committed-refreshing') {
        resolveOriginal('succeeded');
        retained = null;
        issue = null;
        return;
      }
      const result = options.reconcile(intent);
      reconciled = true;
      if (intent.kind === 'delete') {
        resolveOriginal(result === 'absent' ? 'succeeded' : 'conflict');
        retained = null;
        issue = result === 'absent' ? null : 'unconfirmed';
      } else if (result === 'matched') {
        options.committed(intent);
        resolveOriginal('succeeded');
        retained = null;
        issue = null;
      } else {
        issue = 'unknown';
      }
    },
  };
}
