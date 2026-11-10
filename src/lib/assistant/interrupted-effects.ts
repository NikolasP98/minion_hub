import { writable } from 'svelte/store';
import {
  captureGatewaySessionOwner,
  onGatewaySessionLifetimeChange,
} from '$lib/services/gateway/session-owner.svelte';
import type { SubmissionScope } from './pending-submission';

export interface InterruptionOwner extends SubmissionScope {
  hostId: string;
  hostUrl: string;
}
type ReceiptState = 'pending' | 'unknown' | 'returned' | 'confirmed' | 'partial';
type ReceiptKind = 'sandbox-save' | 'sandbox-delete' | 'sandbox-arrange' | 'other';
interface CallReceipt {
  token: symbol;
  readOnly: boolean;
  state: ReceiptState;
}
interface JournalRun {
  runId: string;
  owner: InterruptionOwner;
  expiresAt: number;
  interrupted: boolean;
  calls: CallReceipt[];
  omitted: number;
}
export interface InterruptedEffectSummary {
  runId: string;
  owner: InterruptionOwner;
  expiresAt: number;
  started: number;
  unknown: number;
  confirmed: number;
  returned: number;
  reads: number;
}
/** Receipt metadata only. This handle never authorizes execution or follow-up. */
export interface EffectReceiptHandle {
  readonly token: symbol;
}
const MAX_RUNS = 32;
const MAX_CALLS = 16;
export const INTERRUPTION_TTL = 5 * 60_000;
const journal = new Map<string, JournalRun>();
const handles = new Map<
  EffectReceiptHandle,
  { run: JournalRun; call: CallReceipt; kind: ReceiptKind }
>();
const state = writable<readonly InterruptedEffectSummary[]>([]);
export const interruptedEffects = { subscribe: state.subscribe };
const sameScope = (a: SubmissionScope, b: SubmissionScope) =>
  a.actorId === b.actorId &&
  a.orgId === b.orgId &&
  a.agentId === b.agentId &&
  a.sessionKey === b.sessionKey;
export const sameInterruptionOwner = (a: InterruptionOwner, b: InterruptionOwner) =>
  sameScope(a, b) && a.hostId === b.hostId && a.hostUrl === b.hostUrl;

function forgetRun(run: JournalRun) {
  journal.delete(run.runId);
  // An ignored abort can leave the caller holding an opaque handle indefinitely.
  // Eviction also drops our metadata; handles retain no run data themselves.
  for (const [handle, receipt] of handles) if (receipt.run === run) handles.delete(handle);
}

function publish() {
  const now = Date.now();
  for (const run of journal.values()) if (now >= run.expiresAt) forgetRun(run);
  state.set(
    [...journal.values()]
      .filter((run) => run.interrupted)
      .map((run) => ({
        runId: run.runId,
        owner: { ...run.owner },
        expiresAt: run.expiresAt,
        started: run.calls.length + run.omitted,
        unknown:
          run.omitted +
          run.calls.filter(
            (call) => !call.readOnly && ['pending', 'unknown', 'partial'].includes(call.state),
          ).length,
        confirmed: run.calls.filter(
          (call) => !call.readOnly && ['confirmed', 'partial'].includes(call.state),
        ).length,
        returned: run.calls.filter((call) => !call.readOnly && call.state === 'returned').length,
        reads: run.calls.filter((call) => call.readOnly).length,
      })),
  );
}
/** Lazy expiry is also refreshed by the mounted notice; no network is polled. */
export function refreshInterruptedEffects() {
  publish();
}
export function clearInterruptedEffects() {
  journal.clear();
  handles.clear();
  publish();
}
export function discardInterruptedScope(scope: SubmissionScope) {
  for (const run of journal.values()) if (sameScope(run.owner, scope)) forgetRun(run);
  publish();
}
export function discardInterruptedOwner(owner: InterruptionOwner) {
  for (const run of journal.values()) if (sameInterruptionOwner(run.owner, owner)) forgetRun(run);
  publish();
}
export function dismissInterruptedEffect(runId: string, owner: InterruptionOwner) {
  const run = journal.get(runId);
  if (run && sameInterruptionOwner(run.owner, owner)) forgetRun(run);
  publish();
}
onGatewaySessionLifetimeChange(() => {
  const next = captureGatewaySessionOwner();
  if (!next) return; // A same-owner disconnect must remain visible, without reviving the run.
  for (const run of journal.values())
    if (
      run.owner.actorId !== next.actorId ||
      run.owner.orgId !== next.orgId ||
      run.owner.hostId !== next.hostId ||
      run.owner.hostUrl !== next.hostUrl
    )
      forgetRun(run);
  publish();
});

