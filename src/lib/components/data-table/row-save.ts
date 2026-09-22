import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';
import type { CommandContext, CommandOutcome } from '$lib/services/actions/definition';

export type Draft = Record<string, string>;
export type RowOutcome = {
  status: 'succeeded' | 'failed' | 'conflict' | 'unknown' | 'committed-refreshing';
  error?: unknown;
};
export type RowSaveResult = boolean | void | RowOutcome;
type Cell = {
  value: string;
  revision: number;
  status: 'pending' | 'committed' | 'failed' | 'unknown' | 'conflict';
};

/** The table owns draft revisions; the action runtime owns operation lifecycle. */
export function createRowSaveController(onChange: () => void = () => {}) {
  const listeners = new Set([onChange]);
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const rows = new Map<string, Map<string, Cell>>();
  const tails = new Map<string, Promise<unknown>>();
  const committed = new Map<string, Draft>();
  const canonicalRows = new Map<string, Draft>();
  const blocked = new Set<string>();
  let revision = 0;
  let generation = 0;
  let scopeKey: number | undefined;
  let disposed = false;
  const key = (id: string, column: string) => JSON.stringify([id, column]);
  function reconcileSettled(id: string) {
    if (disposed || tails.has(id)) return;
    const canonical = canonicalRows.get(id);
    if (!canonical) return;
    let dirty = false;
    const cells = rows.get(id);
    for (const [column, cell] of cells ?? []) {
      if (cell.status === 'committed' && canonical[column] === cell.value) {
        cells?.delete(column);
        delete committed.get(id)?.[column];
        dirty = true;
      }
    }
    if (!cells?.size) {
      rows.delete(id);
      canonicalRows.delete(id);
    }
    if (!Object.keys(committed.get(id) ?? {}).length) committed.delete(id);
    if (dirty) changed();
  }

  return {
    key,
    reset(nextScope: number) {
      if (disposed || scopeKey === nextScope) return;
      scopeKey = nextScope;
      generation++;
      rows.clear();
      tails.clear();
      canonicalRows.clear();
      committed.clear();
      blocked.clear();
      changed();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    view() {
      const values = new Map<string, Draft>();
      const pending = new Set<string>();
      const failed = new Set<string>();
      const conflicts = new Set<string>();
      for (const [id, cells] of rows) {
        const draft: Draft = {};
        for (const [column, cell] of cells) {
          draft[column] = cell.value;
          if (cell.status === 'pending') pending.add(key(id, column));
          if (cell.status === 'conflict') conflicts.add(id);
          if (cell.status === 'failed' || cell.status === 'unknown' || cell.status === 'conflict')
            failed.add(key(id, column));
        }
        values.set(id, draft);
      }
      return { values, pending, failed, conflicts, blocked: new Set(blocked) };
    },
    /** Reserve revision ownership before admission; preserve only unsent drafts. */
    prepareAdmissionFailure(id: string, draft: Draft) {
      const owner = ++revision;
      const ownerGeneration = generation;
      const attempted = { ...draft };
      return () => {
        if (disposed || generation !== ownerGeneration || blocked.has(id)) return;
        const cells = rows.get(id) ?? new Map<string, Cell>();
        for (const [column, value] of Object.entries(attempted)) {
          if ((cells.get(column)?.revision ?? -1) < owner)
            cells.set(column, { value, revision: owner, status: 'failed' });
        }
        if (cells.size) rows.set(id, cells);
        changed();
      };
    },
    reconcile(id: string, canonical: Draft) {
      if (!rows.has(id)) return;
      canonicalRows.set(id, { ...canonicalRows.get(id), ...canonical });
      reconcileSettled(id);
    },
    dispose() {
      disposed = true;
      rows.clear();
      canonicalRows.clear();
      committed.clear();
      blocked.clear();
      listeners.clear();
    },
    save<T>(
      id: string,
      row: T,
      base: Draft,
      changes: Draft,
      persist: (row: T, draft: Draft, context?: CommandContext) => Promise<RowSaveResult>,
      context?: CommandContext,
    ): Promise<RowOutcome> {
      if (disposed || blocked.has(id)) return Promise.resolve({ status: 'unknown' });
      const owner = ++revision;
      const ownerGeneration = generation;
      const cells = rows.get(id) ?? new Map<string, Cell>();
      for (const [column, value] of Object.entries(changes))
        cells.set(column, { value, revision: owner, status: 'pending' });
      rows.set(id, cells);
      changed();
      const run = async (): Promise<RowOutcome> => {
        if (disposed || ownerGeneration !== generation) return { status: 'unknown' };
        if (blocked.has(id) || (context && !context.isCurrent())) {
          for (const column of Object.keys(changes)) {
            const cell = cells.get(column);
            if (cell?.revision === owner) cell.status = 'unknown';
          }
          if (!disposed) changed();
          return { status: 'unknown' };
        }
        // Only acknowledged predecessors enter the full-row snapshot. Failed or
        // future drafts must never hitchhike on another cell's PATCH.
        const snapshot = { ...base, ...committed.get(id), ...changes };
        let outcome: RowOutcome;
        try {
          const result = await persist(row, snapshot, context);
          outcome =
            typeof result === 'object' && result !== null
              ? result
              : { status: result === false ? 'failed' : 'succeeded' };
        } catch (error) {
          outcome = { status: 'unknown', error };
        }
        if (disposed || ownerGeneration !== generation || (context && !context.isCurrent()))
          return outcome;
        const ok = outcome.status === 'succeeded' || outcome.status === 'committed-refreshing';
        if (ok) committed.set(id, { ...committed.get(id), ...changes });
        if (outcome.status === 'unknown' || outcome.status === 'conflict') blocked.add(id);
        for (const column of Object.keys(changes)) {
          const cell = cells.get(column);
          if (cell?.revision === owner)
            cell.status = ok
              ? 'committed'
              : outcome.status === 'unknown'
                ? 'unknown'
                : outcome.status === 'conflict'
                  ? 'conflict'
                  : 'failed';
        }
        changed();
        return outcome;
      };
      const result = (tails.get(id) ?? Promise.resolve()).then(run);
      tails.set(id, result);
      void result.finally(() => {
        if (ownerGeneration === generation && tails.get(id) === result) {
          tails.delete(id);
          reconcileSettled(id);
        }
      });
      return result;
    },
  };
}

/** PATCH acknowledgement and projection refresh are separate outcomes. Never retry here. */
export async function saveRowPatch(
  url: string,
  body: Record<string, unknown>,
  refresh?: () => Promise<void>,
  context?: CommandContext,
): Promise<RowOutcome> {
  const attempt = <T>(id: string, work: () => Promise<T>) =>
    context ? context.attempt(id, work) : work();
  let response: Response;
  try {
    response = await attempt('table.patch', () =>
      fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: context?.signal,
      }),
    );
  } catch (error) {
    return { status: 'unknown', error };
  }
  if (!response.ok)
    return {
      status: response.status === 409 ? 'conflict' : response.status >= 500 ? 'unknown' : 'failed',
    };
  // Stock returns the updated row; POS returns { ok: true, sellable }.
  // Respect explicit business rejections even when transport status is 2xx.
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      const payload: unknown = await response.json();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'ok' in payload &&
        payload.ok === false
      )
        return { status: 'failed' };
    } catch (error) {
      return { status: 'unknown', error };
    }
  }
  context?.acknowledge();
  if (!refresh) return { status: 'succeeded' };
  if (context && !context.isCurrent()) return { status: 'committed-refreshing' };
  try {
    await attempt('table.refresh', refresh);
    return { status: 'succeeded' };
  } catch (error) {
    return { status: 'committed-refreshing', error };
  }
}

