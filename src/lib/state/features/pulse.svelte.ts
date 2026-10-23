import { page } from '$app/state';
import { canViewPath } from '$lib/access/can.svelte';
import type { PulseProposalView } from '$server/services/pulse.service';
import type { PulseReceipt } from '$server/services/pulse-dispatch.store';
import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';
import type { CommandOutcome } from '$lib/services/actions/definition';
import { requireOk, runCheckedMutation, runTrackedCommand } from '$lib/services/actions/mutations';
import * as m from '$lib/paraglide/messages';

const attemptedIds = new Set<string>();
let scopeGeneration = 0;
let readEpoch = 0;
let readSequence = 0;
let countRead = 0;
let itemsRead = 0;
let refreshSequence = 0;
const receiptReads = new Map<string, number>();
type ActiveDecision = {
  id: string;
  scope: number;
  latest?: { receipt: PulseReceipt; version: number };
};
// Only one decision is admitted at a time. Its evidence survives recent-cache
// eviction until completion, without retaining a permanent per-id tombstone.
let activeDecision: ActiveDecision | undefined;
function retireReads() {
  readEpoch += 1;
  refreshSequence += 1;
  receiptReads.clear();
}
function beginRead() {
  const scope = scopeGeneration;
  const epoch = readEpoch;
  return () => scope === scopeGeneration && epoch === readEpoch;
}
function beginCountRead() {
  const current = beginRead();
  const request = (countRead = ++readSequence);
  return {
    current: () => current() && countRead === request,
    publish: (count: number) => {
      if (current() && countRead === request) s.pendingCount = count;
    },
  };
}
function publishReceipt(id: string, receipt: PulseReceipt, version: number) {
  if (
    activeDecision?.id === id &&
    activeDecision.scope === scopeGeneration &&
    version >= (activeDecision.latest?.version ?? -1)
  )
    activeDecision.latest = { receipt, version };
  // Recent receipts are bounded just like the server reader; in-flight tokens are
  // removed on completion and never become a permanent per-id version history.
  const entries = Object.entries(s.receipts).filter(([key]) => key !== id);
  entries.push([id, receipt]);
  s.receipts = Object.fromEntries(entries.slice(-50));
  attemptedIds.delete(id);
}
function latestDecisionOutcome(
  decision: ActiveDecision,
  outcome: CommandOutcome<PulseReceipt>,
): CommandOutcome<PulseReceipt> {
  if (decision.scope !== scopeGeneration || activeDecision !== decision)
    return { status: 'unknown' };
  if ('value' in outcome && outcome.value && decision.latest) {
    const { receipt, version } = decision.latest;
    publishReceipt(decision.id, receipt, version);
    return { ...outcome, value: receipt };
  }
  return outcome;
}
let currentScope: string | number | undefined;
let pendingRecovery: { refresh?: () => Promise<void> } | undefined;
function drainRecovery() {
  const pending = pendingRecovery;
  pendingRecovery = undefined;
  if (pending) void recover(pending.refresh);
}
type Recovery = 'unknown' | 'committed-refreshing' | 'conflict';
let s = $state<{
  pendingCount: number;
  items: PulseProposalView[];
  receipts: Record<string, PulseReceipt>;
  recovery: Recovery | null;
  error: string | null;
  busy: boolean;
}>({ pendingCount: 0, items: [], receipts: {}, recovery: null, error: null, busy: false });
async function fetchCount() {
  const read = beginCountRead();
  try {
    const response = await requireOk(await fetch('/api/pulse/count'), m.pulse_readFailed());
    const data = await response.json();
    if (!read.current()) return false;
    read.publish(data.count ?? 0);
    return true;
  } catch (cause) {
    if (read.current()) throw cause;
    return false;
  }
}
async function fetchItems() {
  const current = beginRead();
  const request = (itemsRead = ++readSequence);
  const isCurrent = () => current() && request === itemsRead;
  try {
    const response = await requireOk(await fetch('/api/pulse/proposals'), m.pulse_readFailed());
    const data = await response.json();
    if (!isCurrent()) return false;
    s.items = data.proposals ?? [];
    return true;
  } catch (cause) {
    if (isCurrent()) throw cause;
    return false;
  }
}
async function readReceipt(id: string) {
  const current = beginRead();
  const request = ++readSequence;
  receiptReads.set(id, request);
  const isCurrent = () => current() && receiptReads.get(id) === request;
  try {
    const response = await requireOk(
      await fetch(`/api/pulse/proposals/${id}/receipt`),
      m.pulse_readFailed(),
    );
    const receipt = (await response.json()) as PulseReceipt;
    if (!isCurrent()) return undefined;
    if (receipt.decision !== 'pending') publishReceipt(id, receipt, request);
    else attemptedIds.delete(id);
    return receipt;
  } catch (cause) {
    if (isCurrent()) throw cause;
    return undefined;
  } finally {
    if (receiptReads.get(id) === request) receiptReads.delete(id);
  }
}
async function refreshAll() {
  const current = beginRead();
  const refresh = ++refreshSequence;
  const results = await Promise.all([
    fetchItems(),
    fetchCount(),
    ...[...new Set([...Object.keys(s.receipts), ...attemptedIds])].map(
      async (id) => (await readReceipt(id)) !== undefined,
    ),
  ]);
  return current() && refresh === refreshSequence && results.every(Boolean);
}
async function recover(refresh?: () => Promise<void>) {
  if (s.busy) {
    pendingRecovery = { refresh: refresh ?? pendingRecovery?.refresh };
    return;
  }
  s.busy = true;
  const generation = scopeGeneration;
  const current = beginRead();
  const refreshToken = refreshSequence + 1;
  try {
    if (!(await refreshAll()) || !current() || refreshToken !== refreshSequence) return;
    await refresh?.();
    if (current() && refreshToken === refreshSequence) {
      s.recovery = null;
      s.error = null;
    }
  } catch {
    if (current() && refreshToken === refreshSequence) s.error = m.pulse_readFailed();
  } finally {
    if (generation === scopeGeneration) {
      s.busy = false;
      drainRecovery();
    }
  }
}
async function act(
  id: string,
  expectedRevision: number,
  action: 'approve' | 'dismiss',
  options: { actions?: ActionRuntime | null; refresh?: () => Promise<void> } = {},
) {
  if (s.busy || s.recovery) return;
  retireReads();
  const decisionVersion = ++readSequence;
  s.busy = true;
  attemptedIds.add(id);
  const generation = scopeGeneration;
  const decision: ActiveDecision = { id, scope: generation };
  activeDecision = decision;
  try {
    const outcome = latestDecisionOutcome(
      decision,
      await runTrackedCommand(
        options.actions ?? undefined,
        'pulse.proposal.update',
        async (context) => {
          const result = await runCheckedMutation({
            context,
            attemptId: `pulse.${action}.write`,
            mutate: async (signal) => {
              const response = await requireOk(
                await fetch(`/api/pulse/proposals/${id}`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ action, expectedRevision }),
                  signal,
                }),
                m.pulse_decisionFailed(),
              );
              const receipt = (await response.json()) as PulseReceipt;
              return decision.latest && decision.latest.version > decisionVersion
                ? decision.latest.receipt
                : receipt;
            },
            onCommitted: (receipt) => {
              if (generation !== scopeGeneration || activeDecision !== decision) return;
              retireReads();
              const latest = decision.latest;
              publishReceipt(
                id,
                latest && latest.version > decisionVersion ? latest.receipt : receipt,
                latest && latest.version > decisionVersion ? latest.version : decisionVersion,
              );
            },
            refresh: async () => {
              if (generation !== scopeGeneration) return;
              if (!(await refreshAll())) throw new Error('Pulse read superseded');
              if (generation !== scopeGeneration) return;
              await options.refresh?.();
            },
            refreshAttemptId: `pulse.${action}.refresh`,
          });
          return latestDecisionOutcome(decision, result);
        },
      ),
    );
    if (generation !== scopeGeneration) return outcome;
    retireReads();
    if (outcome.status === 'failed') attemptedIds.delete(id);
    if (
      outcome.status === 'unknown' ||
      outcome.status === 'committed-refreshing' ||
      outcome.status === 'conflict'
    )
      s.recovery = outcome.status;
    s.error =
      outcome.status === 'succeeded'
        ? null
        : outcome.status === 'unknown'
          ? m.asyncAction_unknown()
          : outcome.status === 'committed-refreshing'
            ? m.asyncAction_refreshing()
            : outcome.status === 'conflict'
              ? m.pulse_refreshRequired()
              : m.pulse_decisionFailed();
    return outcome;
  } finally {
    if (activeDecision === decision) {
      if (decision.scope === scopeGeneration && decision.latest)
        publishReceipt(id, decision.latest.receipt, decision.latest.version);
      activeDecision = undefined;
    }
    if (generation === scopeGeneration) {
      s.busy = false;
      drainRecovery();
    }
  }
}
export const pulse = {
  scopeKey: (scopeVersion: number | undefined) => {
    const data = page.data as {
      user?: { id?: string; role?: string } | null;
      activeOrgId?: string | null;
      permissions?: { permissions?: string[] } | null;
    };
    return JSON.stringify([
      scopeVersion,
      data.user?.id ?? null,
      data.activeOrgId ?? null,
      canViewPath('/pulse'),
      data.permissions?.permissions?.includes('users:manage') ?? false,
    ]);
  },
  syncScope: (scopeVersion: number | undefined) => {
    const key = pulse.scopeKey(scopeVersion);
    pulse.setScope(key);
    return key;
  },
  setScope: (scope: string | number | undefined) => {
    if (currentScope === scope) return;
    currentScope = scope;
    scopeGeneration += 1;
    retireReads();
    attemptedIds.clear();
    activeDecision = undefined;
    pendingRecovery = undefined;
    s = { pendingCount: 0, items: [], receipts: {}, recovery: null, error: null, busy: false };
  },
  get pendingCount() {
    return s.pendingCount;
  },
  get items() {
    return s.items;
  },
  get receipts() {
    return Object.values(s.receipts);
  },
  get recovery() {
    return s.recovery;
  },
  get error() {
    return s.error;
  },
  get busy() {
    return s.busy;
  },
  receipt: (id: string) =>
    s.receipts[id] ??
    (activeDecision?.id === id && activeDecision.scope === scopeGeneration
      ? activeDecision.latest?.receipt
      : undefined),
  readReceipt,
  recover,
  refreshCount: async () => {
    try {
      await fetchCount();
    } catch {
      /* Shell retries reads only. */
    }
  },
  refresh: async () => {
    const current = beginRead();
    const refresh = refreshSequence + 1;
    try {
      if (await refreshAll()) {
        if (current() && refresh === refreshSequence && !s.recovery) s.error = null;
      }
    } catch {
      if (current() && refresh === refreshSequence) s.error = m.pulse_readFailed();
    }
  },
  approve: (id: string, revision: number, options?: Parameters<typeof act>[3]) =>
    act(id, revision, 'approve', options),
  dismiss: (id: string, revision: number, options?: Parameters<typeof act>[3]) =>
    act(id, revision, 'dismiss', options),
  beginCountRead: () => beginCountRead().publish,
};
