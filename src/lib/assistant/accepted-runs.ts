import {
  captureGatewaySessionOwner,
  onGatewaySessionLifetimeChange,
  type GatewaySessionOwner,
} from '$lib/services/gateway/session-owner.svelte';
import { decisionEvents, emitDecision } from './decision-events';
/** Local authority for live finals. Correlation IDs never grant server authority. */
import type { SubmissionScope, PendingSubmission } from './pending-submission';
import {
  getPageContextRevision,
  getPageContextLease,
  type PageContextChange,
} from './page-context';
import { toolRegistration } from './model-context';
import { writable, type Readable } from 'svelte/store';
import type { REASONS } from './decision-lineage';

export type TurnOrigin = 'user' | 'ui_choice' | 'artifact' | 'ui_followup';
export type TransportStatus = 'submitted' | 'accepted' | 'rejected' | 'unknown';
export type RunState = 'unclaimed' | 'claimed' | 'finished' | 'canceled' | 'invalidated';
export interface AcceptedBinding extends SubmissionScope {
  readonly submissionId: string;
  readonly runId: string;
  readonly taskRootId: string;
  readonly parentRunId: string | null;
  readonly origin: TurnOrigin;
  readonly surface: AcceptedSurface;
  readonly preparationEpoch: number;
  readonly generation: number;
  pageContextRevision: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly controller: AbortController;
  readonly followUpCount: number;
  transport: TransportStatus;
  state: RunState;
}
export interface BindingDescriptor {
  pending: PendingSubmission;
  surface: AcceptedSurface;
  origin?: TurnOrigin;
  parent?: AcceptedBinding;
}
export interface AcceptedSurface {
  readonly token: symbol;
  readonly alive: boolean;
  readonly generation: number;
  readonly activity: Readable<AcceptedBinding | undefined>;
  readScope(): SubmissionScope;
  updateScope(): void;
  contextChanged(change: PageContextChange): void;
  latest(): AcceptedBinding | undefined;
  stop(): AcceptedBinding | undefined;
  dispose(): void;
  followUp(binding: AcceptedBinding, results: string): Promise<boolean>;
}
const MAX_RUNS = 256;
const TTL = 2 * 60 * 60 * 1000;
const runs = new Map<string, AcceptedBinding>();
const messageRuns = new WeakMap<object, AcceptedBinding>();
const activityPublishers = new WeakMap<AcceptedSurface, () => void>();
let owner = '';
let gatewayGeneration = 0;
const gatewayLeases = new WeakMap<
  AcceptedBinding,
  { generation: number; owner: GatewaySessionOwner | null }
>();
onGatewaySessionLifetimeChange(() => {
  gatewayGeneration++;
  for (const binding of runs.values()) revoke(binding, 'invalidated', 'owner_changed');
});
const equalScope = (a: SubmissionScope, b: SubmissionScope) =>
  a.actorId === b.actorId &&
  a.orgId === b.orgId &&
  a.agentId === b.agentId &&
  a.sessionKey === b.sessionKey;
