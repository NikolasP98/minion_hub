-- Compatibility migration: existing ambiguous accounts stay unqualified, never choose an org.
alter table public.channels add column if not exists provider_account_id text;
alter table public.channels add column if not exists provider_account_verified_at timestamptz;
create unique index if not exists channels_whatsapp_provider_unique
 on public.channels(type,provider_account_id) where type='whatsapp' and provider_account_id is not null;
alter table public.channels add constraint channels_whatsapp_org_scope
 check(type <> 'whatsapp' or owner_profile_id is null) not valid;
alter table public.channels add constraint channels_whatsapp_provider_format
 check(type <> 'whatsapp' or provider_account_id is null or provider_account_id ~ '^[1-9][0-9]{6,14}$') not valid;
create unique index if not exists channels_whatsapp_auth_ref_unique
 on public.channels(auth_ref) where type='whatsapp' and auth_ref is not null;

create sequence if not exists public.channel_claim_revision_seq;
alter table public.user_identities add column if not exists claim_revision bigint not null default nextval('public.channel_claim_revision_seq');
create or replace function public.bump_channel_claim_revision() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.kind='channel' then new.claim_revision := nextval('public.channel_claim_revision_seq'); end if;
 return new;
end $$;
create trigger channel_claim_revision before update on public.user_identities
 for each row execute function public.bump_channel_claim_revision();

