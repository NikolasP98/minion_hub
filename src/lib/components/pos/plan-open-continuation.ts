import type { PlanInstalment } from './checkout-money';
import type {
  FrozenPlanCartRow,
  PlanCanonicalIdentity,
  PendingPlanOperation,
  PlanOpenContinuation,
  PlanOpenIntent,
  PlanOperationIdentity,
} from './plan-open-record';

export type PlanContinuationErrorCode =
  'cart_restore_required' | 'cart_projection_invalid' | 'continuation_context_mismatch';

export class PlanContinuationError extends Error {
  readonly code: PlanContinuationErrorCode;

  constructor(code: PlanContinuationErrorCode) {
    super(code);
    this.name = 'PlanContinuationError';
    this.code = code;
  }
}

export interface PreparedSellContinuation {
  preCart: FrozenPlanCartRow[];
  postCart: FrozenPlanCartRow[];
}

export interface PlanCreatedOwner {
  readonly scope: string;
  readonly operationId: string;
  readonly stage: PendingPlanOperation['stage'];
  readonly allowCartReplace: boolean;
  isCurrent(): boolean;
  prepareSellContinuation(postCart: FrozenPlanCartRow[]): Promise<PreparedSellContinuation>;
}

export type PlanCreatedCallback = (
  plan: { id: string },
  owner: PlanCreatedOwner,
) => void | Promise<void>;

export interface PlanOpenBinding {
  scope: string;
  identity: PlanOperationIdentity;
  continuation: PlanOpenContinuation;
  afterCreated: PlanCreatedCallback;
  afterCompleted: () => void;
}

export interface PlanOpenSubmission extends PlanOpenBinding {
  partyId: string | null;
  crmContactId: string | null;
  bookingId: string | null;
  productId?: string | null;
  title: string;
  totalAmount: number;
  currency?: string;
  dueSchedule: PlanInstalment[] | null;
  note: string | null;
}

export function canonicalPlanContinuation(
  continuation: PlanOpenContinuation,
  identity: PlanCanonicalIdentity,
): PlanOpenContinuation {
  if (continuation.kind === 'account') {
    return { kind: 'account', clientKey: identity.clientKey };
  }
  if (!identity.partyId) throw new PlanContinuationError('continuation_context_mismatch');
  return { ...continuation, partyId: identity.partyId };
}

export function samePlanOperationIdentity(
  left: PlanOperationIdentity,
  right: PlanOperationIdentity,
): boolean {
  return left.actorId === right.actorId && left.orgId === right.orgId;
}

export function samePlanContinuationContext(
  stored: PlanOpenContinuation,
  current: PlanOpenContinuation,
): boolean {
  if (stored.kind !== current.kind) return false;
  if (stored.kind === 'account' && current.kind === 'account') {
    return stored.clientKey === current.clientKey;
  }
  if (stored.kind === 'sell' && current.kind === 'sell') {
    return stored.partyId === current.partyId && stored.bookingId === current.bookingId;
  }
  return false;
}

export function planOpenIntent(
  input: PlanOpenSubmission,
  identity: PlanCanonicalIdentity,
): PlanOpenIntent {
  return {
    clientKey: identity.clientKey,
    partyId: identity.partyId,
    crmContactId: identity.crmContactId,
    bookingId: input.bookingId,
    productId: input.productId ?? null,
    title: input.title.trim(),
    totalAmount: input.totalAmount,
    currency: input.currency ? { kind: 'explicit', value: input.currency } : { kind: 'omitted' },
    dueSchedule: input.dueSchedule,
    note: input.note,
  };
}
