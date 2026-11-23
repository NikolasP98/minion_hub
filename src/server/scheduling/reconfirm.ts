/**
 * Spec 139: pure helpers for the reminder-negation follow-up. No I/O, no booking writes.
 */
import type { Classified } from '$server/services/reminder-compose';

/** Below this a verdict is logged as given but acted on as unclear (one constant, no setting). */
export const CONFIDENCE_MIN = 0.75;
/** Closer than this to the start the agent stays silent and the case goes to staff. */
export const LATE_MS = 2 * 60 * 60 * 1000;

export type CaseResult =
  | 'rescheduled'
  | 'will_come'
  | 'declined'
  | 'wants_other_date'
  | 'no_answer'
  | 'unclear'
  | 'late_reply'
  | 'send_failed'
  | 'staff_handling';

/*
 * TODO(handoff): spec 134 (appointment statuses) is not built. When it ships it replaces the
 * derived "Por reconfirmar" badge with real statuses, using this mapping (spec 139 research R9);
 * none of it is implemented here. Read cases through `getCaseForBooking` and keep the tables.
 *   open case (closed_at is null)       -> status `reconfirm`
 *   result `wants_other_date`           -> status `unscheduled`, reason `sin_fecha`
 *   result `rescheduled` | `will_come`  -> status `accepted` (already written by this spec)
 *   staff action "Marcar como atendido" -> replaced or joined by Archivar / Anular
 *   badge derived from the case         -> the status badge itself; remove the derived badge
 */

/** The verdict the code acts on: low confidence counts as unclear. */
export function acted<V extends string>(c: Classified<V>): V | 'unclear' {
  return c.confidence >= CONFIDENCE_MIN ? c.verdict : 'unclear';
}

/**
 * Deadline for the client's answer: `now + wait`, never later than 2 h before the start.
 * Null when that cut-off has already passed (the agent must not write).
 */
export function waitUntil(now: Date, start: Date, waitHours: number): Date | null {
  const cutoff = start.getTime() - LATE_MS;
  if (cutoff <= now.getTime()) return null;
  return new Date(Math.min(now.getTime() + waitHours * 3_600_000, cutoff));
}

interface CaseShape {
  agentState: string;
  result: string | null;
  closedAt: Date | null;
}

/** Which inbox notification a case currently owns; null = nothing to show. */
export function casePhase(c: CaseShape): 'agent' | 'staff' | 'done' | null {
  if (c.closedAt) return c.result === 'rescheduled' || c.result === 'will_come' ? 'done' : null;
  if (c.result === null && (c.agentState === 'asking' || c.agentState === 'offered'))
    return 'agent';
  return 'staff';
}

// shortcut: fixed Spanish like the other inbox rules (a cron tick has no request locale).
const RESULT_TITLES: Readonly<Record<CaseResult, string>> = {
  rescheduled: 'Reprogramada por el agente',
  will_come: 'Confirmó que asistirá',
  declined: 'No desea continuar',
  wants_other_date: 'Quiere otra fecha',
  no_answer: 'Sin respuesta',
  unclear: 'Respuesta poco clara',
  late_reply: 'Respondió cerca de la hora de la cita',
  send_failed: 'No se pudo escribir al cliente',
  staff_handling: 'El equipo ya está conversando con el cliente',
};

export function caseTitle(c: { agentState: string; result: string | null }): string {
  if (c.result && c.result in RESULT_TITLES) return RESULT_TITLES[c.result as CaseResult];
  return c.agentState === 'asking' || c.agentState === 'offered'
    ? 'El agente está consultando al cliente'
    : 'Dijo que no puede asistir';
}
