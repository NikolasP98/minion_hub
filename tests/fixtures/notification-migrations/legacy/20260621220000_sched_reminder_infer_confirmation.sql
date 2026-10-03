-- T4: agent-inference toggle for appointment-confirmation replies.
-- OFF = substring SÍ/NO match; ON = LLM infers accept/decline. Applied to gxv 2026-06-21.
alter table sched_reminder_config
  add column if not exists infer_confirmation boolean not null default false;
