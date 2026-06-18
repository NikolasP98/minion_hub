import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { schedReminderConfig, schedReminders } from './pg-reminders-schema';

describe('pg-reminders-schema', () => {
  it('sched_reminder_config holds per-org agent settings, default-off', () => {
    const cols = Object.keys(getTableColumns(schedReminderConfig));
    for (const c of ['orgId', 'enabled', 'stages', 'channel', 'accountId', 'personalize', 'locale', 'fromName'])
      expect(cols).toContain(c);
  });

  it('sched_reminders logs each booking×stage send with status + idempotency fields', () => {
    const cols = Object.keys(getTableColumns(schedReminders));
    for (const c of ['orgId', 'bookingId', 'stage', 'channel', 'recipient', 'content', 'status', 'messageId', 'error', 'sentAt'])
      expect(cols).toContain(c);
  });
});
