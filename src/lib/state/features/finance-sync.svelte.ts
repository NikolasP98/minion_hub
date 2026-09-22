import { ApiError, fetchJson } from '$lib/api/fetch-json';
import * as m from '$lib/paraglide/messages';
import type { CommandContext, CommandOutcome } from '$lib/services/actions/definition';
import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';

type SyncState = {
  active: boolean;
  status: string | null;
  total: number | null;
  processed: number;
  error: string | null;
};
type SyncStatus = SyncState & { jobId?: string | null };
const initial = (): SyncState => ({
  active: false,
  status: null,
  total: null,
  processed: 0,
  error: null,
});
const POLL_MS = 1500;

/** App-owned monitor. Stopping observation never cancels the durable server job. */
export function createFinanceSync() {
  let s = $state<SyncState>(initial());
  let submissionUnknown = $state(false);
  let generation = 0;
  let controller: AbortController | undefined;
  let monitoring = false;
  let starting = false;
  let discovering = false;

  function stop() {
    generation++;
    controller?.abort();
    controller = undefined;
    monitoring = false;
    starting = false;
    discovering = false;
  }
  function apply(d: SyncStatus) {
    s.active = d.active ?? false;
    s.status = d.status ?? null;
    s.total = d.total == null ? null : Math.max(0, d.total);
    s.processed = Math.max(
      0,
      s.total == null ? (d.processed ?? 0) : Math.min(d.processed ?? 0, s.total),
    );
    s.error = d.error ?? null;
  }
  function delay(signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, POLL_MS);
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }
  function read(provider: string, signal: AbortSignal, jobId?: string) {
    const params = new URLSearchParams({ provider });
    if (jobId) params.set('jobId', jobId);
    return fetchJson<SyncStatus>(`/api/finances/sync/status?${params}`, { signal });
  }
  async function monitor(
    provider: string,
    jobId: string | undefined,
    token: number,
    signal: AbortSignal,
    ctx?: CommandContext,
  ): Promise<CommandOutcome<void>> {
    while (!signal.aborted && token === generation && (!ctx || ctx.isCurrent())) {
      try {
        const d = await read(provider, signal, jobId);
        if (signal.aborted || token !== generation || (ctx && !ctx.isCurrent())) break;
        if (jobId && d.jobId !== jobId) {
          s.error = m.fin_sync_status_unavailable();
          return { status: 'unknown', error: new Error(s.error) };
        }
        apply(d);
        if (d.total != null) ctx?.progress(s.processed, s.total ?? 0);
        if (!d.active) {
          if (d.status === 'succeeded') return { status: 'succeeded', value: undefined };
          if (d.status === 'failed' || d.status === 'cancelled') {
            return { status: 'failed', error: new Error(d.error ?? `Finance sync ${d.status}`) };
          }
          return { status: 'unknown', error: new Error(m.fin_sync_status_unavailable()) };
        }
      } catch (error) {
        if (signal.aborted || token !== generation || (ctx && !ctx.isCurrent())) break;
        // A failed status read says nothing about whether the server job is running.
        s.error = error instanceof Error ? error.message : m.fin_sync_status_unavailable();
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          return { status: 'unknown', error };
        }
      }
      await delay(signal);
    }
    return { status: 'unknown' };
  }
  function launch(
    token: number,
    actions: ActionRuntime | undefined,
    execute: (ctx?: CommandContext) => Promise<CommandOutcome<void>>,
  ) {
    monitoring = true;
    const task = actions
      ? actions.runCommand('finance.sync', async (ctx) => {
          const abort = () => {
            if (token === generation) {
              stop();
              submissionUnknown = false;
              s = initial();
            }
          };
          ctx.signal.addEventListener('abort', abort, { once: true });
          try {
            return await execute(ctx);
          } finally {
            ctx.signal.removeEventListener('abort', abort);
          }
        })
      : execute();
    void task
      .catch((error: unknown) => {
        if (token === generation)
          s.error = error instanceof Error ? error.message : m.fin_sync_status_unavailable();
      })
      .finally(() => {
        if (token === generation) {
          monitoring = false;
          starting = false;
        }
      });
    return task;
  }

  return {
    get outcomeUnknown() {
      return submissionUnknown;
    },
    get active() {
      return s.active;
    },
    get status() {
      return s.status;
    },
    get total() {
      return s.total;
    },
    get processed() {
      return s.processed;
    },
    get error() {
      return s.error;
    },
    get percent() {
      return s.total && s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;
    },

    async refresh(provider = 'susii', actions?: ActionRuntime) {
      if (monitoring || starting || discovering) return;
      discovering = true;
      const token = generation;
      controller ??= new AbortController();
      const signal = controller.signal;
      try {
        const d = await read(provider, signal);
        if (signal.aborted || token !== generation) return;
        apply(d);
        if (d.active) {
          launch(token, actions, async (ctx) => {
            if (d.jobId) {
              ctx?.acknowledge();
              ctx?.attachJob(d.jobId);
            } else if (ctx)
              return { status: 'unknown', error: new Error(m.fin_sync_status_unavailable()) };
            return monitor(provider, d.jobId ?? undefined, token, signal, ctx);
          });
        }
      } catch {
        /* A background discovery failure does not overwrite known server state. */
      } finally {
        if (token === generation) discovering = false;
      }
    },

    /** Returns after acceptance; the same action remains tracked until job completion. */
    async start(provider = 'susii', actions?: ActionRuntime) {
      if (starting || monitoring || s.active || submissionUnknown) return;
      if (discovering) stop();
      starting = true;
      s.error = null;
      const token = generation;
      controller = new AbortController();
      const signal = controller.signal;
      let accepted!: () => void;
      const acceptance = new Promise<void>((resolve) => {
        accepted = resolve;
      });
      const execute = async (ctx?: CommandContext): Promise<CommandOutcome<void>> => {
        try {
          const request = () =>
            fetchJson<{ jobId?: string }>('/api/finances/sync', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ provider }),
              signal,
            });
          const response = ctx
            ? await ctx.attempt('finance.sync.enqueue', request)
            : await request();
          if (signal.aborted || token !== generation || (ctx && !ctx.isCurrent()))
            return { status: 'unknown' };
          ctx?.acknowledge();
          s.active = true;
          s.status = 'running';
          if (!response?.jobId && ctx) {
            submissionUnknown = true;
            s.status = 'unknown';
            s.error = m.fin_sync_unknown();
            return { status: 'unknown', error: new Error(s.error) };
          }
          if (response?.jobId) ctx?.attachJob(response.jobId);
          // Preserve start()'s initial status refresh, but release its caller while polling continues.
          const tracked = monitor(provider, response?.jobId, token, signal, ctx);
          accepted();
          return await tracked;
        } catch (error) {
          if (token !== generation || signal.aborted || (ctx && !ctx.isCurrent()))
            return { status: 'unknown' };
          const unknown = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
          submissionUnknown = unknown;
          s.active = false;
          s.status = unknown ? 'unknown' : 'error';
          s.error = error instanceof Error ? error.message : m.fin_sync_error();
          return { status: unknown ? 'unknown' : 'failed', error };
        } finally {
          if (token === generation) starting = false;
          accepted();
        }
      };
      try {
        await Promise.race([acceptance, launch(token, actions, execute)]);
      } catch (error) {
        starting = false;
        monitoring = false;
        accepted();
        if (token === generation) {
          s.status = 'error';
          s.error = error instanceof Error ? error.message : m.fin_sync_error();
        }
      }
      await acceptance;
    },

    async cancel(provider = 'susii') {
      const token = generation;
      try {
        await fetchJson('/api/finances/sync/cancel', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider }),
        });
        // Polling owns canonical completion; acceptance of cancellation is not completion.
        if (!monitoring && token === generation) await this.refresh(provider);
      } catch (cause) {
        if (token === generation)
          s.error = cause instanceof Error ? cause.message : m.fin_sync_error();
      }
    },
    stop,
    reset() {
      stop();
      submissionUnknown = false;
      s = initial();
    },
  };
}

export const financeSync = createFinanceSync();