create table public.whatsapp_account_leases (
 channel_id text primary key references public.channels(id), org_id uuid not null,
 owner_id text not null, generation bigint not null default 1,
 lease_until timestamptz not null, provider_verified_at timestamptz, heartbeat_at timestamptz not null default now(),
 state text not null default 'starting' check(state in ('starting','connecting','ready','reconnecting','needs_relink','stopped','stale'))
);
create table public.whatsapp_assistant_turns (
 id uuid primary key default gen_random_uuid(), channel_id text not null references public.channels(id),
 provider_message_id text not null, org_id uuid not null, profile_id uuid not null,
 identity_id uuid not null, claim_revision bigint not null, sender_phone text not null,
 sender_jid text not null, provider_account_id text not null, gateway_id uuid not null,
 agent_id text not null, session_key text not null, run_id uuid not null default gen_random_uuid(),
 lease_generation bigint not null, owner_id text not null,
 state text not null default 'admitted' check(state in ('admitted','running','completed','cancelled','failed','reconcile_required')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(channel_id,provider_message_id)
);
create unique index whatsapp_one_running_conversation on public.whatsapp_assistant_turns(session_key) where state='running';
create table public.whatsapp_assistant_replies (
 id uuid primary key default gen_random_uuid(), turn_id uuid not null references public.whatsapp_assistant_turns(id),
 org_id uuid not null, reply_part integer not null check(reply_part between 0 and 99),
 body text not null check(length(body)<=16000), content_hash text not null,
 state text not null default 'pending' check(state in ('pending','sending','confirmed','unknown','cancelled')),
 provider_message_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(turn_id,reply_part)
);
-- No browser access. Routes use the trusted server database role and gateway-scoped checks.
alter table public.whatsapp_account_leases enable row level security;
alter table public.whatsapp_account_leases force row level security;
alter table public.whatsapp_assistant_turns enable row level security;
alter table public.whatsapp_assistant_turns force row level security;
alter table public.whatsapp_assistant_replies enable row level security;
alter table public.whatsapp_assistant_replies force row level security;
revoke all on public.whatsapp_account_leases,public.whatsapp_assistant_turns,public.whatsapp_assistant_replies from public,anon,authenticated;
grant all on public.whatsapp_account_leases,public.whatsapp_assistant_turns,public.whatsapp_assistant_replies to service_role;
create policy whatsapp_lease_service on public.whatsapp_account_leases to service_role using(true) with check(true);
create policy whatsapp_turn_service on public.whatsapp_assistant_turns to service_role using(true) with check(true);
create policy whatsapp_reply_service on public.whatsapp_assistant_replies to service_role using(true) with check(true);

create or replace function public.guard_whatsapp_account_binding() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.type='whatsapp' and (old.provider_account_verified_at is not null
   or exists(select 1 from whatsapp_account_leases where channel_id=old.id and lease_until>now())
   or exists(select 1 from whatsapp_assistant_turns where channel_id=old.id and state in ('admitted','running')))
   and (new.tenant_id is distinct from old.tenant_id or new.gateway_id is distinct from old.gateway_id
    or new.provider_account_id is distinct from old.provider_account_id or new.auth_ref is distinct from old.auth_ref
    or new.type is distinct from old.type or new.account_id is distinct from old.account_id) then
   raise exception 'paired account binding is immutable' using errcode='23514';
 end if;
 return new;
end $$;
create trigger whatsapp_account_binding before update on public.channels
 for each row execute function public.guard_whatsapp_account_binding();

-- Transport-neutral operation keys. A prepared row is uncertain after a worker crash,
-- never permission to retry an external side effect.
create table public.assistant_action_receipts (
 id uuid primary key default gen_random_uuid(), principal_id uuid not null, org_id uuid not null,
 turn_id uuid not null, action_id text not null, args_hash text not null check(args_hash ~ '^[0-9a-f]{64}$'),
 state text not null default 'prepared' check(state in ('prepared','committed','unknown')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(principal_id,org_id,turn_id,action_id)
);
alter table public.assistant_action_receipts enable row level security;
alter table public.assistant_action_receipts force row level security;
revoke all on public.assistant_action_receipts from public,anon,authenticated;
grant all on public.assistant_action_receipts to service_role;
create policy assistant_receipt_service on public.assistant_action_receipts to service_role using(true) with check(true);

create table public.whatsapp_assistant_confirmations (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, profile_id uuid not null,
 channel_id text not null references public.channels(id), identity_id uuid not null, claim_revision bigint not null,
 session_key text not null, preview_turn_id uuid not null references public.whatsapp_assistant_turns(id),
 action_name text not null, args_hash text not null check(args_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null default now()+interval '10 minutes', consumed_at timestamptz
);
create unique index whatsapp_one_pending_confirmation on public.whatsapp_assistant_confirmations(session_key) where consumed_at is null;
alter table public.whatsapp_assistant_confirmations enable row level security;
alter table public.whatsapp_assistant_confirmations force row level security;
revoke all on public.whatsapp_assistant_confirmations from public,anon,authenticated;
grant all on public.whatsapp_assistant_confirmations to service_role;
create policy whatsapp_confirmation_service on public.whatsapp_assistant_confirmations to service_role using(true) with check(true);

-- A queued legacy KG mirror must never resurrect a forgotten canonical memory.
create table public.agent_memory_tombstones (
 org_id text not null, agent_id text not null, source text not null, source_id text not null,
 profile_id uuid, deleted_at timestamptz not null default now(),
 primary key(org_id,agent_id,source,source_id)
);
alter table public.agent_memory_tombstones enable row level security;
alter table public.agent_memory_tombstones force row level security;
revoke all on public.agent_memory_tombstones from public,anon,authenticated;
grant all on public.agent_memory_tombstones to service_role;
create policy memory_tombstone_service on public.agent_memory_tombstones to service_role using(true) with check(true);
create or replace function public.fence_forgotten_agent_memory() returns trigger
 language plpgsql security definer set search_path=public as $$
declare r public.agent_memories;
begin
 if TG_OP='DELETE' then r:=old; else r:=new; end if;
 if r.source='kg' and r.source_id is not null then
   perform pg_advisory_xact_lock(hashtextextended(r.org_id||':'||r.agent_id||':'||r.source||':'||r.source_id,0));
   if TG_OP<>'DELETE' and exists(select 1 from agent_memory_tombstones t where t.org_id=r.org_id and t.agent_id=r.agent_id
     and t.source=r.source and t.source_id=r.source_id) then return null; end if;
 end if;
 if TG_OP='DELETE' then return old; else return new; end if;
end $$;
create trigger agent_memory_replay_fence before insert or update or delete on public.agent_memories
 for each row execute function public.fence_forgotten_agent_memory();
create or replace function public.record_forgotten_agent_memory() returns trigger
 language plpgsql security definer set search_path=public as $$
begin
 if old.source='kg' and old.source_id is not null then
   insert into agent_memory_tombstones(org_id,agent_id,source,source_id,profile_id)
   values(old.org_id,old.agent_id,old.source,old.source_id,old.profile_id) on conflict do nothing;
 end if;
 return old;
end $$;
create trigger agent_memory_forget_receipt after delete on public.agent_memories
 for each row execute function public.record_forgotten_agent_memory();
