-- Notifications rework: multi-channel sends + per-stage recipient role.
-- Applied to gxv 2026-06-21.

alter table sched_reminder_config
  add column if not exists channels jsonb not null default '[]'::jsonb;

alter table sched_reminders
  add column if not exists recipient_role text not null default 'client';

-- Widen the dedup key from (org,booking,stage) to include channel + role so a
-- stage can fan out to several channels/audiences, each sent at most once.
drop index if exists sched_reminders_booking_stage_uniq;
create unique index if not exists sched_reminders_booking_stage_chan_uniq
  on sched_reminders (org_id, booking_id, stage, channel, recipient_role);