function revoke(
  binding: AcceptedBinding,
  state: 'canceled' | 'invalidated' = 'invalidated',
  reason: (typeof REASONS)[number] = state === 'canceled' ? 'user_stop' : 'context_changed',
) {
  if (!binding.controller.signal.aborted)
    emitDecision('task_terminal', binding.submissionId, {
      runId: binding.runId,
      taskRootId: binding.taskRootId,
      terminal_status: state,
      reason,
    });
  if (binding.state !== 'canceled') binding.state = state;
  binding.controller.abort();
  activityPublishers.get(binding.surface)?.();
  for (const [capability, invocation] of invocations)
    if (invocation.binding === binding) invocations.delete(capability);
}
function sweep() {
  const now = Date.now();
  for (const [id, binding] of runs)
    if (now >= binding.expiresAt) {
      revoke(binding, 'invalidated', 'expired');
      runs.delete(id);
    }
}
export function resetAcceptedRuns() {
  for (const binding of runs.values()) revoke(binding, 'invalidated', 'owner_changed');
  runs.clear();
  owner = '';
}
export function createAcceptedSurface(options: {
  readScope: () => SubmissionScope;
  followUp: (binding: AcceptedBinding, results: string) => Promise<boolean>;
}): AcceptedSurface {
  let alive = true;
  let generation = 0;
  let scope = { ...options.readScope() };
  const activity = writable<AcceptedBinding | undefined>(undefined);
  function invalidate(reason: (typeof REASONS)[number] = 'context_changed') {
    generation++;
    for (const binding of runs.values())
      if (binding.surface === surface) revoke(binding, 'invalidated', reason);
  }
  const surface: AcceptedSurface = {
    token: Symbol('sending-surface'),
    activity: { subscribe: activity.subscribe },
    get alive() {
      return alive;
    },
    get generation() {
      return generation;
    },
    readScope: options.readScope,
    updateScope() {
      const next = options.readScope();
      const identity = `${next.actorId}\0${next.orgId}`;
      if (owner && identity !== owner) resetAcceptedRuns();
      owner = identity;
      decisionEvents.setOwner(next);
      if (!equalScope(scope, next)) {
        invalidate();
        scope = { ...next };
      }
    },
    contextChanged(change) {
      surface.updateScope();
      let qualified = false;
      if (change.capability) {
        const invocation = invocations.get(change.capability);
        if (
          invocation?.binding.surface === surface &&
          canPublish(invocation, true) &&
          invocation.lease === change.lease &&
          invocation.prior === change.previousRevision &&
          change.revision === change.previousRevision + 1 &&
          change.kind === 'owned'
        ) {
          invocation.published = change.revision;
          invocation.open = false;
          invocation.binding.pageContextRevision = change.revision;
          qualified = true;
        }
      }
      if (!qualified) invalidate();
    },
    latest() {
      surface.updateScope();
      sweep();
      return [...runs.values()]
        .reverse()
        .find(
          (b) => b.surface === surface && !b.controller.signal.aborted && b.state !== 'finished',
        );
    },
    stop() {
      const binding = surface.latest();
      if (binding) revoke(binding, 'canceled');
      return binding;
    },
    dispose() {
      alive = false;
      invalidate('unmounted');
      activityPublishers.delete(surface);
    },
    followUp: options.followUp,
  };
  activityPublishers.set(surface, () =>
    activity.set(
      [...runs.values()]
        .reverse()
        .find(
          (binding) =>
            binding.surface === surface &&
            !binding.controller.signal.aborted &&
            binding.state !== 'finished',
        ),
    ),
  );
  surface.updateScope();
  return surface;
}
export function registerSubmittedRun(
  runId: string,
  descriptor: BindingDescriptor,
): AcceptedBinding | null {
  const { surface, pending } = descriptor;
  surface.updateScope();
  sweep();
  if (
    !surface.alive ||
    !equalScope(pending, surface.readScope()) ||
    pending.pageContextRevision !== getPageContextRevision()
  )
    return null;
  const origin = descriptor.origin ?? 'user';
  const parent = origin === 'user' ? undefined : descriptor.parent;
  const automatic = origin === 'ui_followup';
  if (automatic && !parent) return null;
  if (parent && (!isRunCurrent(parent) || (automatic && rootFollowUps(parent.taskRootId) >= 5)))
    return null;
  const now = Date.now();
  const binding: AcceptedBinding = {
    actorId: pending.actorId,
    orgId: pending.orgId,
    agentId: pending.agentId,
    sessionKey: pending.sessionKey,
    submissionId: pending.submissionId,
    runId,
    surface,
    preparationEpoch: pending.scopeEpoch,
    generation: surface.generation,
    pageContextRevision: pending.pageContextRevision,
    origin,
    taskRootId: parent?.taskRootId ?? pending.submissionId,
    parentRunId: parent?.runId ?? null,
    followUpCount: parent ? rootFollowUps(parent.taskRootId) + (automatic ? 1 : 0) : 0,
    createdAt: now,
    expiresAt: now + TTL,
    controller: new AbortController(),
    transport: 'submitted',
    state: 'unclaimed',
  };
  if (runs.has(runId)) return null;
  while (runs.size >= MAX_RUNS) {
    const oldest = runs.keys().next().value as string;
    revoke(runs.get(oldest)!, 'invalidated', 'evicted');
    runs.delete(oldest);
  }
  gatewayLeases.set(binding, {
    generation: gatewayGeneration,
    owner: captureGatewaySessionOwner(),
  });
  runs.set(runId, binding);
  activityPublishers.get(surface)?.();
  return binding;
}
function rootFollowUps(root: string) {
  return Math.max(
    0,
    ...[...runs.values()]
      .filter((b) => b.taskRootId === root && b.transport !== 'rejected')
      .map((b) => b.followUpCount),
  );
}
export function getAcceptedRun(
  runId: string | null | undefined,
  sessionKey?: string,
): AcceptedBinding | undefined {
  sweep();
  const binding = runId ? runs.get(runId) : undefined;
  return binding && (!sessionKey || binding.sessionKey === sessionKey) ? binding : undefined;
}
export function isRunCurrent(binding: AcceptedBinding, checkRevision = true): boolean {
  binding.surface.updateScope();
  sweep();
  const gateway = gatewayLeases.get(binding);
  if (
    gateway &&
    (gateway.generation !== gatewayGeneration || (gateway.owner && !gateway.owner.current()))
  )
    revoke(binding, 'invalidated', 'owner_changed');
  return (
    runs.get(binding.runId) === binding &&
    Date.now() < binding.expiresAt &&
    binding.surface.alive &&
    binding.generation === binding.surface.generation &&
    !binding.controller.signal.aborted &&
    equalScope(binding, binding.surface.readScope()) &&
    (!checkRevision || binding.pageContextRevision === getPageContextRevision())
  );
}
export function observeRunTransport(binding: AcceptedBinding, status: TransportStatus) {
  if (status === 'rejected') {
    binding.transport = status;
    revoke(binding, 'invalidated', 'transport_rejected');
    return;
  }
  if (binding.transport === 'accepted' || binding.transport === 'rejected') return;
  binding.transport = status;
  if ((status === 'accepted' || status === 'unknown') && decisionEvents.isOwner(binding))
    emitDecision(
      status === 'accepted' ? 'transport_accepted' : 'transport_unknown',
      binding.submissionId,
      {
        runId: binding.runId,
        taskRootId: binding.taskRootId,
        transport_status: status,
        ...(status === 'unknown' ? { reason: 'ack_unknown' } : {}),
      },
    );
}
export function claimRunFinal(
  runId: string | undefined,
  sessionKey: string,
): AcceptedBinding | undefined {
  const binding = getAcceptedRun(runId, sessionKey);
  if (!binding || binding.state !== 'unclaimed' || !isRunCurrent(binding)) return;
  observeRunTransport(binding, 'accepted');
  binding.state = 'claimed';
  activityPublishers.get(binding.surface)?.();
  return binding;
}
export function finishRun(binding: AcceptedBinding) {
  if (binding.state === 'claimed') {
    binding.state = 'finished';
    activityPublishers.get(binding.surface)?.();
    emitDecision('task_terminal', binding.submissionId, {
      runId: binding.runId,
      taskRootId: binding.taskRootId,
      terminal_status: 'finished',
      reason: 'normal',
    });
  }
}
export function terminalRun(runId: string | undefined, sessionKey: string) {
  const binding = getAcceptedRun(runId, sessionKey);
  if (binding) revoke(binding);
}
export function associateRunMessage(message: object, binding: AcceptedBinding) {
  messageRuns.set(message, binding);
}
/** Render aliases retain exact provenance only; authority is checked again at the click. */
export function associateDerivedRunMessage(message: object, sources: readonly unknown[]) {
  const source = sources[0];
  const binding = source && typeof source === 'object' ? messageRuns.get(source) : undefined;
  if (
    binding &&
    sources.every(
      (value) => value && typeof value === 'object' && messageRuns.get(value) === binding,
    )
  )
    messageRuns.set(message, binding);
}
export function sourceMessageRun(message: unknown): AcceptedBinding | undefined {
  const binding = message && typeof message === 'object' ? messageRuns.get(message) : undefined;
  return binding && isRunCurrent(binding) ? binding : undefined;
}