export type RowSaveController = ReturnType<typeof createRowSaveController>;

/** Only a fully acknowledged batch can acknowledge its root operation. */
export function summarizeRowOutcomes(
  results: RowOutcome[],
  context?: Pick<CommandContext, 'acknowledge'>,
): CommandOutcome<RowOutcome[]> {
  if (results.some((r) => r.status === 'unknown')) return { status: 'unknown' };
  if (results.some((r) => r.status === 'failed' || r.status === 'conflict')) {
    return results.some((r) => r.status === 'succeeded' || r.status === 'committed-refreshing')
      ? { status: 'partial', value: results }
      : { status: results.some((r) => r.status === 'conflict') ? 'conflict' : 'failed' };
  }
  context?.acknowledge();
  return {
    status: results.some((r) => r.status === 'committed-refreshing')
      ? 'committed-refreshing'
      : 'succeeded',
    value: results,
  };
}

/** Refresh once for the entire edit/fill, including partially committed fills. */
export async function completeRowSaves(
  results: RowOutcome[],
  refresh?: () => Promise<void>,
  context?: CommandContext,
): Promise<CommandOutcome<RowOutcome[]>> {
  const outcome = summarizeRowOutcomes(results, context);
  if (
    !refresh ||
    !results.some((r) => r.status === 'succeeded' || r.status === 'committed-refreshing')
  )
    return outcome;
  try {
    if (context && !context.isCurrent()) throw new Error('Action scope changed');
    await (context ? context.attempt('table.refresh', refresh) : refresh());
    return outcome;
  } catch (error) {
    // A failed projection read cannot undo a committed write or hide uncertainty
    // about another row in a partially completed batch.
    return outcome.status === 'succeeded' || outcome.status === 'committed-refreshing'
      ? { status: 'committed-refreshing', value: results, error }
      : outcome;
  }
}

/** Admission can reject before execute, so callers must retain the unsent draft. */
export async function runDraftCommand<T>(
  runtime: Pick<ActionRuntime, 'runCommand'> | undefined,
  id: string,
  execute: (context?: CommandContext) => Promise<CommandOutcome<T>>,
  retainUnsent: () => void,
): Promise<CommandOutcome<T>> {
  let started = false;
  try {
    const admitted = (context?: CommandContext) => {
      started = true;
      return execute(context);
    };
    return await (runtime ? runtime.runCommand(id, admitted) : admitted());
  } catch (error) {
    if (!started) {
      retainUnsent();
      return { status: 'failed', error };
    }
    // The adapter owns any submitted revisions. Never turn an unexpected
    // post-dispatch failure into permission to resend the write.
    return { status: 'unknown', error };
  }
}
