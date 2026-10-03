import * as m from '$lib/paraglide/messages';
import { MutationRejected } from '$lib/services/actions/mutations';
import {
  PLAN_OPERATION_UUID_RE,
  PLAN_OPERATION_VERSION,
  type PendingPlanOperation,
  type PlanCanonicalIdentity,
} from './plan-open-record';

export class SafeCancelledCreate extends MutationRejected {
  constructor() {
    super(409, 'operation_cancelled');
    this.name = 'SafeCancelledCreate';
  }
}

/** The server proved the canonical wallet changed before any operation or plan write. */
export class SafeIdentityChangedCreate extends MutationRejected {
  constructor(message: string) {
    super(409, message);
    this.name = 'SafeIdentityChangedCreate';
  }
}

export class UnknownCreateResponse extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = 'UnknownCreateResponse';
    this.detail = detail;
  }
}

export type PlanCancelReceipt =
  { status: 'cancelled' } | { status: 'committed'; plan: { id: string } };

export interface PlanOperationReceipt {
  id: string;
  clientKey: string;
  identityVersion: 1 | 2;
}

type Observe = <T>(work: Promise<T>) => Promise<T>;

function createBody(record: PendingPlanOperation): Record<string, unknown> {
  const body: Record<string, unknown> = {
    operationId: record.operationId,
    partyId: record.intent.partyId,
    crmContactId: record.intent.crmContactId,
    title: record.intent.title,
    totalAmount: record.intent.totalAmount,
    productId: record.intent.productId,
    bookingId: record.intent.bookingId,
    dueSchedule: record.intent.dueSchedule,
    note: record.intent.note,
  };
  if (record.version === PLAN_OPERATION_VERSION) body.clientKey = record.intent.clientKey;
  if (record.intent.currency.kind === 'explicit') body.currency = record.intent.currency.value;
  return body;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalClientKey(
  value: unknown,
  identity: Pick<PlanCanonicalIdentity, 'partyId' | 'crmContactId'>,
): value is string {
  if (typeof value !== 'string') return false;
  return (
    value === (identity.partyId ? `party:${identity.partyId}` : `contact:${identity.crmContactId}`)
  );
}

function canonicalIdentity(body: unknown): PlanCanonicalIdentity | null {
  if (
    !plainObject(body) ||
    !exactKeys(body, ['partyId', 'crmContactId', 'clientKey', 'identityStatus']) ||
    body.identityStatus !== 'active' ||
    typeof body.clientKey !== 'string' ||
    !(
      body.partyId === null ||
      (typeof body.partyId === 'string' && PLAN_OPERATION_UUID_RE.test(body.partyId))
    ) ||
    !(
      body.crmContactId === null ||
      (typeof body.crmContactId === 'string' && PLAN_OPERATION_UUID_RE.test(body.crmContactId))
    ) ||
    (!body.partyId && !body.crmContactId)
  ) {
    return null;
  }
  const identity: PlanCanonicalIdentity = {
    partyId: body.partyId,
    crmContactId: body.crmContactId,
    clientKey: body.clientKey,
    identityStatus: 'active',
  };
  return canonicalClientKey(identity.clientKey, identity) ? identity : null;
}

export async function resolvePlanIdentity(options: {
  partyId: string | null;
  crmContactId: string | null;
  signal: AbortSignal;
  observe: Observe;
}): Promise<PlanCanonicalIdentity> {
  const query = new URLSearchParams();
  if (options.partyId) query.set('partyId', options.partyId);
  if (options.crmContactId) query.set('crmContactId', options.crmContactId);
  const response = await options.observe(
    fetch('/api/pos/plans/identity?' + query.toString(), { signal: options.signal }),
  );
  if (!response.ok) {
    const failure = await responseFailure(response, options.observe, m.pos_plan_identity_failed());
    throw new Error(failure.detail);
  }
  let body: unknown;
  try {
    body = await options.observe(response.json());
  } catch {
    throw new Error(m.pos_plan_identity_failed());
  }
  const identity = canonicalIdentity(body);
  if (!identity) throw new Error(m.pos_plan_identity_failed());
  return identity;
}

async function responseFailure(
  response: Response,
  observe: Observe,
  fallback: string,
): Promise<{ code: string | null; detail: string }> {
  let body: unknown = null;
  try {
    body = await observe(response.json());
  } catch {
    return { code: null, detail: fallback };
  }
  if (!body || typeof body !== 'object') return { code: null, detail: fallback };
  const candidate = body as { code?: unknown; error?: unknown; message?: unknown };
  const detail =
    typeof candidate.error === 'string'
      ? candidate.error
      : typeof candidate.message === 'string'
        ? candidate.message
        : fallback;
  return { code: typeof candidate.code === 'string' ? candidate.code : null, detail };
}

function planFromBody(body: unknown): { id: string } | null {
  const plan =
    body && typeof body === 'object' && 'plan' in body ? (body as { plan?: unknown }).plan : null;
  return plan &&
    typeof plan === 'object' &&
    'id' in plan &&
    typeof plan.id === 'string' &&
    plan.id.trim()
    ? { id: plan.id }
    : null;
}

export async function createPlanOperation(options: {
  record: PendingPlanOperation;
  signal: AbortSignal;
  observe: Observe;
}): Promise<{ id: string }> {
  const response = await options.observe(
    fetch('/api/pos/plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify(createBody(options.record)),
    }),
  );
  if (!response.ok) {
    const failure = await responseFailure(response, options.observe, m.pos_plan_create_failed());
    if (response.status === 409 && failure.code === 'operation_cancelled') {
      throw new SafeCancelledCreate();
    }
    if (response.status === 409 && failure.code === 'wallet_identity_changed') {
      throw new SafeIdentityChangedCreate(failure.detail);
    }
    throw new UnknownCreateResponse(failure.detail);
  }
  let body: unknown;
  try {
    body = await options.observe(response.json());
  } catch {
    throw new UnknownCreateResponse(m.pos_plan_create_unknown());
  }
  const plan = planFromBody(body);
  if (!plan) throw new UnknownCreateResponse(m.pos_plan_create_unknown());
  return plan;
}

