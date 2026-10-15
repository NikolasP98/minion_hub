import { PosError } from './errors';
import { minorToDecimal } from '$lib/money/decimal';
import { storedMoneyMinor } from './money';

/**
 * The ONE guard chain every POS ticket mutation runs (spec
 * 2026-10-15-hub-pos-shift-scoped-edits-and-emission-on-close T4), in this
 * order: void → period locked → reconciled to an invoice → emitted to SUNAT
 * while the field is fiscal → the shift's state decides the write path.
 * `not_found` is the caller's (it has the row, or it does not).
 *
 * Pure so the order is testable without a database; the service only loads
 * the state and routes on the answer.
 */
export interface TicketMutationState {
  ticket: { status: string; invoiceProviderRef: string | null };
  shiftStatus: string;
  /** At least one `pos_emissions` row that is not `error`. */
  emitted: boolean;
  /** `pos_period_locks` covers the ticket's month (S3). */
  periodLocked: boolean;
}

export type MutationPath = 'open' | 'closed';

export function assertTicketMutable(
  state: TicketMutationState,
  opts: { fiscal: boolean },
): MutationPath {
  if (state.ticket.status === 'void') throw new PosError('ticket is void', 'ticket_void');
  if (state.periodLocked) throw new PosError('Periodo cerrado por contabilidad', 'period_locked');
  if (state.ticket.invoiceProviderRef)
    throw new PosError('ticket is reconciled to an invoice', 'reconciled');
  if (state.emitted && opts.fiscal)
    throw new PosError('ticket is emitted to SUNAT: requires a credit note', 'emitted');
  return state.shiftStatus === 'open' ? 'open' : 'closed';
}

/**
 * What a payment row is tendered as NOW: its own method, unless closed-shift
 * corrections already moved it — then the newest pair's positive row wins.
 * Feeding this into `planTenderChange` is what keeps a repeated correction
 * from stacking a second pair (I1) and makes cash→card→yape net correctly.
 */
export function effectiveMethod(
  payment: { method: string },
  corrections: ReadonlyArray<{ method: string; amount: string | number; paidAt: Date }>,
): string {
  const latest = [...corrections]
    .filter((row) => storedMoneyMinor(row.amount) > 0n)
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
    .at(-1);
  return latest?.method ?? payment.method;
}

export interface TenderChangeInput {
  payment: { id: string; method: string; amount: string | number; metadata: unknown };
  method: string;
  reason: string;
  actor: { id: string | null; name: string | null };
  now: Date;
}

export type TenderChangePlan =
  /** Open shift: the row itself is corrected, the drawer recomputes live. */
  | { kind: 'in_place'; metadata: Record<string, unknown> }
  /** Closed shift: history stays as counted; a zero-net pair moves the money
   *  on the CURRENT open shift (same rule as a void's refund rows). */
  | {
      kind: 'correction';
      rows: Array<{ method: string; amount: string; metadata: Record<string, unknown> }>;
    };

export function planTenderChange(path: MutationPath, input: TenderChangeInput): TenderChangePlan {
  const { payment, method, reason, actor, now } = input;
  const current = (payment.metadata ?? {}) as Record<string, unknown>;
  if (current.kind === 'refund' || current.kind === 'correction')
    throw new PosError('only an original payment row can be corrected', 'not_found');
  if (payment.method === method) throw new PosError('same payment method', 'same_method');
  const stamp = { by: actor.id, byName: actor.name, at: now.toISOString(), reason };
  if (path === 'open') {
    return {
      kind: 'in_place',
      metadata: { ...current, changedFrom: payment.method, ...stamp },
    };
  }
  const minor = storedMoneyMinor(payment.amount);
  const metadata = { kind: 'correction', correctionOf: payment.id, ...stamp };
  return {
    kind: 'correction',
    rows: [
      { method: payment.method, amount: minorToDecimal(-minor), metadata },
      { method, amount: minorToDecimal(minor), metadata },
    ],
  };
}
