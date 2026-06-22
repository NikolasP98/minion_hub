import type { ReminderStage } from '$server/db/pg-reminders-schema';

/**
 * Pure reminder-scheduling engine. Given a booking, the org's configured stages,
 * "now", and which stages already fired, decide which stages are due RIGHT NOW.
 * No DB/IO — fully unit-tested. Recomputed every tick from booking.startTime, so
 * reschedules self-correct and elapsed windows are skipped.
 */

const MS_PER_MIN = 60_000;

/** Statuses that still warrant reminders. */
const ACTIVE_STATUSES = new Set(['accepted', 'pending']);

export interface ReminderBooking {
  startTime: Date;
  createdAt: Date;
  status: string;
}

export interface DueStagesInput {
  booking: ReminderBooking;
  stages: ReminderStage[];
  now: Date;
  /** Stage keys already recorded for this booking (sent OR skipped — never resend). */
  sentStageKeys: Set<string> | string[];
}

/**
 * The stages due to fire for `booking` at `now`.
 * - confirmation: once, as soon as the booking exists, while the appointment is
 *   still in the future.
 * - time-based (minutesBefore): once its lead window has opened and the
 *   appointment hasn't started.
 */
export function dueStages(input: DueStagesInput): ReminderStage[] {
  const { booking, stages, now } = input;
  if (!ACTIVE_STATUSES.has(booking.status)) return [];

  const sent = input.sentStageKeys instanceof Set ? input.sentStageKeys : new Set(input.sentStageKeys);
  const nowMs = now.getTime();
  const startMs = booking.startTime.getTime();

  // Never send for an appointment that has already started/passed.
  if (nowMs >= startMs) return [];

  const due: ReminderStage[] = [];
  for (const stage of stages) {
    if (sent.has(stage.key)) continue;

    if (stage.minutesBefore == null) {
      // Booking-time stage (confirmation): due once the booking exists.
      if (nowMs >= booking.createdAt.getTime()) due.push(stage);
      continue;
    }

    // Time-based: due once the lead window has opened.
    const fireAt = startMs - stage.minutesBefore * MS_PER_MIN;
    if (nowMs >= fireAt) due.push(stage);
  }
  return due;
}

/** The widest lead window (minutes) across configured stages — bounds the
 *  tick's booking lookahead. */
export function maxLeadMinutes(stages: ReminderStage[]): number {
  let max = 0;
  for (const s of stages) if (s.minutesBefore != null && s.minutesBefore > max) max = s.minutesBefore;
  return max;
}

// ── Channel-agnostic recipient routing ──────────────────────────────────────

export type RecipientRole = 'client' | 'team';

/** Expand a stage's audience into the concrete roles to send to. */
export function expandRoles(recipients: ReminderStage['recipients']): RecipientRole[] {
  if (recipients === 'team') return ['team'];
  if (recipients === 'both') return ['client', 'team'];
  return ['client'];
}

/** Channels addressed by an email identity rather than a phone/jid one. */
const EMAIL_CHANNELS = new Set(['email']);

export interface RecipientContacts {
  attendeePhone: string | null;
  attendeeEmail: string | null;
  staffPhone: string | null;
  staffEmail: string | null;
}

/**
 * Resolve the destination address for a (channel, role). Returns null when the
 * party has no identity reachable on that channel (e.g. a phone-only channel for
 * a staff member with only an email) → the caller records a graceful skip.
 */
export function resolveRecipient(channel: string, role: RecipientRole, c: RecipientContacts): string | null {
  const byEmail = EMAIL_CHANNELS.has(channel);
  const pick = role === 'client' ? (byEmail ? c.attendeeEmail : c.attendeePhone) : byEmail ? c.staffEmail : c.staffPhone;
  return pick?.trim() || null;
}