export async function lookupPlanOperation(options: {
  record: PendingPlanOperation;
  signal: AbortSignal;
  observe: Observe;
}): Promise<PlanOperationReceipt | null> {
  const response = await options.observe(
    fetch('/api/pos/plans/operations/' + encodeURIComponent(options.record.operationId), {
      signal: options.signal,
    }),
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(m.pos_plan_reconcile_failed());
  const body = await options.observe(response.json());
  const plan = plainObject(body) && plainObject(body.plan) ? body.plan : null;
  if (
    !plan ||
    !exactKeys(plan, ['id', 'clientKey', 'identityVersion']) ||
    typeof plan.id !== 'string' ||
    !plan.id ||
    typeof plan.clientKey !== 'string' ||
    !/^(party|contact):/.test(plan.clientKey) ||
    (plan.identityVersion !== 1 && plan.identityVersion !== 2)
  ) {
    throw new Error(m.pos_plan_reconcile_failed());
  }
  return {
    id: plan.id,
    clientKey: plan.clientKey,
    identityVersion: plan.identityVersion,
  };
}

export async function cancelPlanOperation(options: {
  record: PendingPlanOperation;
  signal: AbortSignal;
  observe: Observe;
}): Promise<PlanCancelReceipt> {
  const response = await options.observe(
    fetch(`/api/pos/plans/operations/${encodeURIComponent(options.record.operationId)}/cancel`, {
      method: 'POST',
      signal: options.signal,
    }),
  );
  if (!response.ok) {
    const failure = await responseFailure(
      response,
      options.observe,
      m.pos_plan_cancel_request_failed(),
    );
    throw new MutationRejected(response.status, failure.detail);
  }
  let body: unknown;
  try {
    body = await options.observe(response.json());
  } catch {
    throw new Error(m.pos_plan_cancel_request_failed());
  }
  if (body && typeof body === 'object' && 'status' in body && body.status === 'cancelled') {
    return { status: 'cancelled' };
  }
  const plan =
    body && typeof body === 'object' && 'status' in body && body.status === 'committed'
      ? planFromBody(body)
      : null;
  if (!plan) throw new Error(m.pos_plan_cancel_request_failed());
  return { status: 'committed', plan };
}
