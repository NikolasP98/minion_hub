-- Browser freshness for the canonical messages ledger.
--
-- This is deliberately Broadcast-from-Database, not Postgres Changes:
--  * the payload is compact and contains no conversation body/PII;
--  * one event is authorized once per private org-channel join rather than
--    re-running row authorization for every subscriber/change;
--  * the message and its change signal commit atomically.

create or replace function public.hub_broadcast_message_committed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'version', 1,
      'id', new.id,
      'clientId', new.client_id,
      'channel', new.channel,
      'accountId', new.account_id,
      'chatId', new.chat_id,
      'direction', new.direction,
      'occurredAt', coalesce(new.occurred_at, new.created_at)
    ),
    'message.committed',
    'org:' || new.org_id || ':events',
    true
  );
  return null;
end;
$$;

revoke all on function public.hub_broadcast_message_committed() from public;
revoke all on function public.hub_broadcast_message_committed() from anon;
revoke all on function public.hub_broadcast_message_committed() from authenticated;

drop trigger if exists messages_realtime_broadcast on public.messages;
create trigger messages_realtime_broadcast
after insert on public.messages
for each row
execute function public.hub_broadcast_message_committed();

-- Browser clients may receive database-originated Broadcasts for organizations
-- where their Supabase profile has an active membership. No INSERT policy is
-- created: browsers cannot publish trusted Hub change events.
drop policy if exists org_members_receive_hub_broadcasts on realtime.messages;
create policy org_members_receive_hub_broadcasts
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.organization_members as membership
    where membership.profile_id = (select auth.uid())
      and (select realtime.topic()) =
        'org:' || membership.organization_id::text || ':events'
  )
);

comment on function public.hub_broadcast_message_committed() is
  'Emits a compact private message.committed change signal for Hub browser freshness.';
