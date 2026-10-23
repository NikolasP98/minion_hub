/** Flat, content-free self observations. Shared by the browser and authenticated ingress. */
export const EVENT_NAMES = {
  decision_prepared: 'assistant_decision_prepared',
  decision_applied: 'assistant_decision_applied',
  decision_discarded: 'assistant_decision_discarded',
  run_relation: 'assistant_run_relation',
  transport_submitted: 'assistant_transport_submitted',
  transport_accepted: 'assistant_transport_accepted',
  transport_unknown: 'assistant_transport_unknown',
  task_terminal: 'assistant_task_terminal',
} as const;
export type DecisionKind = keyof typeof EVENT_NAMES;
export type Scalar = string | number | boolean | null;
type Validator = (value: unknown) => boolean;
export const telemetryCount: Validator = (v) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const telemetryDuration: Validator = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
export const telemetryProbability: Validator = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
export const telemetryUuid: Validator = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const telemetryRevision: Validator = (v) =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const telemetryModel: Validator = (v) =>
  typeof v === 'string' && /^[A-Za-z0-9~_.:/+-]{1,160}$/.test(v);
const enumeration =
  (...items: string[]): Validator =>
  (v) =>
    typeof v === 'string' && items.includes(v);
export const REASONS = [
  'user_stop',
  'owner_changed',
  'context_changed',
  'expired',
  'evicted',
  'unmounted',
  'transport_rejected',
  'ack_unknown',
  'router_unavailable',
  'overflow',
  'network',
  'normal',
] as const;
const boolean: Validator = (v) => typeof v === 'boolean';
export const observationRules: Record<string, Validator> = {
  eventId: telemetryUuid,
  submissionId: telemetryUuid,
  attemptId: telemetryUuid,
  taskRootId: telemetryUuid,
  parentRunId: telemetryUuid,
  runId: telemetryUuid,
  origin: enumeration('user', 'ui_choice', 'artifact', 'ui_followup'),
  router_mode: enumeration('off', 'shadow', 'enforce'),
  decision_disposition: enumeration('routed', 'full_fallback', 'bypass', 'canceled', 'invalidated'),
  reason: enumeration(...REASONS),
  transport_status: enumeration('submitted', 'accepted', 'rejected', 'unknown'),
  terminal_status: enumeration('finished', 'canceled', 'invalidated'),
  schema_revision: telemetryRevision,
  question_revision: telemetryRevision,
  gate_revision: telemetryRevision,
  requested_model: telemetryModel,
  resolved_model: (v) => v === null || telemetryModel(v),
  elapsed_ms: telemetryDuration,
  client_deadline_ms: telemetryDuration,
  server_deadline_ms: telemetryDuration,
  context_revision: telemetryCount,
  preparation_epoch: telemetryCount,
  accepted_generation: telemetryCount,
  follow_up_count: (v) => telemetryCount(v) && (v as number) <= 5,
  context_bytes: telemetryCount,
  input_tokens: telemetryCount,
  output_tokens: telemetryCount,
  cost_status: enumeration('known', 'unknown'),
  assistant_cost_usd: (v) =>
    v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1),
  loaded_pages: boolean,
  loaded_forms: boolean,
  loaded_data: boolean,
  loaded_brain: boolean,
  loaded_changelog: boolean,
  loaded_sandbox: boolean,
};
const common = [
  'eventId',
  'submissionId',
  'attemptId',
  'taskRootId',
  'parentRunId',
  'runId',
  'origin',
  'context_revision',
  'preparation_epoch',
  'accepted_generation',
  'follow_up_count',
];
const decisions = [
  'router_mode',
  'decision_disposition',
  'reason',
  'schema_revision',
  'question_revision',
  'gate_revision',
  'requested_model',
  'resolved_model',
  'elapsed_ms',
  'client_deadline_ms',
  'server_deadline_ms',
  'context_bytes',
  'input_tokens',
  'output_tokens',
  'cost_status',
  'assistant_cost_usd',
  'loaded_pages',
  'loaded_forms',
  'loaded_data',
  'loaded_brain',
  'loaded_changelog',
  'loaded_sandbox',
];
export const observationFields: Record<DecisionKind, readonly string[]> = {
  decision_prepared: [...common, ...decisions],
  decision_applied: [...common, ...decisions],
  decision_discarded: [...common, ...decisions],
  run_relation: common,
  transport_submitted: [...common, 'transport_status'],
  transport_accepted: [...common, 'transport_status'],
  transport_unknown: [...common, 'transport_status', 'reason'],
  task_terminal: [...common, 'terminal_status', 'reason'],
};
export interface DecisionEvent {
  kind: DecisionKind;
  eventId: string;
  submissionId: string;
  [field: string]: Scalar;
}
export function validateDecisionEvent(input: unknown): DecisionEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.kind !== 'string' || !Object.hasOwn(EVENT_NAMES, value.kind)) return null;
  const kind = value.kind as DecisionKind;
  if (!telemetryUuid(value.eventId) || !telemetryUuid(value.submissionId)) return null;
  const out: Record<string, Scalar> = { kind };
  for (const key of Object.keys(value)) {
    if (key === 'kind' || ['actorId', 'orgId', 'actor_id', 'org_id'].includes(key)) continue;
    if (!observationFields[kind].includes(key) || !observationRules[key](value[key])) return null;
    out[key] = value[key] as Scalar;
  }
  if (Object.hasOwn(out, 'cost_status') || Object.hasOwn(out, 'assistant_cost_usd')) {
    if (
      !(out.cost_status === 'unknown' && out.assistant_cost_usd === null) &&
      !(out.cost_status === 'known' && typeof out.assistant_cost_usd === 'number')
    )
      return null;
  }
  return out as DecisionEvent;
}
export function observationProperties(event: DecisionEvent): Record<string, Scalar> {
  const names: Record<string, string> = {
    eventId: 'event_id',
    submissionId: 'submission_id',
    attemptId: 'attempt_id',
    taskRootId: 'root_id',
    parentRunId: 'parent_run_id',
    runId: 'run_id',
  };
  return Object.fromEntries(
    Object.entries(event)
      .filter(([key]) => key !== 'kind')
      .map(([key, value]) => [names[key] ?? key, value]),
  );
}
