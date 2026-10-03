import { replaceNth, type LegacyState } from './reconciliation-harness';

export const catalogMutationVectors: ReadonlyArray<{
  name: string;
  sql: string;
  reason: string;
  state?: LegacyState;
}> = [
  {
    name: 'wrong column type',
    sql: 'ALTER TABLE public.sched_reminder_config ALTER COLUMN from_name TYPE varchar(255)',
    reason: 'column_manifest',
  },
  {
    name: 'wrong column default',
    sql: 'ALTER TABLE public.sched_reminder_config ALTER COLUMN enabled SET DEFAULT true',
    reason: 'column_manifest',
  },
  {
    name: 'wrong column nullability',
    sql: 'ALTER TABLE public.sched_reminder_config ALTER COLUMN enabled DROP NOT NULL',
    reason: 'column_manifest',
  },
  {
    name: 'one table without its pair',
    state: 'reminder_base',
    sql: 'DROP TABLE public.sched_reminders',
    reason: 'target_presence',
  },
  {
    name: 'wrong same-name unique index',
    sql: `DROP INDEX public.sched_reminders_booking_stage_chan_uniq;
          CREATE UNIQUE INDEX sched_reminders_booking_stage_chan_uniq
            ON public.sched_reminders(org_id,booking_id,stage,channel)`,
    reason: 'index_manifest',
  },
  {
    name: 'unexpected duplicate index',
    sql: `CREATE INDEX unexpected_notification_duplicate
          ON public.sched_reminders(org_id,booking_id,stage,channel,recipient_role)`,
    reason: 'index_manifest',
  },
  {
    name: 'wrong foreign-key delete action',
    sql: `ALTER TABLE public.sched_reminders DROP CONSTRAINT sched_reminders_booking_id_fkey;
          ALTER TABLE public.sched_reminders ADD CONSTRAINT sched_reminders_booking_id_fkey
            FOREIGN KEY (booking_id) REFERENCES public.sched_bookings(id)`,
    reason: 'constraint_manifest',
  },
  {
    name: 'extra restrictive check',
    sql: 'ALTER TABLE public.sched_reminder_config ADD CONSTRAINT extra_enabled CHECK (enabled IN (true,false))',
    reason: 'constraint_manifest',
  },
  {
    name: 'extra exclusion constraint',
    sql: `ALTER TABLE public.notif_log ADD CONSTRAINT extra_notification_exclusion
          EXCLUDE USING gist (tstzrange(created_at,created_at,'[]') WITH &&)`,
    reason: 'constraint_manifest',
  },
  {
    name: 'extra user trigger',
    sql: `CREATE FUNCTION public.extra_notification_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
          CREATE TRIGGER extra_notification_trigger BEFORE UPDATE ON public.notif_rules FOR EACH ROW EXECUTE FUNCTION public.extra_notification_trigger()`,
    reason: 'trigger_manifest',
  },
  {
    name: 'extra rewrite rule',
    sql: 'CREATE RULE extra_notification_rule AS ON DELETE TO public.notif_log DO INSTEAD NOTHING',
    reason: 'rewrite_manifest',
  },
  {
    name: 'altered organization policy',
    sql: `DROP POLICY sched_reminder_config_org_guc ON public.sched_reminder_config;
          CREATE POLICY sched_reminder_config_org_guc ON public.sched_reminder_config
            FOR ALL USING (enabled) WITH CHECK (enabled)`,
    reason: 'policy_manifest',
  },
  {
    name: 'force row security disabled',
    sql: 'ALTER TABLE public.sched_reminder_config NO FORCE ROW LEVEL SECURITY',
    reason: 'relation_shape',
  },
  {
    name: 'row security disabled',
    sql: 'ALTER TABLE public.sched_reminder_config DISABLE ROW LEVEL SECURITY',
    reason: 'relation_shape',
  },
  {
    name: 'broader table grant',
    sql: 'GRANT UPDATE ON public.notif_log TO app_assistant_ro',
    reason: 'table_acl_assistant',
  },
  {
    name: 'hidden column grant',
    sql: 'GRANT SELECT (org_id) ON TABLE public.sched_reminder_config TO app_assistant_ro',
    reason: 'column_acl',
  },
  {
    name: 'invalid reminder state',
    sql: `UPDATE public.sched_reminders SET status='unknown'`,
    reason: 'reminder_state',
  },
  {
    name: 'sent reminder without sent time',
    sql: `UPDATE public.sched_reminders SET status='sent',sent_at=NULL`,
    reason: 'reminder_state',
  },
  {
    name: 'pending reminder with sent time',
    sql: `UPDATE public.sched_reminders SET status='sending',sent_at='2026-01-02T04:00:00Z'`,
    reason: 'reminder_state',
  },
  {
    name: 'orphan reminder booking',
    sql: `SET session_replication_role=replica;
          UPDATE public.sched_reminders
            SET booking_id='10000000-0000-4000-8000-000000000099';
          SET session_replication_role=origin`,
    reason: 'orphan_booking',
  },
  {
    name: 'invalid notification claim status',
    sql: `UPDATE public.notif_log SET status='unknown'`,
    reason: 'notification_state',
  },
];

export function sourceMutationVectors(source: string): ReadonlyArray<{
  name: string;
  state: LegacyState;
  prepare?: string;
  source: string;
  finalReason: string;
}> {
  return [
    {
      name: 'postgres-17-maintain-owner-acl',
      state: 'legacy_complete',
      source: replaceNth(
        source,
        "|| case when current_setting('server_version_num')::integer >= 170000",
        "|| case when current_setting('server_version_num')::integer >= 999999",
      ),
      finalReason: 'table_acl_owner',
    },
    {
      name: 'state-classifier',
      state: 'legacy_complete',
      prepare: 'ALTER TABLE public.sched_reminder_config ALTER COLUMN enabled SET DEFAULT true',
      source: replaceNth(
        source,
        "perform pg_temp.notification_fail('column_manifest');",
        'null;',
        2,
      ),
      finalReason: 'final_column_manifest',
    },
    {
      name: 'acl-manifest',
      state: 'legacy_complete',
      source: replaceNth(
        source,
        "execute format('revoke all privileges on table public.%I from %I', relation_name, role_name);",
        'null;',
      ),
      finalReason: 'final_acl',
    },
    {
      name: 'force-rls',
      state: 'fresh',
      source: replaceNth(
        source,
        'alter table public.sched_reminder_config force row level security;',
        'alter table public.sched_reminder_config no force row level security;',
      ),
      finalReason: 'final_relation',
    },
    {
      name: 'transition-trigger',
      state: 'fresh',
      source: replaceNth(
        source,
        `create trigger sched_reminders_legal_transition
before insert or update on public.sched_reminders
for each row execute function public.enforce_sched_reminder_transition();`,
        '',
      ),
      finalReason: 'final_trigger',
    },
  ];
}
