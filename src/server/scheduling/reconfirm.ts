/**
 * Spec 139: pure helpers for the reminder-negation follow-up. No I/O, no booking writes.
 */
import type { Classified } from '$server/services/reminder-compose';
import {
  checkedZonedDayWindow,
  dateKeyAddDays,
  dateKeyFromParts,
  dateKeyWeekday,
  instantDateKey,
  instantParts,
} from '$lib/time/zoned';
import type { Slot } from './slots';

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
  /** The client answered, then the appointment changed under the agent: staff must read it. */
  bookingChanged?: boolean;
}

/** Which inbox notification a case currently owns; null = nothing to show. */
export function casePhase(c: CaseShape): 'agent' | 'staff' | 'done' | null {
  if (c.closedAt) {
    if (c.bookingChanged) return 'staff'; // closed as stale, but the client's answer was never seen
    return c.result === 'rescheduled' || c.result === 'will_come' ? 'done' : null;
  }
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
  send_failed: 'No se confirmó el mensaje al cliente: revisa el chat',
  staff_handling: 'El equipo ya está conversando con el cliente',
};

export const BOOKING_CHANGED_TITLE =
  'La clienta dijo que sí asistirá, pero la cita cambió: revisa con ella';

export function caseTitle(c: {
  agentState: string;
  result: string | null;
  bookingChanged?: boolean;
}): string {
  if (c.bookingChanged) return BOOKING_CHANGED_TITLE;
  if (c.result && c.result in RESULT_TITLES) return RESULT_TITLES[c.result as CaseResult];
  return c.agentState === 'asking' || c.agentState === 'offered'
    ? 'El agente está consultando al cliente'
    : 'Dijo que no puede asistir';
}

const WEEKDAYS: Record<'es' | 'en', string[]> = {
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Appointment time as the client reads it in the agent's messages, in the resource's timezone:
 * "jueves 27/11 a las 17:15" (en: "Thursday 11/27 at 17:15"). `short` gives "jue 27/11 17:15".
 * Built from `instantParts` (no raw Intl); falls back to the ISO instant for a bad timezone.
 */
export function whenText(instant: Date, timezone: string, locale: string, short = false): string {
  const lang = locale === 'en' ? 'en' : 'es';
  try {
    const p = instantParts(instant, timezone);
    const key = dateKeyFromParts({ year: p.year, month: p.month, day: p.day });
    const wd = key ? dateKeyWeekday(key) : null;
    const name = wd === null ? '' : WEEKDAYS[lang][wd]!;
    const day = lang === 'en' ? `${pad(p.month)}/${pad(p.day)}` : `${pad(p.day)}/${pad(p.month)}`;
    const time = `${pad(p.hour)}:${pad(p.minute)}`;
    if (short) return `${name.slice(0, 3)} ${day} ${time}`.trim();
    return `${name} ${day} ${lang === 'en' ? 'at' : 'a las'} ${time}`.trim();
  } catch {
    return instant.toISOString();
  }
}

export type NamedDay =
  'tomorrow' | 'day_after' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'next_week';
export type PartOfDay = 'morning' | 'afternoon' | 'evening';

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
/** How far ahead a bare part of day ("en la tarde") may be offered. */
const OFFER_HORIZON_DAYS = 14;

/**
 * The slot window a client named, as half-open instants in the resource timezone. A weekday is
 * its next occurrence strictly after today (1-7 days ahead); `next_week` is next Monday to Sunday;
 * only a part of day searches tomorrow through 14 days ahead. Null when nothing was named: the
 * agent then offers nothing and staff pick the date.
 */
export function dateWindow(
  day: NamedDay | null,
  partOfDay: PartOfDay | null,
  now: Date,
  timezone: string,
): { from: Date; to: Date } | null {
  if (!day && !partOfDay) return null;
  const today = instantDateKey(now, timezone);
  const todayWd = dateKeyWeekday(today);
  if (todayWd === null) return null;
  const ahead = (wd: number) => (wd - todayWd + 7) % 7 || 7;
  let first: number;
  let last: number;
  if (day === 'tomorrow') first = last = 1;
  else if (day === 'day_after') first = last = 2;
  else if (day === 'next_week') {
    first = ahead(1);
    last = first + 6;
  } else if (day) {
    first = last = ahead(WEEKDAY_INDEX[day]!);
  } else {
    first = 1;
    last = OFFER_HORIZON_DAYS;
  }
  const from = dateKeyAddDays(today, first);
  const to = dateKeyAddDays(today, last);
  if (!from || !to) return null;
  const w = checkedZonedDayWindow(from, to, timezone);
  return w.ok && w.from && w.to ? { from: w.from, to: w.to } : null;
}

const inPart = (hour: number, part: PartOfDay | null) =>
  part === null ||
  (part === 'morning' ? hour < 12 : part === 'afternoon' ? hour >= 12 && hour < 18 : hour >= 18);

/**
 * Up to `max` slots to offer: inside the part of day, never sooner than `now + 2 h`, spread over
 * the available ones (first, middle, last) instead of three back-to-back. Input order is kept.
 */
export function pickOfferSlots(
  slots: Slot[],
  partOfDay: PartOfDay | null,
  timezone: string,
  max = 3,
  now: Date = new Date(),
): Slot[] {
  const earliest = now.getTime() + LATE_MS;
  const fit = slots
    .filter(
      (s) =>
        s.start.getTime() >= earliest && inPart(instantParts(s.start, timezone).hour, partOfDay),
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (fit.length <= max) return fit;
  const idx = new Set<number>();
  for (let i = 0; i < max; i += 1) idx.add(Math.round((i * (fit.length - 1)) / (max - 1)));
  return [...idx].sort((a, b) => a - b).map((i) => fit[i]!);
}

const SUMMARY_INTENT: Readonly<Record<string, string>> = {
  will_come: 'Dijo que sí asistirá',
  decline: 'Dijo que no desea continuar',
  other_date: 'Pidió otra fecha',
  pick: 'Eligió uno de los horarios ofrecidos',
  unclear: 'Respuesta poco clara',
};
const SUMMARY_DAY: Readonly<Record<NamedDay, string>> = {
  tomorrow: 'mañana',
  day_after: 'pasado mañana',
  mon: 'el lunes',
  tue: 'el martes',
  wed: 'el miércoles',
  thu: 'el jueves',
  fri: 'el viernes',
  sat: 'el sábado',
  sun: 'el domingo',
  next_week: 'la próxima semana',
};
const SUMMARY_PART: Readonly<Record<PartOfDay, string>> = {
  morning: 'en la mañana',
  afternoon: 'en la tarde',
  evening: 'en la noche',
};

/**
 * One-line staff summary of what the client answered: intent, day and part of day only. Built from
 * bounded fields, so it carries no phone number and none of the client's own words.
 */
export function answerSummary(
  intent: string,
  day: NamedDay | null,
  partOfDay: PartOfDay | null,
): string {
  const when = [day ? SUMMARY_DAY[day] : null, partOfDay ? SUMMARY_PART[partOfDay] : null].filter(
    Boolean,
  );
  return [
    SUMMARY_INTENT[intent] ?? SUMMARY_INTENT.unclear,
    intent === 'other_date' ? when.join(' ') : '',
  ]
    .filter(Boolean)
    .join(': ');
}
