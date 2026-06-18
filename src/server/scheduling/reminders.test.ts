import { describe, it, expect } from 'vitest';
import { dueStages, maxLeadMinutes } from './reminders';
import type { ReminderStage } from '$server/db/pg-reminders-schema';

const STAGES: ReminderStage[] = [
  { key: 'confirmation' },
  { key: '24h', minutesBefore: 1440 },
  { key: '2h', minutesBefore: 120 },
];
const iso = (s: string) => new Date(s);
const keys = (st: ReminderStage[]) => st.map((s) => s.key).sort();

// Appointment at 2026-06-20 15:00Z, created 2026-06-10.
const booking = (over: Partial<{ start: string; created: string; status: string }> = {}) => ({
  startTime: iso(over.start ?? '2026-06-20T15:00:00Z'),
  createdAt: iso(over.created ?? '2026-06-10T00:00:00Z'),
  status: over.status ?? 'accepted',
});

describe('dueStages', () => {
  it('fires confirmation as soon as the booking exists (far from appointment)', () => {
    const due = dueStages({ booking: booking(), stages: STAGES, now: iso('2026-06-10T00:01:00Z'), sentStageKeys: [] });
    expect(keys(due)).toEqual(['confirmation']);
  });

  it('opens the 24h window exactly 1440 min before start', () => {
    // 24h before 15:00 on Jun20 = 15:00 on Jun19.
    const before = dueStages({ booking: booking(), stages: STAGES, now: iso('2026-06-19T14:59:00Z'), sentStageKeys: ['confirmation'] });
    expect(keys(before)).toEqual([]);
    const at = dueStages({ booking: booking(), stages: STAGES, now: iso('2026-06-19T15:00:00Z'), sentStageKeys: ['confirmation'] });
    expect(keys(at)).toEqual(['24h']);
  });

  it('opens the 2h window 120 min before start', () => {
    const at = dueStages({
      booking: booking(),
      stages: STAGES,
      now: iso('2026-06-20T13:00:00Z'),
      sentStageKeys: ['confirmation', '24h'],
    });
    expect(keys(at)).toEqual(['2h']);
  });

  it('never re-sends an already-recorded stage', () => {
    const due = dueStages({
      booking: booking(),
      stages: STAGES,
      now: iso('2026-06-20T13:30:00Z'),
      sentStageKeys: ['confirmation', '24h', '2h'],
    });
    expect(due).toHaveLength(0);
  });

  it('skips everything once the appointment has started/passed', () => {
    const due = dueStages({ booking: booking(), stages: STAGES, now: iso('2026-06-20T15:00:00Z'), sentStageKeys: [] });
    expect(due).toHaveLength(0);
  });

  it('skips reminders for non-active bookings (cancelled/completed/no_show)', () => {
    for (const status of ['cancelled', 'completed', 'no_show', 'rejected']) {
      const due = dueStages({ booking: booking({ status }), stages: STAGES, now: iso('2026-06-19T16:00:00Z'), sentStageKeys: [] });
      expect(due).toHaveLength(0);
    }
  });

  it('self-corrects on reschedule: a later startTime reopens future windows', () => {
    // Originally 24h already sent; rescheduled far out — 24h stays sent (dedup),
    // but if it had NOT been sent, the new window governs.
    const due = dueStages({
      booking: booking({ start: '2026-07-01T15:00:00Z' }),
      stages: STAGES,
      now: iso('2026-06-19T15:00:00Z'),
      sentStageKeys: ['confirmation'],
    });
    // 24h before Jul 1 hasn't opened yet on Jun 19 → nothing due.
    expect(due).toHaveLength(0);
  });

  it('collapses multiple due stages when a booking is created inside both windows', () => {
    // Created only 90 min before start: confirmation + 2h both due (24h window already elapsed → still "open" since fireAt is in the past, so 24h is also due).
    const due = dueStages({
      booking: booking({ created: '2026-06-20T13:30:00Z' }),
      stages: STAGES,
      now: iso('2026-06-20T13:30:00Z'),
      sentStageKeys: [],
    });
    expect(keys(due)).toEqual(['24h', '2h', 'confirmation']);
  });

  it('maxLeadMinutes returns the widest time-based window', () => {
    expect(maxLeadMinutes(STAGES)).toBe(1440);
    expect(maxLeadMinutes([{ key: 'confirmation' }])).toBe(0);
  });
});