function ensureRun(binding: SubmissionScope & { runId: string }) {
  const gateway = captureGatewaySessionOwner();
  if (!gateway || gateway.actorId !== binding.actorId || gateway.orgId !== binding.orgId) return;
  publish();
  let run = journal.get(binding.runId);
  const owner = {
    actorId: binding.actorId,
    orgId: binding.orgId,
    agentId: binding.agentId,
    sessionKey: binding.sessionKey,
    hostId: gateway.hostId,
    hostUrl: gateway.hostUrl,
  };
  if (run && !sameInterruptionOwner(run.owner, owner)) return;
  if (!run) {
    while (journal.size >= MAX_RUNS) forgetRun(journal.values().next().value!);
    run = {
      runId: binding.runId,
      owner,
      expiresAt: Date.now() + INTERRUPTION_TTL,
      interrupted: false,
      calls: [],
      omitted: 0,
    };
    journal.set(binding.runId, run);
  }
  return run;
}
/** A waiting, not-yet-mounted form can be interrupted before any invocation. */
export function beginEffectRun(binding: SubmissionScope & { runId: string }) {
  ensureRun(binding);
}
export function beginEffectReceipt(
  binding: SubmissionScope & { runId: string },
  tool: string,
  readOnly: boolean,
): EffectReceiptHandle | undefined {
  const run = ensureRun(binding);
  if (!run) return;
  if (run.calls.length >= MAX_CALLS) {
    if (!readOnly) run.omitted++;
    return;
  }
  const call: CallReceipt = { token: Symbol('receipt'), readOnly, state: 'pending' };
  const handle = Object.freeze({ token: call.token });
  run.calls.push(call);
  const kind: ReceiptKind =
    tool === 'sandbox.upsert_element'
      ? 'sandbox-save'
      : tool === 'sandbox.remove_element'
        ? 'sandbox-delete'
        : tool === 'sandbox.arrange'
          ? 'sandbox-arrange'
          : 'other';
  handles.set(handle, { run, call, kind });
  return handle;
}

function receiptState(kind: ReceiptKind, result: string): ReceiptState {
  if (result.length > 16_384) return 'unknown';
  let value: unknown;
  try {
    value = JSON.parse(result);
  } catch {
    return 'unknown';
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const receipt = value as Record<string, unknown>;
  // A caught cancellation or transport error cannot prove that a write did not commit.
  if (
    receipt.error ||
    receipt.ok === false ||
    receipt.committed === false ||
    receipt.canceled === true ||
    receipt.cancelled === true ||
    receipt.unknown === true
  )
    return 'unknown';
  const validId =
    typeof receipt.id === 'string' && receipt.id.length > 0 && receipt.id.length <= 200;
  if (
    (kind === 'sandbox-save' && validId) ||
    (kind === 'sandbox-delete' && receipt.ok === true && validId)
  )
    return 'confirmed';
  if (
    kind === 'sandbox-arrange' &&
    Number.isInteger(receipt.updated) &&
    Number(receipt.updated) > 0 &&
    Array.isArray(receipt.failed)
  )
    return receipt.failed.length ? 'partial' : 'confirmed';
  // Generic ok/filled is a returned result, never proof of durable storage.
  return 'returned';
}
export function settleEffectReceipt(handle: EffectReceiptHandle | undefined, result: string) {
  if (!handle) return;
  const receipt = handles.get(handle);
  handles.delete(handle);
  if (!receipt || journal.get(receipt.run.runId) !== receipt.run) return;
  const gateway = captureGatewaySessionOwner();
  if (
    gateway &&
    (gateway.actorId !== receipt.run.owner.actorId ||
      gateway.orgId !== receipt.run.owner.orgId ||
      gateway.hostId !== receipt.run.owner.hostId ||
      gateway.hostUrl !== receipt.run.owner.hostUrl)
  )
    return;
  receipt.call.state = receiptState(receipt.kind, result);
  publish();
}
export function interruptEffectRun(runId: string) {
  const run = journal.get(runId);
  if (!run) return;
  run.interrupted = true;
  for (const call of run.calls) if (call.state === 'pending') call.state = 'unknown';
  publish();
}
export function finishEffectRun(runId: string) {
  const run = journal.get(runId);
  if (run && !run.interrupted) forgetRun(run);
  publish();
}