/** This type has no serializable representation and only the private map grants authority. */
export interface InvocationCapability {
  readonly token: symbol;
}
interface Invocation {
  binding: AcceptedBinding;
  tool: string;
  registration: object;
  lease: symbol;
  prior: number;
  deadline: number;
  open: boolean;
  published: number | null;
}
const invocations = new Map<InvocationCapability, Invocation>();
const ENROLLED = new Set(['sandbox.upsert_element', 'sandbox.remove_element', 'sandbox.arrange']);
function canPublish(invocation: Invocation, publishing = false): boolean {
  return (
    invocation.open &&
    invocation.published === null &&
    Date.now() < invocation.deadline &&
    isRunCurrent(invocation.binding, !publishing) &&
    invocation.binding.pageContextRevision === invocation.prior &&
    getPageContextRevision() === invocation.prior + (publishing ? 1 : 0) &&
    getPageContextLease() === invocation.lease &&
    toolRegistration(invocation.tool) === invocation.registration
  );
}
export function beginInvocation(
  binding: AcceptedBinding,
  tool: string,
): InvocationCapability | undefined {
  const lease = getPageContextLease(),
    registration = toolRegistration(tool);
  if (!ENROLLED.has(tool) || !lease || !registration || !isRunCurrent(binding)) return;
  for (const [capability, invocation] of invocations)
    if (invocation.binding === binding) invocations.delete(capability);
  const capability = Object.freeze({ token: Symbol('tool-invocation') });
  invocations.set(capability, {
    binding,
    tool,
    registration,
    lease,
    prior: getPageContextRevision(),
    deadline: Math.min(Date.now() + 30_000, binding.expiresAt),
    open: true,
    published: null,
  });
  return capability;
}
/** Effect-side lease check; querying it cannot mint or publish an invocation. */
export function isInvocationEffectCurrent(capability: InvocationCapability): boolean {
  const invocation = invocations.get(capability);
  if (invocation && canPublish(invocation)) return true;
  if (invocation)
    revoke(
      invocation.binding,
      'invalidated',
      Date.now() >= invocation.deadline ? 'expired' : 'context_changed',
    );
  return false;
}
export function mayPublishInvocation(capability: InvocationCapability, lease: symbol): boolean {
  const invocation = invocations.get(capability);
  return !!invocation && invocation.lease === lease && canPublish(invocation);
}
export function settleInvocation(capability: InvocationCapability | undefined): boolean {
  if (!capability) return false;
  const invocation = invocations.get(capability);
  invocations.delete(capability);
  if (!invocation) return false;
  invocation.open = false;
  const valid =
    invocation.published !== null &&
    invocation.published === getPageContextRevision() &&
    Date.now() < invocation.deadline &&
    getPageContextLease() === invocation.lease &&
    toolRegistration(invocation.tool) === invocation.registration &&
    isRunCurrent(invocation.binding);
  if (!valid) revoke(invocation.binding);
  return valid;
}

export function submittedRun(binding: AcceptedBinding) {
  const relation = {
    runId: binding.runId,
    taskRootId: binding.taskRootId,
    origin: binding.origin,
    follow_up_count: binding.followUpCount,
    accepted_generation: binding.generation,
    ...(binding.parentRunId ? { parentRunId: binding.parentRunId } : {}),
  };
  emitDecision('run_relation', binding.submissionId, relation);
  emitDecision('transport_submitted', binding.submissionId, {
    ...relation,
    transport_status: 'submitted',
  });
}
