import { validateDecisionEvent, type DecisionEvent } from './decision-lineage';
export interface ObservationOwner {
  actorId: string;
  orgId: string;
}
export function createDecisionEvents(fetcher: typeof fetch = (...args) => fetch(...args)) {
  let owner = '',
    generation = 0;
  let queued: DecisionEvent[] = [];
  let inFlight: AbortController | null = null;
  let scheduled = false,
    inFlightCount = 0;
  const counters = { overflow: 0, network: 0, ownerChanged: 0, sent: 0 };
  const listeners = new Set<(event: DecisionEvent) => void>();
  return {
    counters,
    isOwner(next: ObservationOwner) {
      return owner === `${next.actorId}\0${next.orgId}`;
    },
    setOwner(next: ObservationOwner) {
      const key = `${next.actorId}\0${next.orgId}`;
      if (key === owner) return;
      counters.ownerChanged += queued.length + inFlightCount;
      queued = [];
      generation++;
      inFlight?.abort();
      inFlight = null;
      inFlightCount = 0;
      owner = key;
    },
    enqueue(input: DecisionEvent) {
      const event = validateDecisionEvent(input);
      if (!event || !owner || owner === '\0') return;
      for (const listener of listeners) listener(event);
      if (queued.length + inFlightCount >= 20) {
        counters.overflow++;
        return;
      }
      queued.push(event);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          void this.flush();
        });
      }
    },
    async flush() {
      if (inFlight || !queued.length) return;
      const events = queued;
      queued = [];
      const captured = generation;
      const controller = new AbortController();
      inFlight = controller;
      inFlightCount = events.length;
      try {
        const response = await fetcher('/api/assistant/decision-events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: 1, events }),
          signal: controller.signal,
        });
        if (captured === generation) {
          if (response.ok) counters.sent += events.length;
          else counters.network += events.length;
        }
      } catch {
        if (captured === generation) counters.network += events.length;
      } finally {
        if (inFlight === controller) {
          inFlight = null;
          inFlightCount = 0;
        }
      }
      if (captured === generation && queued.length) void this.flush();
    },
    subscribe(listener: (event: DecisionEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot() {
      return { counters: { ...counters }, queued: queued.length };
    },
    dispose() {
      queued = [];
      generation++;
      inFlight?.abort();
      inFlight = null;
      listeners.clear();
    },
  };
}
export const decisionEvents = createDecisionEvents();
export function emitDecision(
  kind: DecisionEvent['kind'],
  submissionId: string,
  properties: Record<string, string | number | boolean | null> = {},
) {
  decisionEvents.enqueue({ ...properties, kind, submissionId, eventId: crypto.randomUUID() });
}

import type { PendingSubmission } from './pending-submission';
import { MANIFEST_IDS, routerMode, type ManifestId, type RouteEvidence } from './turn-router';
import type { AcceptedBinding, TurnOrigin } from './accepted-runs';
export function observePreparation(
  pending: PendingSubmission,
  origin: TurnOrigin,
  parent?: AcceptedBinding,
) {
  const fields: Record<string, string | number | boolean | null> = {
    origin,
    router_mode: routerMode(),
    context_revision: pending.pageContextRevision,
    preparation_epoch: pending.scopeEpoch,
    taskRootId: parent?.taskRootId ?? pending.submissionId,
    ...(parent ? { parentRunId: parent.runId } : {}),
    decision_disposition: origin === 'user' ? 'full_fallback' : 'bypass',
  };
  const emit = (
    kind: DecisionEvent['kind'],
    fields: Record<string, string | number | boolean | null>,
  ) => {
    if (decisionEvents.isOwner(pending)) emitDecision(kind, pending.submissionId, fields);
  };
  let prepared = false,
    settled = false;
  return {
    prepare(evidence?: RouteEvidence) {
      if (prepared) return;
      prepared = true;
      fields.decision_disposition =
        origin === 'user' ? (evidence?.decision ? 'routed' : 'full_fallback') : 'bypass';
      const attempt = evidence?.attempt;
      if (attempt)
        Object.assign(fields, {
          attemptId: attempt.attemptId,
          requested_model: attempt.requestedModel,
          resolved_model: attempt.resolvedModel,
          schema_revision: attempt.schemaRevision,
          question_revision: attempt.questionRevision,
          gate_revision: attempt.gateRevision,
          elapsed_ms: attempt.elapsedMs,
          server_deadline_ms: attempt.serverDeadlineMs,
          client_deadline_ms: 1500,
          cost_status: attempt.cost.status,
          assistant_cost_usd: attempt.cost.usd,
          ...(attempt.inputTokens === undefined ? {} : { input_tokens: attempt.inputTokens }),
          ...(attempt.outputTokens === undefined ? {} : { output_tokens: attempt.outputTokens }),
        });
      emit('decision_prepared', fields);
    },
    apply(context: string, loaded?: ReadonlySet<ManifestId>) {
      if (settled) return;
      settled = true;
      const selected = loaded ?? new Set(MANIFEST_IDS);
      emit('decision_applied', {
        ...fields,
        context_bytes: new TextEncoder().encode(context).byteLength,
        ...Object.fromEntries(MANIFEST_IDS.map((id) => [`loaded_${id}`, selected.has(id)])),
      });
    },
    discard(reason: 'user_stop' | 'context_changed' | 'transport_rejected') {
      if (settled) return;
      settled = true;
      emit('decision_discarded', {
        ...fields,
        reason,
        ...(pending.phase === 'canceled'
          ? { decision_disposition: 'canceled' }
          : pending.phase === 'invalidated'
            ? { decision_disposition: 'invalidated' }
            : {}),
      });
    },
  };
}
