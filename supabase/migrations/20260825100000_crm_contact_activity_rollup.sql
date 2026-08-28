-- Incremental CRM contact activity projection. The messages ledger remains the
-- source of truth; this table removes the full ledger aggregation from every
-- customer-list sort. Rebuild functions make delayed identity creation and
-- identity reassignment/merges converge to ledger truth.
create table if not exists public.crm_contact_activity_stats (
  contact_id       uuid primary key references public.crm_contacts(id) on delete cascade,
  org_id           text not null,
  message_count    bigint not null default 0,
  inbound_count    bigint not null default 0,
  outbound_count   bigint not null default 0,
  channels_used    integer not null default 0,
  first_contact_at timestamptz,
  last_contact_at  timestamptz,
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  updated_at       timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists crm_contact_activity_stats_org_last_idx
  on public.crm_contact_activity_stats (org_id, last_contact_at desc, contact_id);
--> statement-breakpoint
create index if not exists crm_contact_activity_stats_org_count_idx
  on public.crm_contact_activity_stats (org_id, message_count desc, contact_id);
--> statement-breakpoint

grant select, insert, update, delete on public.crm_contact_activity_stats to app_ledger;
--> statement-breakpoint
alter table public.crm_contact_activity_stats enable row level security;
--> statement-breakpoint
alter table public.crm_contact_activity_stats force row level security;
--> statement-breakpoint
drop policy if exists crm_contact_activity_stats_org_guc on public.crm_contact_activity_stats;
--> statement-breakpoint
create policy crm_contact_activity_stats_org_guc on public.crm_contact_activity_stats
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

-- Exact, idempotent repair for any contact-id set. Zero-message contacts retain
-- a zero row, which makes identity deletion and message deletion explicit.
create or replace function public.crm_rebuild_contact_activity(p_contact_ids uuid[])
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  rebuilt integer := 0;
begin
  if p_contact_ids is null or cardinality(p_contact_ids) = 0 then
    return 0;
  end if;

  insert into public.crm_contact_activity_stats (
    contact_id, org_id, message_count, inbound_count, outbound_count,
    channels_used, first_contact_at, last_contact_at,
    last_inbound_at, last_outbound_at, updated_at
  )
  select c.id,
         c.org_id,
         count(m.id)::bigint,
         count(m.id) filter (where m.direction = 'inbound')::bigint,
         count(m.id) filter (where m.direction = 'outbound')::bigint,
         count(distinct m.channel) filter (where m.id is not null)::integer,
         min(coalesce(m.occurred_at, m.created_at)),
         max(coalesce(m.occurred_at, m.created_at)),
         max(coalesce(m.occurred_at, m.created_at)) filter (where m.direction = 'inbound'),
         max(coalesce(m.occurred_at, m.created_at)) filter (where m.direction = 'outbound'),
         now()
  from public.crm_contacts c
  left join public.crm_contact_identities ci on ci.contact_id = c.id and ci.org_id = c.org_id
  left join public.messages m
    on m.org_id = ci.org_id
   and m.channel = ci.channel
   and m.chat_id = ci.external_id
   and m.is_bot is not true
  where c.id = any(p_contact_ids)
  group by c.id, c.org_id
  on conflict (contact_id) do update set
    org_id = excluded.org_id,
    message_count = excluded.message_count,
    inbound_count = excluded.inbound_count,
    outbound_count = excluded.outbound_count,
    channels_used = excluded.channels_used,
    first_contact_at = excluded.first_contact_at,
    last_contact_at = excluded.last_contact_at,
    last_inbound_at = excluded.last_inbound_at,
    last_outbound_at = excluded.last_outbound_at,
    updated_at = excluded.updated_at;

  get diagnostics rebuilt = row_count;
  return rebuilt;
end;
$$;
--> statement-breakpoint
revoke all on function public.crm_rebuild_contact_activity(uuid[]) from public;
--> statement-breakpoint
grant execute on function public.crm_rebuild_contact_activity(uuid[]) to app_ledger;
--> statement-breakpoint

-- Bounded operational repair path. Re-run with the returned next_after cursor;
-- every batch is idempotent and can resume after interruption.
create or replace function public.crm_rebuild_org_contact_activity(
  p_org_id text,
  p_after uuid default null,
  p_limit integer default 1000
)
returns table (rebuilt integer, next_after uuid)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  contact_ids uuid[];
begin
  select array_agg(id order by id)
    into contact_ids
  from (
    select id
    from public.crm_contacts
    where org_id = p_org_id and (p_after is null or id > p_after)
    order by id
    limit greatest(1, least(p_limit, 10000))
  ) batch;

  if contact_ids is null then
    return query select 0, null::uuid;
    return;
  end if;

  return query
    select public.crm_rebuild_contact_activity(contact_ids), contact_ids[array_length(contact_ids, 1)];
end;
$$;
--> statement-breakpoint
revoke all on function public.crm_rebuild_org_contact_activity(text, uuid, integer) from public;
--> statement-breakpoint

-- New messages can update the projection in O(1) when their identity already
-- exists. Delayed identity creation is handled by the identity rebuild trigger.
create or replace function public.crm_contact_activity_on_message_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.is_bot is true then
    return new;
  end if;

  insert into public.crm_contact_activity_stats (
    contact_id, org_id, message_count, inbound_count, outbound_count,
    channels_used, first_contact_at, last_contact_at,
    last_inbound_at, last_outbound_at, updated_at
  )
  select ci.contact_id,
         ci.org_id,
         1,
         case when new.direction = 'inbound' then 1 else 0 end,
         case when new.direction = 'outbound' then 1 else 0 end,
         1,
         coalesce(new.occurred_at, new.created_at),
         coalesce(new.occurred_at, new.created_at),
         case when new.direction = 'inbound' then coalesce(new.occurred_at, new.created_at) end,
         case when new.direction = 'outbound' then coalesce(new.occurred_at, new.created_at) end,
         now()
  from public.crm_contact_identities ci
  where ci.org_id = new.org_id
    and ci.channel = new.channel
    and ci.external_id = new.chat_id
  on conflict (contact_id) do update set
    message_count = crm_contact_activity_stats.message_count + 1,
    inbound_count = crm_contact_activity_stats.inbound_count
      + case when new.direction = 'inbound' then 1 else 0 end,
    outbound_count = crm_contact_activity_stats.outbound_count
      + case when new.direction = 'outbound' then 1 else 0 end,
    channels_used = crm_contact_activity_stats.channels_used + case when not exists (
      select 1
      from public.crm_contact_identities ci2
      join public.messages m2
        on m2.org_id = ci2.org_id and m2.channel = ci2.channel and m2.chat_id = ci2.external_id
      where ci2.contact_id = crm_contact_activity_stats.contact_id
        and m2.channel = new.channel
        and m2.id <> new.id
        and m2.is_bot is not true
    ) then 1 else 0 end,
    first_contact_at = least(
      crm_contact_activity_stats.first_contact_at,
      coalesce(new.occurred_at, new.created_at)
    ),
    last_contact_at = greatest(
      crm_contact_activity_stats.last_contact_at,
      coalesce(new.occurred_at, new.created_at)
    ),
    last_inbound_at = case when new.direction = 'inbound' then greatest(
      crm_contact_activity_stats.last_inbound_at,
      coalesce(new.occurred_at, new.created_at)
    ) else crm_contact_activity_stats.last_inbound_at end,
    last_outbound_at = case when new.direction = 'outbound' then greatest(
      crm_contact_activity_stats.last_outbound_at,
      coalesce(new.occurred_at, new.created_at)
    ) else crm_contact_activity_stats.last_outbound_at end,
    updated_at = now();

  return new;
end;
$$;
--> statement-breakpoint

create or replace function public.crm_contact_activity_on_message_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  affected uuid[];
begin
  if tg_op = 'DELETE' then
    select array_agg(ci.contact_id)
      into affected
    from public.crm_contact_identities ci
    where ci.org_id = old.org_id and ci.channel = old.channel and ci.external_id = old.chat_id;
    perform public.crm_rebuild_contact_activity(affected);
    return old;
  end if;

  select array_agg(distinct contact_id)
    into affected
  from (
    select ci.contact_id
    from public.crm_contact_identities ci
    where ci.org_id = old.org_id and ci.channel = old.channel and ci.external_id = old.chat_id
    union
    select ci.contact_id
    from public.crm_contact_identities ci
    where ci.org_id = new.org_id and ci.channel = new.channel and ci.external_id = new.chat_id
  ) contacts;
  perform public.crm_rebuild_contact_activity(affected);
  return new;
end;
$$;
--> statement-breakpoint

create or replace function public.crm_contact_activity_on_identity_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.crm_rebuild_contact_activity(array[new.contact_id]);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.crm_rebuild_contact_activity(array[old.contact_id]);
    return old;
  end if;

  perform public.crm_rebuild_contact_activity(array[old.contact_id, new.contact_id]);
  return new;
end;
$$;
--> statement-breakpoint

drop trigger if exists crm_contact_activity_message_insert on public.messages;
--> statement-breakpoint
create trigger crm_contact_activity_message_insert
after insert on public.messages
for each row execute function public.crm_contact_activity_on_message_insert();
--> statement-breakpoint
drop trigger if exists crm_contact_activity_message_change on public.messages;
--> statement-breakpoint
create trigger crm_contact_activity_message_change
after update of org_id, channel, chat_id, direction, is_bot, occurred_at, created_at or delete
on public.messages
for each row execute function public.crm_contact_activity_on_message_change();
--> statement-breakpoint
drop trigger if exists crm_contact_activity_identity_change on public.crm_contact_identities;
--> statement-breakpoint
create trigger crm_contact_activity_identity_change
after insert or update of org_id, contact_id, channel, external_id or delete
on public.crm_contact_identities
for each row execute function public.crm_contact_activity_on_identity_change();
--> statement-breakpoint

-- Initial full backfill: one ledger scan, idempotent on replay. The bounded
-- org rebuild function above remains available to database operators for later
-- repair/parity work without requiring an unbounded transaction.
insert into public.crm_contact_activity_stats (
  contact_id, org_id, message_count, inbound_count, outbound_count,
  channels_used, first_contact_at, last_contact_at,
  last_inbound_at, last_outbound_at, updated_at
)
select c.id,
       c.org_id,
       count(m.id)::bigint,
       count(m.id) filter (where m.direction = 'inbound')::bigint,
       count(m.id) filter (where m.direction = 'outbound')::bigint,
       count(distinct m.channel) filter (where m.id is not null)::integer,
       min(coalesce(m.occurred_at, m.created_at)),
       max(coalesce(m.occurred_at, m.created_at)),
       max(coalesce(m.occurred_at, m.created_at)) filter (where m.direction = 'inbound'),
       max(coalesce(m.occurred_at, m.created_at)) filter (where m.direction = 'outbound'),
       now()
from public.crm_contacts c
left join public.crm_contact_identities ci on ci.contact_id = c.id and ci.org_id = c.org_id
left join public.messages m
  on m.org_id = ci.org_id
 and m.channel = ci.channel
 and m.chat_id = ci.external_id
 and m.is_bot is not true
group by c.id, c.org_id
on conflict (contact_id) do update set
  org_id = excluded.org_id,
  message_count = excluded.message_count,
  inbound_count = excluded.inbound_count,
  outbound_count = excluded.outbound_count,
  channels_used = excluded.channels_used,
  first_contact_at = excluded.first_contact_at,
  last_contact_at = excluded.last_contact_at,
  last_inbound_at = excluded.last_inbound_at,
  last_outbound_at = excluded.last_outbound_at,
  updated_at = excluded.updated_at;
