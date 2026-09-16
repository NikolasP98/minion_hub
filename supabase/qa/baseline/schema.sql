


SET check_function_bodies = false;


CREATE SCHEMA public;



COMMENT ON SCHEMA public IS 'standard public schema';



CREATE FUNCTION public.ack_brain_vector_job(chunk_id uuid, generation text, revision bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  acked public.brain_vector_outbox%rowtype;
  indexed_hash text;
  indexed_generation text;
begin
  delete from public.brain_vector_outbox o
  where o.chunk_id = ack_brain_vector_job.chunk_id
    and o.collection_generation = ack_brain_vector_job.generation
    and o.revision = ack_brain_vector_job.revision
    and o.status = 'running'
  returning o.* into acked;

  if not found then
    return false;
  end if;

  indexed_hash := case
    when acked.desired_operation = 'upsert' then acked.desired_content_hash
  end;
  indexed_generation := case
    when acked.desired_operation = 'upsert' then acked.collection_generation
  end;

  update public.knowledge_chunks chunk
  set vector_indexed_hash = indexed_hash,
      vector_indexed_generation = indexed_generation
  where chunk.id = ack_brain_vector_job.chunk_id
    and chunk.org_id = acked.org_id
    and (
      chunk.vector_indexed_hash is distinct from indexed_hash
      or chunk.vector_indexed_generation is distinct from indexed_generation
    );

  update public.knowledge_chunks chunk
  set embedding = null,
      embedding_model = null,
      updated_at = now()
  from public.brain_vector_generations active
  where active.generation = ack_brain_vector_job.generation
    and active.is_active
    and active.storage_mode = 'qdrant'
    and chunk.id = ack_brain_vector_job.chunk_id
    and chunk.org_id = acked.org_id
    and (chunk.embedding is not null or chunk.embedding_model is not null);

  return true;
end;
$$;



CREATE FUNCTION public.brain_vector_app_generation_mode() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select generation.storage_mode
  from public.brain_vector_generations generation
  where generation.is_active and generation.enqueue_enabled
  limit 1;
$$;



CREATE FUNCTION public.brain_vector_app_source_pending_count(p_source_id uuid) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  with active as (
    select generation.generation
    from public.brain_vector_generations generation
    where generation.is_active and generation.enqueue_enabled
    limit 1
  )
  select count(*)
  from public.knowledge_chunks chunk
  left join public.brain_vector_outbox job
    on job.chunk_id = chunk.id
    and job.collection_generation = (select generation from active)
  where chunk.org_id = current_setting('app.current_org_id', true)
    and chunk.source_id = p_source_id
    and (
      job.status in ('queued', 'running', 'dead')
      or chunk.vector_indexed_hash is distinct from chunk.content_hash
      or chunk.vector_indexed_generation is distinct from (select generation from active)
    );
$$;



CREATE FUNCTION public.brain_vector_app_source_state(p_source_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  with active as (
    select generation.generation
    from public.brain_vector_generations generation
    where generation.is_active and generation.enqueue_enabled
    limit 1
  )
  select case
    when count(*) filter (where job.status = 'dead') > 0 then 'failed'
    when count(*) filter (
      where job.status in ('queued', 'running')
        or chunk.vector_indexed_hash is distinct from chunk.content_hash
        or chunk.vector_indexed_generation is distinct from (select generation from active)
    ) > 0 then 'queued'
    else 'ready'
  end
  from public.knowledge_chunks chunk
  left join public.brain_vector_outbox job
    on job.chunk_id = chunk.id
    and job.collection_generation = (select generation from active)
  where chunk.org_id = current_setting('app.current_org_id', true)
    and chunk.source_id = p_source_id;
$$;



CREATE FUNCTION public.brain_vector_worker_status(p_generation text) RETURNS TABLE(queued bigint, running bigint, dead bigint, oldest_queued_at timestamp with time zone, canonical_chunks bigint, last_reconcile_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if not exists (
    select 1 from public.brain_vector_generations g where g.generation = p_generation
  ) then
    raise exception 'unknown brain vector generation: %', p_generation using errcode = '22023';
  end if;

  return query
  select
    count(*) filter (where o.status = 'queued')::bigint,
    count(*) filter (where o.status = 'running')::bigint,
    count(*) filter (where o.status = 'dead')::bigint,
    min(o.available_at) filter (where o.status = 'queued'),
    (
      select count(*)::bigint
      from public.knowledge_chunks k
      join public.brain_vector_generations g on g.generation = p_generation
      where g.storage_mode = 'qdrant'
         or (k.embedding is not null and k.embedding_model = g.embedding_model)
    ),
    (
      select s.last_completed_at
      from public.brain_vector_reconcile_state s
      where s.collection_generation = p_generation
    )
  from public.brain_vector_outbox o
  where o.collection_generation = p_generation;
end;
$$;



CREATE FUNCTION public.claim_brain_vector_jobs(p_generation text, worker_id text, job_limit integer DEFAULT 100, lease_seconds integer DEFAULT 60) RETURNS TABLE(chunk_id uuid, org_id text, generation text, operation text, revision bigint, attempts integer, source_id uuid, document_id uuid, kind text, occurred_at timestamp with time zone, content_hash text, embedding_model text, embedding text, chunk_text text, context_prefix text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  with claimed as (
    select o.chunk_id, o.collection_generation
    from public.brain_vector_outbox o
    where o.collection_generation = p_generation
    and (
      (o.status = 'queued' and o.available_at <= now())
      or (o.status = 'running' and o.lease_until < now())
    )
    order by o.available_at, o.updated_at, o.chunk_id
    for update skip locked
    limit least(greatest(job_limit, 1), 500)
  ), leased as (
    update public.brain_vector_outbox o
    set status = 'running',
        attempts = o.attempts + 1,
        lease_owner = left(worker_id, 200),
        lease_until = now() + make_interval(secs => least(greatest(lease_seconds, 10), 900)),
        updated_at = now()
    from claimed c
    where o.chunk_id = c.chunk_id
      and o.collection_generation = c.collection_generation
    returning o.*
  )
  select
    l.chunk_id,
    l.org_id,
    l.collection_generation,
    case when k.id is null then 'delete' else l.desired_operation end,
    l.revision,
    l.attempts,
    k.source_id,
    k.document_id,
    k.kind,
    k.occurred_at,
    k.content_hash,
    g.embedding_model,
    k.embedding::text,
    k.chunk_text,
    k.context_prefix
  from leased l
  join public.brain_vector_generations g
    on g.generation = l.collection_generation
  left join public.knowledge_chunks k
    on k.id = l.chunk_id and k.org_id = l.org_id;
$$;



CREATE FUNCTION public.crm_contact_activity_on_identity_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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



CREATE FUNCTION public.crm_contact_activity_on_message_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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



CREATE FUNCTION public.crm_contact_activity_on_message_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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



CREATE FUNCTION public.crm_rebuild_contact_activity(p_contact_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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



CREATE FUNCTION public.crm_rebuild_org_contact_activity(p_org_id text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000) RETURNS TABLE(rebuilt integer, next_after uuid)
    LANGUAGE plpgsql
    AS $$
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



CREATE FUNCTION public.crm_refresh_sentiment_chat_daily(p_org_id text, p_from date, p_to date) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  refreshed bigint := 0;
begin
  if p_org_id is null or p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid CRM sentiment refresh range';
  end if;
  perform pg_advisory_xact_lock(hashtext('crm-sentiment-chat-daily'));

  delete from public.crm_sentiment_chat_daily
  where day between p_from and p_to
    and org_id = p_org_id;

  insert into public.crm_sentiment_chat_daily
    (org_id, chat_id, day, score, message_count, refreshed_at)
  select s.org_id,
         m.chat_id,
         (coalesce(m.occurred_at, m.created_at) at time zone 'UTC')::date as day,
         avg(s.score)::float8,
         count(*)::int,
         now()
  from public.crm_message_sentiment s
  join public.messages m on m.id = s.message_id and m.org_id = s.org_id
  where s.org_id = p_org_id
    and m.direction = 'inbound'
    and m.is_bot is not true
    and coalesce(m.occurred_at, m.created_at) >= (p_from::timestamp at time zone 'UTC')
    and coalesce(m.occurred_at, m.created_at) <
      ((p_to + 1)::timestamp at time zone 'UTC')
  group by s.org_id, m.chat_id, 3;

  get diagnostics refreshed = row_count;
  return refreshed;
end;
$$;



CREATE FUNCTION public.crm_refresh_word_frequency_daily(p_from date, p_to date) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  refreshed bigint := 0;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid CRM word-frequency refresh range';
  end if;
  perform pg_advisory_xact_lock(hashtext('crm-word-frequency-daily'));

  delete from public.crm_word_frequency_daily
  where day between p_from and p_to;

  insert into public.crm_word_frequency_daily
    (org_id, day, word, document_count, refreshed_at)
  select m.org_id,
         (coalesce(m.occurred_at, m.created_at) at time zone 'UTC')::date as day,
         lexeme.word,
         count(*)::bigint,
         now()
  from public.messages m
  cross join lateral unnest(
    tsvector_to_array(to_tsvector('simple', coalesce(m.content, '')))
  ) as lexeme(word)
  where m.direction = 'inbound'
    and m.is_bot is not true
    and m.content is not null
    and length(trim(m.content)) > 0
    and char_length(lexeme.word) >= 3
    and coalesce(m.occurred_at, m.created_at) >= (p_from::timestamp at time zone 'UTC')
    and coalesce(m.occurred_at, m.created_at) <
      ((p_to + 1)::timestamp at time zone 'UTC')
  group by m.org_id, 2, lexeme.word;

  get diagnostics refreshed = row_count;
  return refreshed;
end;
$$;



CREATE FUNCTION public.dead_letter_brain_vector_job(chunk_id uuid, generation text, revision bigint, error text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  update public.brain_vector_outbox o
  set status = 'dead',
      lease_owner = null,
      lease_until = null,
      last_error = left(dead_letter_brain_vector_job.error, 2000),
      updated_at = now()
  where o.chunk_id = dead_letter_brain_vector_job.chunk_id
    and o.collection_generation = dead_letter_brain_vector_job.generation
    and o.revision = dead_letter_brain_vector_job.revision
    and o.status = 'running';
  return found;
end;
$$;



CREATE FUNCTION public.detach_deleted_record_attachments() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE object_kind text;
DECLARE linked_file record;
BEGIN
  object_kind := CASE TG_TABLE_NAME
    WHEN 'crm_contacts' THEN 'crm_contact' WHEN 'sched_bookings' THEN 'booking'
    WHEN 'sched_event_types' THEN 'event_type' WHEN 'fin_products' THEN 'product'
    WHEN 'stk_items' THEN 'stk_item' WHEN 'stk_entries' THEN 'stk_entry'
    WHEN 'fin_invoices' THEN 'fin_invoice' WHEN 'pos_tickets' THEN 'pos_ticket'
    ELSE NULL END;
  IF object_kind IS NULL THEN RAISE EXCEPTION 'unsupported attachment record table'; END IF;
  FOR linked_file IN
    SELECT f.id,f.tenant_id,f.b2_file_key FROM public.files f
    WHERE f.tenant_id::text=OLD.org_id AND EXISTS (
      SELECT 1 FROM public.attachment_links l WHERE l.org_id=OLD.org_id
        AND l.object_type=object_kind AND l.object_id=OLD.id AND l.file_id=f.id)
    ORDER BY f.id FOR UPDATE OF f
  LOOP
    INSERT INTO public.attachment_file_state(file_id,org_id,file_key,access_modules,upload_expires_at)
      VALUES (linked_file.id,OLD.org_id,linked_file.b2_file_key,ARRAY(SELECT DISTINCT CASE l.object_type WHEN 'crm_contact' THEN 'crm' WHEN 'booking' THEN 'scheduling' WHEN 'event_type' THEN 'scheduling' WHEN 'product' THEN 'pos' WHEN 'pos_ticket' THEN 'pos' WHEN 'stk_item' THEN 'stock' WHEN 'stk_entry' THEN 'stock' WHEN 'fin_invoice' THEN 'finance' END
        FROM public.attachment_links l WHERE l.file_id=linked_file.id AND l.org_id=OLD.org_id),CASE WHEN linked_file.b2_file_key LIKE OLD.org_id || '/attachments/%' THEN now()+interval '15 minutes' END)
      ON CONFLICT(file_id) DO UPDATE SET access_modules=ARRAY(SELECT DISTINCT unnest(public.attachment_file_state.access_modules || EXCLUDED.access_modules));
  END LOOP;
  INSERT INTO public.attachment_trash(org_id,file_id,object_type,object_id,linked_by,linked_at,hidden_by,hidden_at)
    SELECT l.org_id,l.file_id,l.object_type,l.object_id,l.linked_by,l.linked_at,NULL,now()
    FROM public.attachment_links l
    WHERE l.org_id=OLD.org_id AND l.object_type=object_kind AND l.object_id=OLD.id
  ON CONFLICT (object_type,object_id,file_id) DO UPDATE
    SET hidden_at=EXCLUDED.hidden_at,hidden_by=NULL,linked_by=EXCLUDED.linked_by,linked_at=EXCLUDED.linked_at;
  DELETE FROM public.attachment_links
    WHERE org_id=OLD.org_id AND object_type=object_kind AND object_id=OLD.id;
  RETURN OLD;
END $$;



CREATE FUNCTION public.enqueue_brain_vector_backfill(generation text, after_chunk_id uuid DEFAULT NULL::uuid, row_limit integer DEFAULT 500) RETURNS TABLE(enqueued integer, next_chunk_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  changed integer := 0;
  cursor_id uuid;
begin
  with page as materialized (
    select k.id, k.org_id, k.content_hash
    from public.knowledge_chunks k
    join public.brain_vector_generations g
      on g.generation = enqueue_brain_vector_backfill.generation
     and g.enqueue_enabled
    where (g.storage_mode = 'qdrant' or (
        k.embedding is not null and k.embedding_model = g.embedding_model
      ))
      and (after_chunk_id is null or k.id > after_chunk_id)
    order by k.id
    limit least(greatest(row_limit, 1), 1000)
  )
  insert into public.brain_vector_outbox (
    chunk_id, org_id, collection_generation, desired_operation,
    desired_content_hash, revision, status, attempts, available_at,
    lease_owner, lease_until, last_error, updated_at
  )
  select id, org_id, generation, 'upsert', content_hash, 1, 'queued', 0,
         now(), null, null, null, now()
  from page
  on conflict (chunk_id, collection_generation) do update set
    org_id = excluded.org_id,
    desired_operation = 'upsert',
    desired_content_hash = excluded.desired_content_hash,
    revision = public.brain_vector_outbox.revision + 1,
    status = 'queued', attempts = 0, available_at = now(),
    lease_owner = null, lease_until = null, last_error = null, updated_at = now()
  where public.brain_vector_outbox.desired_operation <> 'upsert'
     or public.brain_vector_outbox.desired_content_hash is distinct from excluded.desired_content_hash;
  get diagnostics changed = row_count;

  select page.id into cursor_id
  from (
    select k.id
    from public.knowledge_chunks k
    join public.brain_vector_generations g
      on g.generation = enqueue_brain_vector_backfill.generation
     and g.enqueue_enabled
    where (g.storage_mode = 'qdrant' or (
        k.embedding is not null and k.embedding_model = g.embedding_model
      ))
      and (after_chunk_id is null or k.id > after_chunk_id)
    order by k.id
    limit least(greatest(row_limit, 1), 1000)
  ) page
  order by page.id desc
  limit 1;

  return query select changed, cursor_id;
end;
$$;



CREATE FUNCTION public.enqueue_brain_vector_chunk() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  target public.brain_vector_generations%rowtype;
  operation text;
  chunk_uuid uuid;
  chunk_org text;
  chunk_hash text;
begin
  select * into target
  from public.brain_vector_generations
  where is_active and enqueue_enabled
  limit 1;

  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'UPDATE'
     and new.content_hash is not distinct from old.content_hash
     and new.org_id is not distinct from old.org_id
     and new.source_id is not distinct from old.source_id
     and new.document_id is not distinct from old.document_id
     and new.kind is not distinct from old.kind
     and new.occurred_at is not distinct from old.occurred_at
     and (
       target.storage_mode = 'qdrant'
       or (
         new.embedding_model is not distinct from old.embedding_model
         and new.embedding is not distinct from old.embedding
       )
     ) then
    return new;
  end if;

  if tg_op = 'DELETE' then
    operation := 'delete';
    chunk_uuid := old.id;
    chunk_org := old.org_id;
    chunk_hash := old.content_hash;
  elsif target.storage_mode = 'qdrant' then
    operation := 'upsert';
    chunk_uuid := new.id;
    chunk_org := new.org_id;
    chunk_hash := new.content_hash;
  elsif tg_op = 'INSERT' and (
    new.embedding is null or new.embedding_model is distinct from target.embedding_model
  ) then
    return new;
  elsif new.embedding is null or new.embedding_model is distinct from target.embedding_model then
    operation := 'delete';
    chunk_uuid := new.id;
    chunk_org := new.org_id;
    chunk_hash := new.content_hash;
  else
    operation := 'upsert';
    chunk_uuid := new.id;
    chunk_org := new.org_id;
    chunk_hash := new.content_hash;
  end if;

  insert into public.brain_vector_outbox (
    chunk_id, org_id, collection_generation, desired_operation,
    desired_content_hash, revision, status, attempts, available_at,
    lease_owner, lease_until, last_error, updated_at
  ) values (
    chunk_uuid, chunk_org, target.generation, operation,
    chunk_hash, 1, 'queued', 0, now(), null, null, null, now()
  )
  on conflict (chunk_id, collection_generation) do update set
    org_id = excluded.org_id,
    desired_operation = excluded.desired_operation,
    desired_content_hash = excluded.desired_content_hash,
    revision = public.brain_vector_outbox.revision + 1,
    status = 'queued',
    attempts = 0,
    available_at = now(),
    lease_owner = null,
    lease_until = null,
    last_error = null,
    updated_at = now();

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;



CREATE FUNCTION public.filter_existing_brain_vector_chunks(chunk_ids uuid[], generation text) RETURNS TABLE(chunk_id uuid, org_id text, content_hash text, embedding_model text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if cardinality(chunk_ids) > 1000 then
    raise exception 'filter_existing_brain_vector_chunks accepts at most 1000 chunk IDs'
      using errcode = '22023';
  end if;

  return query
  select k.id, k.org_id, k.content_hash, g.embedding_model
  from public.knowledge_chunks k
  join public.brain_vector_generations g
    on g.generation = filter_existing_brain_vector_chunks.generation
  where cardinality(chunk_ids) >= 1
    and k.id = any(chunk_ids)
    and (g.storage_mode = 'qdrant' or (
      k.embedding is not null and k.embedding_model = g.embedding_model
    ))
  order by k.id;
end;
$$;



CREATE FUNCTION public.guard_attachment_file_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF NEW.file_id<>OLD.file_id OR NEW.org_id<>OLD.org_id OR NEW.file_key<>OLD.file_key
     OR NOT (OLD.access_modules <@ NEW.access_modules)
     OR (OLD.state='deleting' AND NEW.state<>'deleting') THEN
    RAISE EXCEPTION 'attachment lifecycle identity and deletion are immutable';
  END IF;
  RETURN NEW;
END $$;



CREATE FUNCTION public.guard_managed_file_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF TG_OP='INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.attachment_file_state s WHERE s.file_id=NEW.id OR (s.org_id=NEW.tenant_id::text AND s.file_key=NEW.b2_file_key)) THEN
      RAISE EXCEPTION 'managed attachment key cannot be reused';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.b2_file_key<>OLD.b2_file_key)
     AND EXISTS (SELECT 1 FROM public.attachment_file_state s WHERE s.file_id=OLD.id AND s.org_id=OLD.tenant_id::text) THEN
    RAISE EXCEPTION 'managed attachment file identity is immutable';
  END IF;
  RETURN NEW;
END $$;



CREATE FUNCTION public.handle_new_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if new.email is null then
    return new;
  end if;
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;



CREATE FUNCTION public.hub_broadcast_message_committed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if to_regclass('realtime.messages_' || to_char(now() at time zone 'utc', 'YYYY_MM_DD')) is null then
    return null;
  end if;
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



COMMENT ON FUNCTION public.hub_broadcast_message_committed() IS 'Emits a compact private message.committed change signal for Hub browser freshness.';



CREATE FUNCTION public.job_effect_batch_complete(tenant text, batch text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE parent public.job_effect_batches%ROWTYPE; actual jsonb; positions integer[];
BEGIN
  IF batch IS NULL THEN RETURN; END IF;
  SELECT * INTO parent FROM public.job_effect_batches WHERE tenant_id=tenant AND id=batch;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch membership parent missing' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(id ORDER BY vector_index),'[]'::jsonb),array_agg(vector_index ORDER BY vector_index)
    INTO actual,positions FROM public.job_effect_units WHERE tenant_id=tenant AND batch_id=batch;
  IF parent.state='abandoned_unsent' THEN
    IF actual<>'[]'::jsonb THEN RAISE EXCEPTION 'abandoned batch retains active placements' USING ERRCODE='23514'; END IF;
  ELSIF actual IS DISTINCT FROM parent.unit_ids OR positions IS DISTINCT FROM ARRAY(SELECT generate_series(0,parent.count-1)) THEN
    RAISE EXCEPTION 'batch membership must be complete and dense' USING ERRCODE='23514';
  END IF;
END $$;



CREATE FUNCTION public.job_effect_batch_descriptor_valid(descriptor jsonb, members jsonb, expected integer) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $_$
DECLARE member jsonb;
BEGIN
  IF descriptor IS NULL OR members IS NULL OR expected IS NULL OR expected NOT BETWEEN 1 AND 64
    OR jsonb_typeof(descriptor)<>'object' OR jsonb_typeof(members)<>'array' THEN RETURN false; END IF;
  IF jsonb_array_length(members)<>expected OR octet_length(descriptor::text)>4096 THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(descriptor))<>7 THEN RETURN false; END IF;
  FOR member IN SELECT jsonb_array_elements(members) LOOP
    IF jsonb_typeof(member)<>'string' OR (member#>>'{}') !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(members))<>expected THEN RETURN false; END IF;
  RETURN (descriptor ?& ARRAY['payloadHash','endpoint','model','normalization','count','dimensions','pipelineVersion']
    AND jsonb_typeof(descriptor->'payloadHash')='string' AND descriptor->>'payloadHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(descriptor->'endpoint')='string' AND length(descriptor->>'endpoint') BETWEEN 1 AND 512
    AND jsonb_typeof(descriptor->'model')='string' AND length(descriptor->>'model') BETWEEN 1 AND 128
    AND jsonb_typeof(descriptor->'normalization')='string' AND length(descriptor->>'normalization') BETWEEN 1 AND 128
    AND jsonb_typeof(descriptor->'pipelineVersion')='string' AND length(descriptor->>'pipelineVersion') BETWEEN 1 AND 128
    AND jsonb_typeof(descriptor->'count')='number' AND descriptor->>'count'=expected::text
    AND jsonb_typeof(descriptor->'dimensions')='number' AND descriptor->>'dimensions'='1536') IS TRUE;
END $_$;



CREATE FUNCTION public.job_effect_batches_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE membership_text text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'batch receipts cannot be deleted' USING ERRCODE='23514'; END IF;
  -- Members are fixed hexadecimal strings, so compact array framing is unambiguous.
  IF NOT public.job_effect_batch_descriptor_valid(NEW.descriptor,NEW.unit_ids,NEW.count) THEN
    RAISE EXCEPTION 'invalid complete batch descriptor' USING ERRCODE='23514'; END IF;
  SELECT '['||string_agg(to_jsonb(value)::text,',' ORDER BY ordinality)||']' INTO membership_text
    FROM jsonb_array_elements_text(NEW.unit_ids) WITH ORDINALITY;
  IF encode(sha256(convert_to(membership_text,'UTF8')),'hex')<>NEW.membership_hash THEN
    RAISE EXCEPTION 'batch membership digest mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    PERFORM public.job_effect_page_actor(NEW.tenant_id,NEW.reservation_job_id,NEW.reservation_generation,NULL,NULL);
    IF NEW.state<>'reserved' THEN RAISE EXCEPTION 'batch must begin reserved' USING ERRCODE='23514'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['reservation_job_id','reservation_generation','dispatch_job_id','dispatch_generation','state','result','abandonment_reason','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reservation_job_id','reservation_generation','dispatch_job_id','dispatch_generation','state','result','abandonment_reason','updated_at']) THEN
      RAISE EXCEPTION 'batch identity and membership are immutable' USING ERRCODE='23514'; END IF;
    IF OLD.state='reserved' AND NEW.state='reserved' THEN
      PERFORM public.job_effect_page_actor(NEW.tenant_id,NEW.reservation_job_id,NEW.reservation_generation,OLD.reservation_job_id,OLD.reservation_generation);
    ELSIF OLD.state='reserved' AND NEW.state='abandoned_unsent' THEN
      PERFORM public.job_effect_page_actor(NEW.tenant_id,NULL,NULL,OLD.reservation_job_id,OLD.reservation_generation);
      IF NEW.reservation_job_id<>OLD.reservation_job_id OR NEW.reservation_generation<>OLD.reservation_generation THEN
        RAISE EXCEPTION 'abandoned owner is immutable' USING ERRCODE='23514'; END IF;
    ELSIF OLD.state='reserved' AND NEW.state='admitted' THEN
      PERFORM public.job_effect_page_actor(NEW.tenant_id,OLD.reservation_job_id,OLD.reservation_generation,NULL,NULL);
      IF NEW.reservation_job_id<>OLD.reservation_job_id OR NEW.reservation_generation<>OLD.reservation_generation
        OR NEW.dispatch_job_id IS DISTINCT FROM OLD.reservation_job_id OR NEW.dispatch_generation IS DISTINCT FROM OLD.reservation_generation THEN
        RAISE EXCEPTION 'dispatch must preserve current reservation owner' USING ERRCODE='23514'; END IF;
    ELSIF OLD.state='admitted' AND NEW.state='received' THEN
      -- Historical response retention deliberately does not inspect semantic heads.
      PERFORM public.job_effect_page_actor(NEW.tenant_id,OLD.dispatch_job_id,OLD.dispatch_generation,NULL,NULL);
      IF NEW.reservation_job_id<>OLD.reservation_job_id OR NEW.reservation_generation<>OLD.reservation_generation
        OR NEW.dispatch_job_id IS DISTINCT FROM OLD.dispatch_job_id OR NEW.dispatch_generation IS DISTINCT FROM OLD.dispatch_generation THEN
        RAISE EXCEPTION 'response ownership is immutable' USING ERRCODE='23514'; END IF;
    ELSE
      RAISE EXCEPTION 'batch transition or immutable receipt mutation denied' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;



CREATE FUNCTION public.job_effect_membership_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF TG_TABLE_NAME='job_effect_batches' THEN
    PERFORM public.job_effect_batch_complete(NEW.tenant_id,NEW.id);
  ELSE
    IF TG_OP<>'INSERT' THEN PERFORM public.job_effect_batch_complete(OLD.tenant_id,OLD.batch_id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM public.job_effect_batch_complete(NEW.tenant_id,NEW.batch_id); END IF;
  END IF;
  RETURN NULL;
END $$;



CREATE FUNCTION public.job_effect_page_actor(tenant text, expected_job text, expected_generation integer, previous_job text, previous_generation integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE actor text := current_setting('app.job_effect_job_id',true);
  generation_text text := current_setting('app.job_effect_lease_generation',true);
  owners_text text := current_setting('app.job_effect_prelocked_owners',true);
  generation integer; owners jsonb; ref jsonb; current_job public.bg_jobs%ROWTYPE; old_job public.bg_jobs%ROWTYPE;
BEGIN
  IF tenant IS DISTINCT FROM nullif(current_setting('app.current_org_id',true),'')
    OR actor IS NULL OR length(actor) NOT BETWEEN 1 AND 256
    OR generation_text IS NULL OR generation_text !~ '^(0|[1-9][0-9]{0,9})$'
    OR owners_text IS NULL OR octet_length(owners_text)>131072 THEN
    RAISE EXCEPTION 'job effect actor context missing or malformed' USING ERRCODE='23514';
  END IF;
  IF generation_text::bigint>2147483647 THEN RAISE EXCEPTION 'job effect actor generation invalid' USING ERRCODE='23514'; END IF;
  generation := generation_text::integer;
  owners := owners_text::jsonb;
  IF jsonb_typeof(owners)<>'array' THEN RAISE EXCEPTION 'job effect owner manifest invalid' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(owners)>256 THEN RAISE EXCEPTION 'job effect owner manifest capacity' USING ERRCODE='23514'; END IF;
  FOR ref IN SELECT jsonb_array_elements(owners) LOOP
    IF jsonb_typeof(ref)<>'object' THEN RAISE EXCEPTION 'job effect owner reference invalid' USING ERRCODE='23514'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(ref))<>2 OR NOT (ref ?& ARRAY['jobId','reservationGeneration'])
      OR jsonb_typeof(ref->'jobId')<>'string' OR length(ref->>'jobId') NOT BETWEEN 1 AND 256
      OR jsonb_typeof(ref->'reservationGeneration')<>'number'
      OR ref->>'reservationGeneration' !~ '^(0|[1-9][0-9]{0,9})$' THEN
      RAISE EXCEPTION 'job effect owner reference invalid' USING ERRCODE='23514';
    END IF;
    IF (ref->>'reservationGeneration')::bigint>2147483647 THEN
      RAISE EXCEPTION 'job effect owner generation invalid' USING ERRCODE='23514'; END IF;
  END LOOP;
  -- Reject a missing declaration before any possible foreign-row lock.
  IF previous_job IS NOT NULL AND previous_job<>actor AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(owners) r WHERE r->>'jobId'=previous_job
      AND (r->>'reservationGeneration')::integer=previous_generation) THEN
    RAISE EXCEPTION 'undeclared reservation owner' USING ERRCODE='23514';
  END IF;
  SELECT * INTO current_job FROM public.bg_jobs WHERE tenant_id=tenant AND id=actor FOR UPDATE NOWAIT;
  IF NOT FOUND OR current_job.status<>'running' OR current_job.lease_generation<>generation
    OR coalesce(current_job.lease_until,0)<=floor(extract(epoch FROM clock_timestamp())*1000) THEN
    RAISE EXCEPTION 'job effect actor ownership lost' USING ERRCODE='23514';
  END IF;
  IF (expected_job IS NOT NULL AND expected_job<>actor)
    OR (expected_generation IS NOT NULL AND expected_generation<>generation) THEN
    RAISE EXCEPTION 'job effect actor does not own transition' USING ERRCODE='23514';
  END IF;
  IF previous_job IS NOT NULL THEN
    IF previous_job=actor THEN
      old_job := current_job;
    ELSE
      SELECT * INTO old_job FROM public.bg_jobs WHERE tenant_id=tenant AND id=previous_job FOR UPDATE NOWAIT;
      IF NOT FOUND THEN RAISE EXCEPTION 'owner_missing: reservation owner requires recovery' USING ERRCODE='23514'; END IF;
    END IF;
    IF previous_job<>actor AND old_job.status='running' AND old_job.lease_generation=previous_generation
      AND coalesce(old_job.lease_until,0)>floor(extract(epoch FROM clock_timestamp())*1000) THEN
      RAISE EXCEPTION 'reservation owner is live' USING ERRCODE='23514';
    END IF;
  END IF;
END $_$;



CREATE FUNCTION public.job_effect_pages_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE source jsonb; head public.job_effects%ROWTYPE; total integer := 0; unit_id text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'page receipts cannot be deleted' USING ERRCODE='23514'; END IF;
  PERFORM public.job_effect_page_actor(NEW.tenant_id,NEW.job_id,NULL,NULL,NULL);
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'bound' OR NEW.completion IS NOT NULL THEN RAISE EXCEPTION 'page must begin bound' USING ERRCODE='23514'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['state','completion','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['state','completion','updated_at']) OR OLD.state<>'bound' OR NEW.state<>'published' THEN
      RAISE EXCEPTION 'page descriptor and publication are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.descriptor->>'version' IS DISTINCT FROM '1' OR NEW.descriptor->>'pageKey' IS DISTINCT FROM NEW.page_key
    OR jsonb_typeof(NEW.descriptor->'sources') IS DISTINCT FROM 'array'
    OR coalesce(NEW.descriptor->>'mode','') NOT IN ('embedded','disabled','qdrant') THEN
    RAISE EXCEPTION 'invalid page descriptor' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(NEW.descriptor->'sources')>64 THEN RAISE EXCEPTION 'page source capacity' USING ERRCODE='23514'; END IF;
  FOR source IN SELECT jsonb_array_elements(NEW.descriptor->'sources') LOOP
    IF jsonb_typeof(source->'chunks') IS DISTINCT FROM 'array' OR jsonb_typeof(source->'unitIds') IS DISTINCT FROM 'array'
      OR jsonb_typeof(source->'requiredChunkKeys') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid page source descriptor' USING ERRCODE='23514'; END IF;
    total := total+jsonb_array_length(source->'chunks');
    IF total>256 OR jsonb_array_length(source->'unitIds')<>jsonb_array_length(source->'requiredChunkKeys')
      OR jsonb_array_length(source->'unitIds')>jsonb_array_length(source->'chunks') THEN
      RAISE EXCEPTION 'invalid page canonical membership' USING ERRCODE='23514'; END IF;
    SELECT * INTO head FROM public.job_effects WHERE tenant_id=NEW.tenant_id AND id=source->>'sourceKey' AND kind='head' FOR UPDATE NOWAIT;
    IF NOT FOUND OR head.state<>'active' OR head.revision::text IS DISTINCT FROM source#>>'{request,revision}'
      OR head.source_hash IS DISTINCT FROM source#>>'{request,sourceHash}' OR head.family IS DISTINCT FROM source#>>'{request,family}'
      OR head.entity_id IS DISTINCT FROM source#>>'{request,entityId}' OR head.manifest_hash IS DISTINCT FROM source->>'manifestHash' THEN
      RAISE EXCEPTION 'page source is not current' USING ERRCODE='23514'; END IF;
    IF NEW.state='published' AND NEW.descriptor->>'mode'='embedded' THEN
      FOR unit_id IN SELECT jsonb_array_elements_text(source->'unitIds') LOOP
        IF NOT EXISTS(SELECT 1 FROM public.job_effect_units u JOIN public.job_effect_batches b
          ON b.tenant_id=u.tenant_id AND b.id=u.batch_id
          WHERE u.tenant_id=NEW.tenant_id AND u.id=unit_id AND u.head_id=head.id AND u.revision=head.revision
            AND u.source_hash=head.source_hash AND u.manifest_hash=head.manifest_hash AND b.state='received') THEN
          RAISE EXCEPTION 'page publication requires complete current units' USING ERRCODE='23514'; END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;



CREATE FUNCTION public.job_effect_units_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE parent public.job_effect_batches%ROWTYPE; head public.job_effects%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'semantic units cannot be deleted' USING ERRCODE='23514'; END IF;
  PERFORM public.job_effect_page_actor(NEW.tenant_id,NULL,NULL,NULL,NULL);
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['batch_id','vector_index','first_published_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['batch_id','vector_index','first_published_at']) THEN
      RAISE EXCEPTION 'semantic unit identity is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.first_published_at IS NOT NULL AND NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
      RAISE EXCEPTION 'unit consumption is irreversible' USING ERRCODE='23514'; END IF;
    IF OLD.batch_id IS NOT NULL AND (NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.vector_index IS DISTINCT FROM OLD.vector_index) THEN
      SELECT * INTO parent FROM public.job_effect_batches WHERE tenant_id=OLD.tenant_id AND id=OLD.batch_id;
      IF NOT FOUND OR parent.state<>'abandoned_unsent' THEN
        RAISE EXCEPTION 'only an abandoned unsent placement may be released' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  IF NEW.batch_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.vector_index IS DISTINCT FROM OLD.vector_index) THEN
    SELECT * INTO parent FROM public.job_effect_batches WHERE tenant_id=NEW.tenant_id AND id=NEW.batch_id;
    IF NOT FOUND OR parent.state<>'reserved' OR parent.unit_ids->>NEW.vector_index IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'unit placement must match complete reserved membership' USING ERRCODE='23514'; END IF;
    PERFORM public.job_effect_page_actor(NEW.tenant_id,parent.reservation_job_id,parent.reservation_generation,NULL,NULL);
  END IF;
  IF TG_OP='INSERT' OR (OLD.first_published_at IS NULL AND NEW.first_published_at IS NOT NULL) THEN
    SELECT * INTO head FROM public.job_effects WHERE tenant_id=NEW.tenant_id AND id=NEW.head_id AND kind='head' FOR UPDATE NOWAIT;
    IF NOT FOUND OR head.state<>'active' OR head.revision<>NEW.revision OR head.source_hash<>NEW.source_hash
      OR head.manifest_hash IS DISTINCT FROM NEW.manifest_hash THEN
      RAISE EXCEPTION 'semantic unit source is not current' USING ERRCODE='23514'; END IF;
    IF NEW.first_published_at IS NOT NULL THEN
      SELECT * INTO parent FROM public.job_effect_batches WHERE tenant_id=NEW.tenant_id AND id=NEW.batch_id;
      IF NOT FOUND OR parent.state<>'received' THEN RAISE EXCEPTION 'unit publication needs complete receipt' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;



CREATE FUNCTION public.job_effect_vectors_valid(value jsonb, expected integer) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $$
DECLARE vector jsonb; component jsonb;
BEGIN
  IF value IS NULL OR expected IS NULL OR expected NOT BETWEEN 1 AND 64
     OR jsonb_typeof(value) <> 'array' OR pg_column_size(value) > 4000000 THEN RETURN false; END IF;
  IF jsonb_array_length(value) <> expected THEN RETURN false; END IF;
  FOR vector IN SELECT jsonb_array_elements(value) LOOP
    IF jsonb_typeof(vector) <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(vector) <> 1536 THEN RETURN false; END IF;
    FOR component IN SELECT jsonb_array_elements(vector) LOOP
      IF jsonb_typeof(component) <> 'number' THEN RETURN false; END IF;
      IF abs((component #>> '{}')::numeric) > 1.7976931348623157e308 THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END $$;



CREATE FUNCTION public.list_brain_vector_chunks(after_chunk_id uuid DEFAULT NULL::uuid, row_limit integer DEFAULT 500, generation text DEFAULT 'openai_te3s_1536_g1'::text) RETURNS TABLE(chunk_id uuid, org_id text, generation text, source_id uuid, document_id uuid, kind text, occurred_at timestamp with time zone, content_hash text, embedding_model text, embedding text, chunk_text text, context_prefix text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  select k.id, k.org_id, g.generation, k.source_id, k.document_id, k.kind, k.occurred_at,
         k.content_hash, g.embedding_model, k.embedding::text, k.chunk_text, k.context_prefix
  from public.knowledge_chunks k
  join public.brain_vector_generations g
    on g.generation = list_brain_vector_chunks.generation
  where (g.storage_mode = 'qdrant' or (
      k.embedding is not null and k.embedding_model = g.embedding_model
    ))
    and (after_chunk_id is null or k.id > after_chunk_id)
  order by k.id
  limit least(greatest(row_limit, 1), 1000);
$$;



CREATE FUNCTION public.load_brain_vector_reconcile_cursor(p_generation text) RETURNS TABLE(after_chunk_id uuid, qdrant_after_offset jsonb)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  select s.after_chunk_id, s.qdrant_after_offset
  from public.brain_vector_reconcile_state s
  where s.collection_generation = p_generation;
$$;



CREATE FUNCTION public.retry_brain_vector_job(chunk_id uuid, generation text, revision bigint, error text, available_at timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  update public.brain_vector_outbox o
  set status = case when o.attempts >= 8 then 'dead' else 'queued' end,
      available_at = least(greatest(retry_brain_vector_job.available_at, now() + interval '1 second'), now() + interval '24 hours'),
      lease_owner = null,
      lease_until = null,
      last_error = left(retry_brain_vector_job.error, 2000),
      updated_at = now()
  where o.chunk_id = retry_brain_vector_job.chunk_id
    and o.collection_generation = retry_brain_vector_job.generation
    and o.revision = retry_brain_vector_job.revision
    and o.status = 'running';
  return found;
end;
$$;



CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;



CREATE FUNCTION public.save_brain_vector_reconcile_cursor(p_generation text, next_chunk_id uuid, next_qdrant_offset jsonb, scanned_delta integer, repaired_delta integer, orphaned_delta integer, failed_delta integer, cycle_complete boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if least(scanned_delta, repaired_delta, orphaned_delta, failed_delta) < 0 then
    raise exception 'reconcile deltas must be nonnegative';
  end if;

  insert into public.brain_vector_reconcile_state as s (
    collection_generation, after_chunk_id, qdrant_after_offset,
    cycle_started_at, last_completed_at, scanned, repaired, orphaned, failed,
    updated_at
  ) values (
    p_generation,
    case when cycle_complete then null else next_chunk_id end,
    case when cycle_complete then null else next_qdrant_offset end,
    case when cycle_complete then null else now() end,
    case when cycle_complete then now() else null end,
    case when cycle_complete then 0 else scanned_delta end,
    case when cycle_complete then 0 else repaired_delta end,
    case when cycle_complete then 0 else orphaned_delta end,
    case when cycle_complete then 0 else failed_delta end,
    now()
  )
  on conflict (collection_generation) do update
  set after_chunk_id = case when cycle_complete then null else next_chunk_id end,
      qdrant_after_offset = case when cycle_complete then null else next_qdrant_offset end,
      cycle_started_at = case
        when cycle_complete then null
        else coalesce(s.cycle_started_at, now())
      end,
      last_completed_at = case when cycle_complete then now() else s.last_completed_at end,
      scanned = case when cycle_complete then 0 else s.scanned + scanned_delta end,
      repaired = case when cycle_complete then 0 else s.repaired + repaired_delta end,
      orphaned = case when cycle_complete then 0 else s.orphaned + orphaned_delta end,
      failed = case when cycle_complete then 0 else s.failed + failed_delta end,
      updated_at = now();
  return true;
end;
$$;





CREATE TABLE public.agent_artifact_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    artifact_id uuid NOT NULL,
    version integer NOT NULL,
    prompt text,
    html text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.agent_artifact_revisions FORCE ROW LEVEL SECURITY;



CREATE TABLE public.agent_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    agent_id text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    icon text DEFAULT 'LayoutDashboard'::text NOT NULL,
    html text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    prompt text
);

ALTER TABLE ONLY public.agent_artifacts FORCE ROW LEVEL SECURITY;



CREATE TABLE public.agent_built_skills (
    id text NOT NULL,
    gateway_agent_id text NOT NULL,
    gateway_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    skill_id text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.agent_built_skills FORCE ROW LEVEL SECURITY;



CREATE TABLE public.agent_group_members (
    group_id text NOT NULL,
    agent_id text NOT NULL,
    sort_order integer DEFAULT 0
);

ALTER TABLE ONLY public.agent_group_members FORCE ROW LEVEL SECURITY;



CREATE TABLE public.agent_groups (
    id text NOT NULL,
    profile_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.agent_groups FORCE ROW LEVEL SECURITY;



CREATE TABLE public.agent_memories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    gateway_id text,
    agent_id text NOT NULL,
    profile_id uuid,
    content text NOT NULL,
    embedding public.vector(1536),
    category text DEFAULT 'other'::text NOT NULL,
    importance real DEFAULT 0.5 NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    source_id text,
    occurred_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.agent_memories FORCE ROW LEVEL SECURITY;



CREATE TABLE public.ai_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text,
    route text,
    feature text,
    model text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    cache_read_tokens integer DEFAULT 0 NOT NULL,
    cache_write_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    reasoning_tokens integer DEFAULT 0 NOT NULL,
    cost_usd double precision DEFAULT 0 NOT NULL,
    provider_cost_usd double precision,
    duration_ms integer,
    ok boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_usage FORCE ROW LEVEL SECURITY;



CREATE TABLE public.app_modules (
    org_id text NOT NULL,
    module_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.app_modules FORCE ROW LEVEL SECURITY;



CREATE TABLE public.assignment_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    doc_type text NOT NULL,
    strategy text DEFAULT 'round_robin'::text NOT NULL,
    assignees jsonb DEFAULT '[]'::jsonb NOT NULL,
    condition jsonb DEFAULT '[]'::jsonb NOT NULL,
    cursor integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.assignment_rules FORCE ROW LEVEL SECURITY;



CREATE TABLE public.attachment_file_state (
    file_id text NOT NULL,
    org_id text NOT NULL,
    file_key text NOT NULL,
    access_modules text[] DEFAULT '{}'::text[] NOT NULL,
    delete_attempted_at timestamp with time zone,
    upload_expires_at timestamp with time zone,
    delete_reconciled_at timestamp with time zone,
    state text DEFAULT 'active'::text NOT NULL,
    delete_requested_by uuid,
    delete_requested_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attachment_file_state_access_modules_check CHECK ((access_modules <@ ARRAY['crm'::text, 'scheduling'::text, 'pos'::text, 'stock'::text, 'finance'::text])),
    CONSTRAINT attachment_file_state_check CHECK ((((state = 'active'::text) AND (delete_requested_at IS NULL)) OR ((state = 'deleting'::text) AND (delete_requested_at IS NOT NULL)))),
    CONSTRAINT attachment_file_state_state_check CHECK ((state = ANY (ARRAY['active'::text, 'deleting'::text])))
);

ALTER TABLE ONLY public.attachment_file_state FORCE ROW LEVEL SECURITY;



CREATE TABLE public.attachment_links (
    org_id text NOT NULL,
    file_id text NOT NULL,
    object_type text NOT NULL,
    object_id uuid NOT NULL,
    linked_by uuid,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attachment_links_object_type_check CHECK ((object_type = ANY (ARRAY['crm_contact'::text, 'booking'::text, 'event_type'::text, 'product'::text, 'stk_item'::text, 'fin_invoice'::text, 'stk_entry'::text, 'pos_ticket'::text])))
);

ALTER TABLE ONLY public.attachment_links FORCE ROW LEVEL SECURITY;



CREATE TABLE public.attachment_trash (
    org_id text NOT NULL,
    file_id text NOT NULL,
    object_type text NOT NULL,
    object_id uuid NOT NULL,
    linked_by uuid,
    linked_at timestamp with time zone NOT NULL,
    hidden_by uuid,
    hidden_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attachment_trash_object_type_check CHECK ((object_type = ANY (ARRAY['crm_contact'::text, 'booking'::text, 'event_type'::text, 'product'::text, 'stk_item'::text, 'fin_invoice'::text, 'stk_entry'::text, 'pos_ticket'::text])))
);

ALTER TABLE ONLY public.attachment_trash FORCE ROW LEVEL SECURITY;



CREATE TABLE public.backup_configs (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    backup_host text,
    backup_user text DEFAULT 'root'::text,
    backup_port integer DEFAULT 22,
    backup_base_path text DEFAULT '/mnt/agent-data/backups'::text,
    schedule text,
    retention_count integer DEFAULT 7,
    enabled boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.backup_configs FORCE ROW LEVEL SECURITY;



CREATE TABLE public.bg_jobs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text,
    type text NOT NULL,
    ref_id text,
    status text DEFAULT 'queued'::text NOT NULL,
    cursor text,
    error text,
    attempts integer DEFAULT 0 NOT NULL,
    lease_until bigint,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    started_at bigint,
    finished_at bigint,
    lease_generation integer DEFAULT 0 NOT NULL,
    CONSTRAINT bg_jobs_lease_generation_nonnegative CHECK ((lease_generation >= 0))
);



CREATE TABLE public.brain_access (
    brain_id uuid NOT NULL,
    org_id text NOT NULL,
    principal_type text NOT NULL,
    principal_id text NOT NULL,
    level text DEFAULT 'read'::text NOT NULL
);

ALTER TABLE ONLY public.brain_access FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.brain_access IS 'Per-brain access grants (role/user/agent principal, read/write level) for visibility=private brains.';



CREATE TABLE public.brain_agent_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    name_prefix text DEFAULT 'Brain'::text NOT NULL,
    emoji text,
    model text,
    instructions text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.brain_agent_templates FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.brain_agent_templates IS 'Org-level template (one row per org) for provisioning/reconfiguring every brain''s managing gateway agent (P4.1 AI-Brains).';



CREATE TABLE public.brain_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brain_id uuid NOT NULL,
    document_id uuid NOT NULL,
    org_id text NOT NULL,
    seq integer NOT NULL,
    chunk_text text NOT NULL,
    embedding public.vector(1536),
    meta jsonb
);

ALTER TABLE ONLY public.brain_chunks FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.brain_chunks IS 'Chunked + embedded (1536-dim, text-embedding-3-small) document text — the vector search corpus for one brain.';



CREATE TABLE public.brain_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brain_id uuid NOT NULL,
    org_id text NOT NULL,
    title text NOT NULL,
    source_type text NOT NULL,
    source_ref text,
    content_md text,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.brain_documents FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.brain_documents IS 'Source documents (note/url/upload/module_ref) ingested into a brain. status tracks the bg-runtime brain_ingest job.';



CREATE TABLE public.brain_enrichment_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    harness text NOT NULL,
    adapter_id text,
    profile text,
    distillation_model_provider text NOT NULL,
    distillation_model_id text NOT NULL,
    distillation_input_usd_per_million numeric(12,6),
    distillation_output_usd_per_million numeric(12,6),
    reranking_model_provider text,
    reranking_model_id text,
    reranking_input_usd_per_million numeric(12,6),
    reranking_output_usd_per_million numeric(12,6),
    daily_token_budget integer DEFAULT 250000 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT brain_enrichment_custom_adapter_check CHECK (((harness = 'custom'::text) = (adapter_id IS NOT NULL))),
    CONSTRAINT brain_enrichment_daily_token_budget_check CHECK (((daily_token_budget >= 10000) AND (daily_token_budget <= 5000000))),
    CONSTRAINT brain_enrichment_distillation_compatibility_check CHECK ((((harness = ANY (ARRAY['drone'::text, 'pi'::text])) AND (distillation_model_provider = ANY (ARRAY['harness'::text, 'openrouter'::text]))) OR ((harness = 'claude-code'::text) AND (distillation_model_provider = ANY (ARRAY['harness'::text, 'anthropic'::text]))) OR ((harness = 'codex'::text) AND (distillation_model_provider = ANY (ARRAY['harness'::text, 'openai'::text, 'openrouter'::text]))) OR ((harness = 'custom'::text) AND (distillation_model_provider = 'openrouter'::text)))),
    CONSTRAINT brain_enrichment_distillation_price_ceiling_check CHECK ((((distillation_input_usd_per_million IS NULL) AND (distillation_output_usd_per_million IS NULL)) OR (((distillation_input_usd_per_million >= (0)::numeric) AND (distillation_input_usd_per_million <= (5)::numeric)) AND ((distillation_output_usd_per_million >= (0)::numeric) AND (distillation_output_usd_per_million <= (20)::numeric))))),
    CONSTRAINT brain_enrichment_distillation_price_pair_check CHECK (((distillation_input_usd_per_million IS NULL) = (distillation_output_usd_per_million IS NULL))),
    CONSTRAINT brain_enrichment_distillation_price_source_check CHECK (((distillation_model_provider = 'harness'::text) = (distillation_input_usd_per_million IS NULL))),
    CONSTRAINT brain_enrichment_harness_check CHECK ((harness = ANY (ARRAY['drone'::text, 'claude-code'::text, 'codex'::text, 'pi'::text, 'custom'::text]))),
    CONSTRAINT brain_enrichment_model_id_nonempty_check CHECK ((length(btrim(distillation_model_id)) > 0)),
    CONSTRAINT brain_enrichment_model_provider_check CHECK ((distillation_model_provider = ANY (ARRAY['harness'::text, 'openrouter'::text, 'anthropic'::text, 'openai'::text]))),
    CONSTRAINT brain_enrichment_reranking_compatibility_check CHECK (((reranking_model_provider IS NULL) OR ((harness = ANY (ARRAY['drone'::text, 'pi'::text])) AND (reranking_model_provider = ANY (ARRAY['harness'::text, 'openrouter'::text]))) OR ((harness = 'claude-code'::text) AND (reranking_model_provider = ANY (ARRAY['harness'::text, 'anthropic'::text]))) OR ((harness = 'codex'::text) AND (reranking_model_provider = ANY (ARRAY['harness'::text, 'openai'::text, 'openrouter'::text]))) OR ((harness = 'custom'::text) AND (reranking_model_provider = 'openrouter'::text)))),
    CONSTRAINT brain_enrichment_reranking_pair_check CHECK (((reranking_model_provider IS NULL) = (reranking_model_id IS NULL))),
    CONSTRAINT brain_enrichment_reranking_price_ceiling_check CHECK ((((reranking_input_usd_per_million IS NULL) AND (reranking_output_usd_per_million IS NULL)) OR (((reranking_input_usd_per_million >= (0)::numeric) AND (reranking_input_usd_per_million <= (5)::numeric)) AND ((reranking_output_usd_per_million >= (0)::numeric) AND (reranking_output_usd_per_million <= (20)::numeric))))),
    CONSTRAINT brain_enrichment_reranking_price_pair_check CHECK ((((reranking_model_provider IS NULL) AND (reranking_input_usd_per_million IS NULL) AND (reranking_output_usd_per_million IS NULL)) OR ((reranking_model_provider IS NOT NULL) AND ((reranking_input_usd_per_million IS NULL) = (reranking_output_usd_per_million IS NULL))))),
    CONSTRAINT brain_enrichment_reranking_price_source_check CHECK (((reranking_model_provider IS NULL) OR ((reranking_model_provider = 'harness'::text) = (reranking_input_usd_per_million IS NULL)))),
    CONSTRAINT brain_enrichment_reranking_provider_check CHECK (((reranking_model_provider IS NULL) OR (reranking_model_provider = ANY (ARRAY['harness'::text, 'openrouter'::text, 'anthropic'::text, 'openai'::text]))))
);

ALTER TABLE ONLY public.brain_enrichment_settings FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.brain_enrichment_settings IS 'Org-scoped, non-secret small-model and harness configuration consumed by Brain enrichment jobs.';



CREATE TABLE public.brain_sources (
    brain_id uuid NOT NULL,
    org_id text NOT NULL,
    source_id uuid NOT NULL,
    weight real DEFAULT 1 NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT brain_sources_weight_check CHECK ((weight > (0)::double precision))
);

ALTER TABLE ONLY public.brain_sources FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.brain_sources IS 'Focused-brain source membership; Master Brain membership is implicit.';



CREATE TABLE public.brain_vector_generations (
    generation text NOT NULL,
    embedding_model text NOT NULL,
    dimensions integer NOT NULL,
    enqueue_enabled boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    storage_mode text DEFAULT 'pgvector'::text NOT NULL,
    CONSTRAINT brain_vector_generations_dimensions_check CHECK ((dimensions > 0)),
    CONSTRAINT brain_vector_generations_name_check CHECK ((generation ~ '^[a-z0-9_]{1,64}$'::text)),
    CONSTRAINT brain_vector_generations_storage_mode_check CHECK ((storage_mode = ANY (ARRAY['pgvector'::text, 'qdrant'::text])))
);

ALTER TABLE ONLY public.brain_vector_generations FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.brain_vector_generations IS 'Vector generation control. enqueue_enabled defaults false so infrastructure migrations are inert.';



CREATE TABLE public.brain_vector_outbox (
    chunk_id uuid NOT NULL,
    org_id text NOT NULL,
    collection_generation text NOT NULL,
    desired_operation text NOT NULL,
    desired_content_hash text,
    revision bigint DEFAULT 1 NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_owner text,
    lease_until timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT brain_vector_outbox_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT brain_vector_outbox_operation_check CHECK ((desired_operation = ANY (ARRAY['upsert'::text, 'delete'::text]))),
    CONSTRAINT brain_vector_outbox_revision_check CHECK ((revision > 0)),
    CONSTRAINT brain_vector_outbox_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'dead'::text])))
);

ALTER TABLE ONLY public.brain_vector_outbox FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.brain_vector_outbox IS 'Latest desired Qdrant serving-index state. Empty is not proof of canonical/index parity.';



CREATE TABLE public.brain_vector_reconcile_state (
    collection_generation text NOT NULL,
    after_chunk_id uuid,
    cycle_started_at timestamp with time zone,
    last_completed_at timestamp with time zone,
    scanned bigint DEFAULT 0 NOT NULL,
    repaired bigint DEFAULT 0 NOT NULL,
    orphaned bigint DEFAULT 0 NOT NULL,
    failed bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    qdrant_after_offset jsonb
);

ALTER TABLE ONLY public.brain_vector_reconcile_state FORCE ROW LEVEL SECURITY;



CREATE TABLE public.brains (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    visibility text DEFAULT 'org'::text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_id text,
    kind text DEFAULT 'focused'::text NOT NULL,
    include_all_sources boolean DEFAULT false NOT NULL,
    CONSTRAINT brains_kind_check CHECK ((kind = ANY (ARRAY['master'::text, 'focused'::text]))),
    CONSTRAINT brains_master_scope_check CHECK (((kind = 'master'::text) = include_all_sources))
);

ALTER TABLE ONLY public.brains FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.brains IS 'Org-scoped knowledge base (P4 AI-Brains). RLS via app_ledger + app.current_org_id GUC (withOrgCore).';



COMMENT ON COLUMN public.brains.agent_id IS 'Gateway agentId (pattern brain-<brainUuid>) of this brain''s managing agent, or null if agent management is disabled for this brain.';



CREATE TABLE public.built_agent_skills (
    id text NOT NULL,
    agent_id text NOT NULL,
    skill_id text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    config_overrides text DEFAULT '{}'::text
);

ALTER TABLE ONLY public.built_agent_skills FORCE ROW LEVEL SECURITY;



CREATE TABLE public.built_agents (
    id text NOT NULL,
    name text NOT NULL,
    emoji text DEFAULT '🤖'::text,
    description text DEFAULT ''::text,
    model text,
    system_prompt text DEFAULT ''::text,
    temperature real DEFAULT 0.7,
    max_tokens integer DEFAULT 4096,
    retry_policy text DEFAULT '{}'::text,
    fallback_agent_id text,
    status text DEFAULT 'draft'::text NOT NULL,
    gateway_id uuid,
    tenant_id uuid NOT NULL,
    created_by text,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    runtime_agent_id text
);

ALTER TABLE ONLY public.built_agents FORCE ROW LEVEL SECURITY;



CREATE TABLE public.built_chapter_edges (
    id text NOT NULL,
    skill_id text NOT NULL,
    source_chapter_id text NOT NULL,
    target_chapter_id text NOT NULL,
    label text
);

ALTER TABLE ONLY public.built_chapter_edges FORCE ROW LEVEL SECURITY;



CREATE TABLE public.built_chapter_tools (
    id text NOT NULL,
    chapter_id text NOT NULL,
    tool_id text NOT NULL
);

ALTER TABLE ONLY public.built_chapter_tools FORCE ROW LEVEL SECURITY;



CREATE TABLE public.built_chapters (
    id text NOT NULL,
    skill_id text NOT NULL,
    type text DEFAULT 'chapter'::text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    guide text DEFAULT ''::text,
    context text DEFAULT ''::text,
    output_def text DEFAULT ''::text,
    condition_text text DEFAULT ''::text,
    position_x real DEFAULT 0 NOT NULL,
    position_y real DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.built_chapters FORCE ROW LEVEL SECURITY;



CREATE TABLE public.built_skill_tools (
    id text NOT NULL,
    skill_id text NOT NULL,
    tool_id text NOT NULL
);

ALTER TABLE ONLY public.built_skill_tools FORCE ROW LEVEL SECURITY;



CREATE TABLE public.built_skills (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    emoji text DEFAULT '📖'::text,
    status text DEFAULT 'draft'::text NOT NULL,
    max_cycles integer DEFAULT 3 NOT NULL,
    gateway_id uuid,
    tenant_id uuid,
    created_by text,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.built_skills FORCE ROW LEVEL SECURITY;



CREATE TABLE public.built_tools (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    script_code text DEFAULT ''::text,
    script_lang text DEFAULT 'javascript'::text NOT NULL,
    env_vars text DEFAULT '{}'::text,
    validation_rules text DEFAULT '{}'::text,
    execution_config text DEFAULT '{}'::text,
    status text DEFAULT 'draft'::text NOT NULL,
    gateway_id uuid,
    tenant_id uuid,
    created_by text,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.built_tools FORCE ROW LEVEL SECURITY;



CREATE TABLE public.channel_assignments (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    channel_id text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.channel_assignments FORCE ROW LEVEL SECURITY;



CREATE TABLE public.channel_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    channel_id text NOT NULL,
    match_kind text NOT NULL,
    match_peer text,
    agent_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channel_bindings_match_kind_check CHECK ((match_kind = ANY (ARRAY['catchall'::text, 'dm_peer'::text, 'group'::text])))
);

ALTER TABLE ONLY public.channel_bindings FORCE ROW LEVEL SECURITY;



CREATE TABLE public.channel_identities (
    id text NOT NULL,
    user_id uuid NOT NULL,
    channel text NOT NULL,
    channel_user_id text NOT NULL,
    display_name text,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.channel_pairing_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    channel_type text NOT NULL,
    account_id text NOT NULL,
    sender_id text NOT NULL,
    code_hash text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.channel_pairing_requests FORCE ROW LEVEL SECURITY;



CREATE TABLE public.channels (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    type text NOT NULL,
    label text NOT NULL,
    credentials text DEFAULT ''::text NOT NULL,
    credentials_iv text DEFAULT ''::text NOT NULL,
    credentials_meta text DEFAULT '{}'::text NOT NULL,
    status text DEFAULT 'inactive'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    replies text DEFAULT 'none'::text NOT NULL,
    allow_from text[] DEFAULT '{}'::text[] NOT NULL,
    group_allow_from text[] DEFAULT '{}'::text[] NOT NULL,
    require_mention boolean DEFAULT true NOT NULL,
    reconnect_count integer DEFAULT 0 NOT NULL,
    last_seen_at timestamp with time zone,
    last_error text,
    account_id text,
    auth_ref text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    owner_profile_id uuid,
    CONSTRAINT channels_replies_chk CHECK ((replies = ANY (ARRAY['none'::text, 'bound'::text])))
);

ALTER TABLE ONLY public.channels FORCE ROW LEVEL SECURITY;



COMMENT ON COLUMN public.channels.owner_profile_id IS 'Set => account is USER-scoped (follows this person across orgs). Null => ORG-scoped via tenant_id.';



CREATE TABLE public.chat_messages (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    agent_id text NOT NULL,
    session_key text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    run_id text,
    "timestamp" timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.chat_messages FORCE ROW LEVEL SECURITY;



CREATE SEQUENCE public.chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;



CREATE TABLE public.config_snapshots (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    config_json text NOT NULL,
    config_hash text NOT NULL,
    fetched_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.config_snapshots FORCE ROW LEVEL SECURITY;



CREATE TABLE public.crm_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    contact_id uuid NOT NULL,
    kind text NOT NULL,
    body text,
    actor_id uuid,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_activities FORCE ROW LEVEL SECURITY;



CREATE TABLE public.crm_contact_activity_stats (
    contact_id uuid NOT NULL,
    org_id text NOT NULL,
    message_count bigint DEFAULT 0 NOT NULL,
    inbound_count bigint DEFAULT 0 NOT NULL,
    outbound_count bigint DEFAULT 0 NOT NULL,
    channels_used integer DEFAULT 0 NOT NULL,
    first_contact_at timestamp with time zone,
    last_contact_at timestamp with time zone,
    last_inbound_at timestamp with time zone,
    last_outbound_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_contact_activity_stats FORCE ROW LEVEL SECURITY;



CREATE TABLE public.crm_contact_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    contact_id uuid NOT NULL,
    channel text NOT NULL,
    external_id text NOT NULL,
    handle text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_contact_identities FORCE ROW LEVEL SECURITY;



CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id text NOT NULL,
    org_id text NOT NULL,
    gateway_id text,
    direction text NOT NULL,
    channel text NOT NULL,
    account_id text,
    chat_id text,
    is_group boolean,
    sender_id text,
    sender_name text,
    sender_handle text,
    is_bot boolean,
    content text,
    message_id text,
    agent_id text,
    session_key text,
    success boolean,
    error text,
    occurred_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
)
WITH (autovacuum_vacuum_insert_threshold='5000', autovacuum_vacuum_insert_scale_factor='0.0', autovacuum_vacuum_scale_factor='0.02', autovacuum_analyze_scale_factor='0.02');

ALTER TABLE ONLY public.messages FORCE ROW LEVEL SECURITY;



CREATE VIEW public.crm_contact_stats WITH (security_invoker='true') AS
 SELECT ci.contact_id,
    ci.org_id,
    count(*) AS message_count,
    count(*) FILTER (WHERE (m.direction = 'inbound'::text)) AS inbound_count,
    count(*) FILTER (WHERE (m.direction = 'outbound'::text)) AS outbound_count,
    count(DISTINCT m.channel) AS channels_used,
    min(COALESCE(m.occurred_at, m.created_at)) AS first_contact_at,
    max(COALESCE(m.occurred_at, m.created_at)) AS last_contact_at
   FROM (public.crm_contact_identities ci
     JOIN public.messages m ON (((m.org_id = ci.org_id) AND (m.channel = ci.channel) AND (m.chat_id = ci.external_id))))
  WHERE (m.is_bot IS NOT TRUE)
  GROUP BY ci.contact_id, ci.org_id;



CREATE TABLE public.crm_contact_tags (
    org_id text NOT NULL,
    contact_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    applied_by uuid,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_contact_tags FORCE ROW LEVEL SECURITY;



CREATE VIEW public.crm_contact_timeline WITH (security_invoker='on') AS
 SELECT ci.contact_id,
    m.org_id,
    'message'::text AS kind,
    m.direction,
    m.channel,
    m.content AS body,
    m.agent_id,
    m.metadata AS data,
    COALESCE(m.occurred_at, m.created_at) AS occurred_at,
    m.id AS source_id,
    m.client_id
   FROM (public.messages m
     JOIN public.crm_contact_identities ci ON (((ci.org_id = m.org_id) AND (ci.channel = m.channel) AND (ci.external_id = m.chat_id))))
UNION ALL
 SELECT a.contact_id,
    a.org_id,
    a.kind,
    NULL::text AS direction,
    NULL::text AS channel,
    a.body,
    NULL::text AS agent_id,
    a.data,
    a.occurred_at,
    a.id AS source_id,
    NULL::text AS client_id
   FROM public.crm_activities a;



CREATE TABLE public.crm_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    display_name text,
    profile_id uuid,
    owner_id uuid,
    lifecycle_override text,
    source text DEFAULT 'harvested'::text NOT NULL,
    custom_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    party_id uuid,
    human_id text
);

ALTER TABLE ONLY public.crm_contacts FORCE ROW LEVEL SECURITY;



CREATE TABLE public.crm_conversation_analysis (
    org_id text NOT NULL,
    channel text NOT NULL,
    chat_id text NOT NULL,
    contact_id uuid,
    primary_intent text,
    pain_points jsonb DEFAULT '[]'::jsonb NOT NULL,
    asked_for text,
    answered_summary text,
    over_answered boolean,
    over_answered_reason text,
    msg_count integer DEFAULT 0 NOT NULL,
    first_at timestamp with time zone,
    last_at timestamp with time zone,
    analyzed_at timestamp with time zone DEFAULT now() NOT NULL,
    model text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.crm_conversation_analysis FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.crm_conversation_analysis IS 'Per-conversation structured LLM extraction (intent, pain_points, over_answered) for CRM Conversation Intelligence census questions. RLS via app_ledger + app.current_org_id GUC (withOrgCore).';



CREATE TABLE public.crm_conversation_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    channel text NOT NULL,
    chat_id text NOT NULL,
    contact_id uuid,
    party_id uuid,
    chunk_index integer DEFAULT 0 NOT NULL,
    content text NOT NULL,
    embedding public.vector(1536),
    msg_count integer DEFAULT 0 NOT NULL,
    first_at timestamp with time zone,
    last_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.crm_conversation_chunks FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.crm_conversation_chunks IS 'Semantic retrieval corpus for CRM Conversation Intelligence: role-tagged, chunked (~1500 tok), embedded (1536-dim) 1:1 conversation text. RLS via app_ledger + app.current_org_id GUC (withOrgCore). Exact cosine retrieval remains available; the optional IVFFlat accelerator is disabled by the storage guard migration.';



CREATE TABLE public.crm_conversation_index (
    org_id text NOT NULL,
    channel text NOT NULL,
    chat_id text NOT NULL,
    contact_id uuid,
    party_id uuid,
    eligible_count integer DEFAULT 0 NOT NULL,
    last_occurred_at timestamp with time zone,
    last_ingested_at timestamp with time zone,
    content_sig text,
    chunk_count integer DEFAULT 0 NOT NULL,
    vectorized_at timestamp with time zone,
    analyzed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_conversation_index FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.crm_conversation_index IS 'Signature store for incremental/idempotent CRM conversation vectorize+analyze ticks (spec §6). RLS via app_ledger + app.current_org_id GUC (withOrgCore).';



CREATE TABLE public.crm_message_sentiment (
    org_id text NOT NULL,
    message_id uuid NOT NULL,
    score double precision NOT NULL,
    label text NOT NULL,
    model text,
    analyzed_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_message_sentiment FORCE ROW LEVEL SECURITY;



CREATE TABLE public.crm_sentiment_chat_daily (
    org_id text NOT NULL,
    chat_id text NOT NULL,
    day date NOT NULL,
    score double precision NOT NULL,
    message_count integer NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_sentiment_chat_daily_message_count_check CHECK ((message_count >= 0))
);

ALTER TABLE ONLY public.crm_sentiment_chat_daily FORCE ROW LEVEL SECURITY;



CREATE TABLE public.crm_settings (
    org_id text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_settings FORCE ROW LEVEL SECURITY;



CREATE TABLE public.crm_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    name text NOT NULL,
    color text,
    kind text DEFAULT 'manual'::text NOT NULL,
    rule jsonb,
    "position" double precision DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_tags FORCE ROW LEVEL SECURITY;



CREATE TABLE public.crm_win_embeddings (
    org_id text NOT NULL,
    contact_id uuid NOT NULL,
    embedding public.vector(1536),
    msg_count integer DEFAULT 0 NOT NULL,
    bought text[] DEFAULT '{}'::text[] NOT NULL,
    snippet text,
    built_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_win_embeddings FORCE ROW LEVEL SECURITY;



CREATE TABLE public.crm_word_frequency_daily (
    org_id text NOT NULL,
    day date NOT NULL,
    word text NOT NULL,
    document_count bigint NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_word_frequency_daily_document_count_check CHECK ((document_count >= 0))
);

ALTER TABLE ONLY public.crm_word_frequency_daily FORCE ROW LEVEL SECURITY;



CREATE TABLE public.dashboard_layouts (
    org_id text NOT NULL,
    dashboard_id text NOT NULL,
    layout jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.dashboard_layouts FORCE ROW LEVEL SECURITY;



CREATE TABLE public.device_identities (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    device_id text NOT NULL,
    public_key_pem text NOT NULL,
    private_key_pem text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.device_identities FORCE ROW LEVEL SECURITY;



CREATE TABLE public.doc_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    ref_type text NOT NULL,
    ref_id uuid NOT NULL,
    actor_id uuid,
    actor_name text,
    op text DEFAULT 'update'::text NOT NULL,
    changes jsonb DEFAULT '[]'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.doc_audit_log FORCE ROW LEVEL SECURITY;



CREATE TABLE public.doc_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    ref_type text NOT NULL,
    ref_id uuid NOT NULL,
    kind text DEFAULT 'comment'::text NOT NULL,
    body text,
    actor_id uuid,
    actor_name text,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.doc_comments FORCE ROW LEVEL SECURITY;



CREATE TABLE public.email_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    user_id text,
    mailbox text NOT NULL,
    gmail_message_id text NOT NULL,
    from_domain text,
    subject text,
    summary text,
    labels text[] DEFAULT '{}'::text[] NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);



CREATE TABLE public.email_ledger_settings (
    org_id text NOT NULL,
    retention_days integer DEFAULT 180 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.email_opens (
    user_id text NOT NULL,
    gmail_message_id text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.files (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    uploaded_by uuid,
    b2_file_key text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.files FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    provider text NOT NULL,
    provider_ref text NOT NULL,
    name text,
    doc_type text,
    doc_number text,
    email text,
    phone text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    party_id uuid
);

ALTER TABLE ONLY public.fin_clients FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_dni_placeholder_null_bak (
    src text,
    ref uuid,
    val text
);



CREATE TABLE public.fin_dni_reassign_bak_cli (
    id uuid,
    org_id text,
    provider text,
    provider_ref text,
    name text,
    doc_type text,
    doc_number text,
    email text,
    phone text,
    metadata jsonb,
    party_id uuid
);



CREATE TABLE public.fin_dni_reassign_bak_inv (
    id uuid,
    org_id text,
    provider text,
    provider_ref text,
    number text,
    document_id text,
    issued_at timestamp with time zone,
    client_name text,
    client_doc_type text,
    client_doc_number text,
    client_email text,
    currency text,
    subtotal numeric,
    tax numeric,
    discount numeric,
    total numeric,
    status text,
    seller text,
    note text,
    metadata jsonb,
    synced_at timestamp with time zone,
    created_at timestamp with time zone,
    client_id uuid
);



CREATE TABLE public.fin_invoice_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    invoice_id uuid NOT NULL,
    code text,
    description text,
    category text,
    quantity numeric,
    unit_price numeric,
    discount numeric,
    tax numeric,
    total numeric,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    product_id uuid
);

ALTER TABLE ONLY public.fin_invoice_items FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    provider text NOT NULL,
    provider_ref text NOT NULL,
    number text,
    document_id text,
    issued_at timestamp with time zone,
    client_name text,
    client_doc_type text,
    client_doc_number text,
    client_email text,
    currency text DEFAULT 'PEN'::text,
    subtotal numeric,
    tax numeric,
    discount numeric,
    total numeric,
    status text,
    seller text,
    note text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid,
    shadowed boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.fin_invoices FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    invoice_id uuid NOT NULL,
    provider_ref text,
    method text,
    paid_at timestamp with time zone,
    amount numeric,
    status text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.fin_payments FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_payments_method_bak_20260814 (
    id uuid,
    old_method text,
    bpm integer
);



CREATE TABLE public.fin_product_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    bundle_product_id uuid NOT NULL,
    child_product_id uuid NOT NULL,
    qty numeric DEFAULT 1 NOT NULL,
    line_no integer DEFAULT 0 NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fin_product_components_no_self CHECK ((bundle_product_id <> child_product_id)),
    CONSTRAINT fin_product_components_qty_pos CHECK ((qty > (0)::numeric))
);

ALTER TABLE ONLY public.fin_product_components FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    category text,
    unit_price numeric,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sku uuid DEFAULT gen_random_uuid() NOT NULL
);

ALTER TABLE ONLY public.fin_products FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_products_bak_insumos2608 (
    id uuid,
    org_id text,
    code text,
    name text,
    category text,
    unit_price numeric,
    active boolean,
    metadata jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    sku uuid
);



CREATE TABLE public.fin_purchase_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    period text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    doc_count integer DEFAULT 0 NOT NULL,
    base_gravada numeric,
    igv numeric,
    total numeric,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fin_purchase_periods FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    source text NOT NULL,
    provider_ref text,
    period text NOT NULL,
    supplier_ruc text,
    supplier_name text,
    doc_type text,
    serie text,
    numero text,
    issued_at date,
    currency text,
    base_gravada numeric,
    igv numeric,
    total numeric,
    period_status text DEFAULT 'open'::text NOT NULL,
    sync_state text DEFAULT 'local'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fin_purchases FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_settings (
    org_id text NOT NULL,
    currency text DEFAULT 'PEN'::text NOT NULL,
    tax_rate numeric DEFAULT 0.18 NOT NULL,
    fx_base text DEFAULT 'USD'::text NOT NULL,
    fx_quote text DEFAULT 'PEN'::text NOT NULL,
    fx_mode text DEFAULT 'auto'::text NOT NULL,
    fx_manual_rate numeric,
    fx_auto_rate numeric,
    fx_source text,
    fx_updated_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    timezone text DEFAULT 'America/Lima'::text NOT NULL
);



CREATE TABLE public.fin_sources (
    org_id text NOT NULL,
    provider text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    secret_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    watermark text,
    last_sync_at timestamp with time zone,
    last_status text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_probe_at timestamp with time zone,
    last_probe_status text,
    last_probe_message text
);

ALTER TABLE ONLY public.fin_sources FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_statement_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    file_id text,
    source_kind text NOT NULL,
    content_sha256 text NOT NULL,
    parser_version integer NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    next_chunk integer DEFAULT 0 NOT NULL,
    row_count integer,
    inserted_count integer,
    rejected_count integer,
    error_code text,
    error_message text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);

ALTER TABLE ONLY public.fin_statement_imports FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_sync_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    provider text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    total integer,
    processed integer DEFAULT 0 NOT NULL,
    page_cursor text,
    error text,
    cancel_requested boolean DEFAULT false NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fin_sync_jobs FORCE ROW LEVEL SECURITY;



CREATE TABLE public.fin_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    import_id uuid NOT NULL,
    source_row integer NOT NULL,
    posted_on date NOT NULL,
    description text NOT NULL,
    signed_amount numeric(18,2) NOT NULL,
    currency text,
    counterparty text,
    category text,
    reference text,
    party_id uuid,
    confidence numeric,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fin_transactions FORCE ROW LEVEL SECURITY;



CREATE TABLE public.flow_groups (
    id text NOT NULL,
    name text NOT NULL,
    user_id text,
    tenant_id text,
    plugin_id text,
    disabled boolean DEFAULT false NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL
);

ALTER TABLE ONLY public.flow_groups FORCE ROW LEVEL SECURITY;



CREATE TABLE public.flow_groups_backup_20260604 (
    id text,
    name text,
    user_id text,
    tenant_id text,
    plugin_id text,
    disabled boolean,
    created_at bigint,
    updated_at bigint
);



CREATE TABLE public.flow_runs (
    id text NOT NULL,
    flow_id text NOT NULL,
    user_id text,
    tenant_id text,
    started_at bigint NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    source text DEFAULT 'test'::text NOT NULL,
    events text DEFAULT '[]'::text NOT NULL,
    created_at bigint NOT NULL
);

ALTER TABLE ONLY public.flow_runs FORCE ROW LEVEL SECURITY;



CREATE TABLE public.flow_var_exports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    flow_id text NOT NULL,
    var_key text NOT NULL,
    enabled boolean NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.flow_var_exports FORCE ROW LEVEL SECURITY;



CREATE TABLE public.flows (
    id text NOT NULL,
    name text NOT NULL,
    nodes text DEFAULT '[]'::text NOT NULL,
    edges text DEFAULT '[]'::text NOT NULL,
    user_id text,
    tenant_id text,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    active boolean DEFAULT false NOT NULL,
    config text DEFAULT '{}'::text NOT NULL,
    group_id text
);

ALTER TABLE ONLY public.flows FORCE ROW LEVEL SECURITY;



CREATE TABLE public.flows_backup_20260604 (
    id text,
    name text,
    nodes text,
    edges text,
    user_id text,
    tenant_id text,
    created_at bigint,
    updated_at bigint,
    active boolean,
    config text,
    group_id text
);



CREATE TABLE public.flows_backup_20260605_triage (
    id text,
    name text,
    nodes text,
    edges text,
    user_id text,
    tenant_id text,
    created_at bigint,
    updated_at bigint,
    active boolean,
    config text,
    group_id text
);



CREATE TABLE public.gateway (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_server_id text,
    name text NOT NULL,
    url text NOT NULL,
    token_ciphertext text DEFAULT ''::text NOT NULL,
    token_iv text DEFAULT ''::text NOT NULL,
    auth_mode text DEFAULT 'token'::text NOT NULL,
    last_connected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid,
    channel text DEFAULT 'prd'::text NOT NULL,
    CONSTRAINT gateway_channel_valid CHECK ((channel = ANY (ARRAY['dev'::text, 'prd'::text])))
);



COMMENT ON COLUMN public.gateway.channel IS 'Build channel this gateway row serves: dev (protopi) | prd (netcup). An org may only select a channel it has a row for — enforced server-side, not in the UI.';



CREATE TABLE public.gateway_lease (
    org_id uuid NOT NULL,
    channel text NOT NULL,
    gateway_id uuid NOT NULL,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_healthy_at timestamp with time zone,
    CONSTRAINT gateway_lease_channel_valid CHECK ((channel = ANY (ARRAY['dev'::text, 'prd'::text])))
);



COMMENT ON TABLE public.gateway_lease IS 'Health-aware assignment lease. A human picks the CHANNEL; this table picks the INSTANCE, and every protocol (HTTP/RPC/WS) follows it. Failover flips the lease but does NOT move channel state (WhatsApp/Baileys sessions stay on the old host).';



CREATE TABLE public.gateway_signing_keys (
    kid text NOT NULL,
    alg text DEFAULT 'EdDSA'::text NOT NULL,
    public_jwk jsonb NOT NULL,
    private_ciphertext text NOT NULL,
    private_iv text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.gateway_signing_keys FORCE ROW LEVEL SECURITY;



CREATE TABLE public.hr_employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    profile_id uuid,
    party_id uuid,
    resource_id uuid,
    name text NOT NULL,
    email text,
    designation text,
    status text DEFAULT 'active'::text NOT NULL,
    joined_on date,
    left_on date,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    department text,
    employment_type text
);

ALTER TABLE ONLY public.hr_employees FORCE ROW LEVEL SECURITY;



CREATE TABLE public.hr_holidays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    date date NOT NULL,
    name text NOT NULL,
    weekly_off boolean DEFAULT false NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    source_key text,
    enabled boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.hr_holidays FORCE ROW LEVEL SECURITY;



CREATE TABLE public.hr_leave_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    employee_id uuid NOT NULL,
    leave_type_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    days numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hr_leave_allocations FORCE ROW LEVEL SECURITY;



CREATE TABLE public.hr_leave_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    employee_id uuid NOT NULL,
    leave_type_id uuid NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    half_day boolean DEFAULT false NOT NULL,
    days numeric NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hr_leave_requests FORCE ROW LEVEL SECURITY;



CREATE TABLE public.hr_leave_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    paid boolean DEFAULT true NOT NULL,
    allow_negative boolean DEFAULT false NOT NULL,
    include_holiday boolean DEFAULT false NOT NULL,
    max_days_per_request integer,
    active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.hr_leave_types FORCE ROW LEVEL SECURITY;



CREATE TABLE public.hr_settings (
    org_id text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hr_settings FORCE ROW LEVEL SECURITY;



CREATE TABLE public.hub_migrations (
    version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.identity_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identity_id uuid NOT NULL,
    subscriber_profile_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.job_effect_batches (
    id text NOT NULL,
    tenant_id text NOT NULL,
    reservation_job_id text NOT NULL,
    reservation_generation integer NOT NULL,
    dispatch_job_id text,
    dispatch_generation integer,
    descriptor jsonb NOT NULL,
    unit_ids jsonb NOT NULL,
    membership_hash text NOT NULL,
    count integer NOT NULL,
    state text DEFAULT 'reserved'::text NOT NULL,
    result jsonb,
    abandonment_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_effect_batches_descriptor CHECK (public.job_effect_batch_descriptor_valid(descriptor, unit_ids, count)),
    CONSTRAINT job_effect_batches_identity CHECK (((id ~ '^[a-f0-9]{64}$'::text) AND ((length(tenant_id) >= 1) AND (length(tenant_id) <= 256)) AND ((length(reservation_job_id) >= 1) AND (length(reservation_job_id) <= 256)) AND (reservation_generation >= 0) AND (membership_hash ~ '^[a-f0-9]{64}$'::text) AND ((count >= 1) AND (count <= 64)))),
    CONSTRAINT job_effect_batches_shape CHECK ((((((state = ANY (ARRAY['reserved'::text, 'abandoned_unsent'::text])) AND (dispatch_job_id IS NULL) AND (dispatch_generation IS NULL) AND (result IS NULL)) OR ((state = ANY (ARRAY['admitted'::text, 'received'::text])) AND ((length(dispatch_job_id) >= 1) AND (length(dispatch_job_id) <= 256)) AND (dispatch_generation >= 0) AND (((state = 'admitted'::text) AND (result IS NULL)) OR ((state = 'received'::text) AND public.job_effect_vectors_valid(result, count))))) AND (((state = 'abandoned_unsent'::text) AND ((length(abandonment_reason) >= 1) AND (length(abandonment_reason) <= 160))) OR ((state <> 'abandoned_unsent'::text) AND (abandonment_reason IS NULL)))) IS TRUE))
);

ALTER TABLE ONLY public.job_effect_batches FORCE ROW LEVEL SECURITY;



CREATE TABLE public.job_effect_pages (
    id text NOT NULL,
    tenant_id text NOT NULL,
    job_id text NOT NULL,
    page_key text NOT NULL,
    manifest_hash text NOT NULL,
    descriptor jsonb NOT NULL,
    state text DEFAULT 'bound'::text NOT NULL,
    completion jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_effect_pages_identity CHECK (((id ~ '^[a-f0-9]{64}$'::text) AND ((length(tenant_id) >= 1) AND (length(tenant_id) <= 256)) AND ((length(job_id) >= 1) AND (length(job_id) <= 256)) AND ((length(page_key) >= 1) AND (length(page_key) <= 160)) AND (manifest_hash ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT job_effect_pages_shape CHECK ((((jsonb_typeof(descriptor) = 'object'::text) AND (octet_length((descriptor)::text) <= 262144) AND (((state = 'bound'::text) AND (completion IS NULL)) OR ((state = 'published'::text) AND (jsonb_typeof(completion) = 'object'::text)))) IS TRUE))
);

ALTER TABLE ONLY public.job_effect_pages FORCE ROW LEVEL SECURITY;



CREATE TABLE public.job_effect_units (
    id text NOT NULL,
    tenant_id text NOT NULL,
    head_id text NOT NULL,
    head_kind text DEFAULT 'head'::text NOT NULL,
    revision uuid NOT NULL,
    source_hash text NOT NULL,
    manifest_hash text NOT NULL,
    chunk_key text NOT NULL,
    payload_hash text NOT NULL,
    policy_hash text NOT NULL,
    batch_id text,
    vector_index integer,
    first_published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_effect_units_identity CHECK (((id ~ '^[a-f0-9]{64}$'::text) AND ((length(tenant_id) >= 1) AND (length(tenant_id) <= 256)) AND (head_kind = 'head'::text) AND (source_hash ~ '^[a-f0-9]{64}$'::text) AND (manifest_hash ~ '^[a-f0-9]{64}$'::text) AND (payload_hash ~ '^[a-f0-9]{64}$'::text) AND (policy_hash ~ '^[a-f0-9]{64}$'::text) AND ((length(chunk_key) >= 1) AND (length(chunk_key) <= 160)))),
    CONSTRAINT job_effect_units_placement CHECK (((((batch_id IS NULL) AND (vector_index IS NULL)) OR ((batch_id IS NOT NULL) AND ((vector_index >= 0) AND (vector_index <= 63)))) IS TRUE))
);

ALTER TABLE ONLY public.job_effect_units FORCE ROW LEVEL SECURITY;



CREATE TABLE public.job_effects (
    id text NOT NULL,
    tenant_id text NOT NULL,
    family text NOT NULL,
    entity_id text NOT NULL,
    kind text NOT NULL,
    revision uuid NOT NULL,
    unit text NOT NULL,
    source_hash text NOT NULL,
    state text NOT NULL,
    descriptor jsonb,
    result jsonb,
    legacy_job_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    manifest_hash text,
    CONSTRAINT job_effects_identity CHECK ((((length(tenant_id) >= 1) AND (length(tenant_id) <= 256)) AND ((length(family) >= 1) AND (length(family) <= 96)) AND ((length(entity_id) >= 1) AND (length(entity_id) <= 512)) AND (source_hash ~ '^[a-f0-9]{64}$'::text) AND (id ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT job_effects_manifest_shape CHECK (((manifest_hash IS NULL) OR ((kind = 'head'::text) AND (manifest_hash ~ '^[a-f0-9]{64}$'::text)))),
    CONSTRAINT job_effects_shape CHECK (((((kind = 'head'::text) AND (unit = ''::text) AND (state = ANY (ARRAY['active'::text, 'revoked'::text])) AND (descriptor IS NULL) AND (result IS NULL)) OR ((kind = 'effect'::text) AND ((length(unit) >= 1) AND (length(unit) <= 160)) AND (legacy_job_id IS NULL) AND (state = ANY (ARRAY['admitted'::text, 'received'::text, 'committed'::text])) AND (descriptor IS NOT NULL) AND (jsonb_typeof(descriptor) = 'object'::text) AND (descriptor ?& ARRAY['payloadHash'::text, 'endpoint'::text, 'model'::text, 'normalization'::text, 'count'::text, 'dimensions'::text, 'pipelineVersion'::text]) AND (jsonb_typeof((descriptor -> 'payloadHash'::text)) = 'string'::text) AND (jsonb_typeof((descriptor -> 'endpoint'::text)) = 'string'::text) AND (jsonb_typeof((descriptor -> 'model'::text)) = 'string'::text) AND (jsonb_typeof((descriptor -> 'normalization'::text)) = 'string'::text) AND (jsonb_typeof((descriptor -> 'pipelineVersion'::text)) = 'string'::text) AND (jsonb_typeof((descriptor -> 'count'::text)) = 'number'::text) AND (jsonb_typeof((descriptor -> 'dimensions'::text)) = 'number'::text) AND ((descriptor ->> 'payloadHash'::text) ~ '^[a-f0-9]{64}$'::text) AND ((length((descriptor ->> 'endpoint'::text)) >= 1) AND (length((descriptor ->> 'endpoint'::text)) <= 512)) AND ((length((descriptor ->> 'model'::text)) >= 1) AND (length((descriptor ->> 'model'::text)) <= 128)) AND ((length((descriptor ->> 'normalization'::text)) >= 1) AND (length((descriptor ->> 'normalization'::text)) <= 128)) AND ((length((descriptor ->> 'pipelineVersion'::text)) >= 1) AND (length((descriptor ->> 'pipelineVersion'::text)) <= 128)) AND ((descriptor ->> 'count'::text) ~ '^([1-9]|[1-5][0-9]|6[0-4])$'::text) AND ((descriptor ->> 'dimensions'::text) = '1536'::text) AND
CASE
    WHEN (state = 'admitted'::text) THEN (result IS NULL)
    ELSE public.job_effect_vectors_valid(result, ((descriptor ->> 'count'::text))::integer)
END)) IS TRUE))
);

ALTER TABLE ONLY public.job_effects FORCE ROW LEVEL SECURITY;



CREATE TABLE public.join_link (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    organization_id text NOT NULL,
    role text NOT NULL,
    created_by text NOT NULL,
    expires_at timestamp with time zone,
    max_uses integer,
    uses_count integer DEFAULT 0 NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.join_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supabase_id uuid NOT NULL,
    user_id text NOT NULL,
    email text NOT NULL,
    display_name text,
    message text,
    status text DEFAULT 'pending'::text NOT NULL,
    organization_id text NOT NULL,
    requested_role text DEFAULT 'user'::text NOT NULL,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.knowledge_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    source_id uuid NOT NULL,
    document_id uuid NOT NULL,
    chunk_key text NOT NULL,
    kind text DEFAULT 'raw'::text NOT NULL,
    seq integer NOT NULL,
    chunk_text text NOT NULL,
    context_prefix text,
    content_hash text NOT NULL,
    embedding public.vector(1536),
    embedding_model text,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, ((COALESCE(context_prefix, ''::text) || ' '::text) || chunk_text))) STORED,
    occurred_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vector_indexed_hash text,
    vector_indexed_generation text,
    CONSTRAINT knowledge_chunks_kind_check CHECK ((kind = ANY (ARRAY['summary'::text, 'section'::text, 'burst'::text, 'code_file'::text, 'code_symbol'::text, 'raw'::text])))
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_analyze_scale_factor='0.02');

ALTER TABLE ONLY public.knowledge_chunks FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.knowledge_chunks IS 'Changed-chunk-only lexical and vector evidence shared across brain scopes. Embeddings remain canonical; ANN indexing is optional and currently disabled by the storage guard migration.';



COMMENT ON COLUMN public.knowledge_chunks.vector_indexed_hash IS 'content_hash the serving-index worker last confirmed for this chunk; null or stale means the chunk is not in the serving index at its current content.';



COMMENT ON COLUMN public.knowledge_chunks.vector_indexed_generation IS 'collection generation that confirmed vector_indexed_hash; a receipt from any other generation does not count as indexed.';



CREATE TABLE public.knowledge_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    source_id uuid NOT NULL,
    external_id text NOT NULL,
    title text NOT NULL,
    raw_text text NOT NULL,
    normalized_text text NOT NULL,
    content_hash text NOT NULL,
    source_revision text,
    occurred_at timestamp with time zone,
    source_updated_at timestamp with time zone,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_documents_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'failed'::text, 'deleted'::text])))
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_analyze_scale_factor='0.02');

ALTER TABLE ONLY public.knowledge_documents FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.knowledge_documents IS 'Normalized, idempotent source documents stored once in the canonical brain corpus.';



CREATE TABLE public.knowledge_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    connector text NOT NULL,
    external_key text NOT NULL,
    name text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'discovered'::text NOT NULL,
    sync_mode text DEFAULT 'incremental'::text NOT NULL,
    cadence text,
    watermark jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_synced_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_sources_status_check CHECK ((status = ANY (ARRAY['discovered'::text, 'queued'::text, 'processing'::text, 'ready'::text, 'degraded'::text, 'failed'::text])))
);

ALTER TABLE ONLY public.knowledge_sources FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.knowledge_sources IS 'Org-scoped upstream connector feeds shared by Master and Focused brains.';



CREATE TABLE public.marketplace_agents (
    id text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    category text NOT NULL,
    tags text NOT NULL,
    description text NOT NULL,
    catchphrase text,
    version text NOT NULL,
    model text,
    avatar_seed text NOT NULL,
    github_path text NOT NULL,
    soul_md text,
    identity_md text,
    user_md text,
    context_md text,
    skills_md text,
    install_count integer DEFAULT 0,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    files_loaded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archetype text
);



CREATE TABLE public.marketplace_installs (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    agent_id text NOT NULL,
    gateway_id uuid NOT NULL,
    installed_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.marketplace_installs FORCE ROW LEVEL SECURITY;



CREATE TABLE public.member_roles (
    org_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    role_key text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.member_roles FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.member_roles IS 'Per-org role assignments (multi-role per member). Backfilled from organization_members; member→manager to preserve access.';



CREATE TABLE public.membership_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    membership_id uuid NOT NULL,
    cycle_no integer NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    sales_order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.membership_cycles FORCE ROW LEVEL SECURITY;



CREATE TABLE public.membership_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    name text NOT NULL,
    price numeric,
    currency text DEFAULT 'PEN'::text,
    interval_unit text DEFAULT 'month'::text NOT NULL,
    interval_count integer DEFAULT 1 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.membership_plans FORCE ROW LEVEL SECURITY;



CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    plan_id uuid NOT NULL,
    crm_contact_id uuid,
    party_id uuid,
    customer_name text,
    status text DEFAULT 'active'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    next_cycle_date timestamp with time zone NOT NULL,
    cycle_no integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.memberships FORCE ROW LEVEL SECURITY;



CREATE TABLE public.meta_ad_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    ad_account_id text NOT NULL,
    campaign_id text,
    campaign_name text,
    adset_id text,
    adset_name text,
    ad_id text NOT NULL,
    ad_name text,
    date date NOT NULL,
    spend numeric,
    impressions integer,
    reach integer,
    clicks integer,
    ctr numeric,
    cpc numeric,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    currency text,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.meta_ad_insights FORCE ROW LEVEL SECURITY;



CREATE TABLE public.meta_ad_posts (
    org_id text NOT NULL,
    ad_id text NOT NULL,
    post_id text NOT NULL,
    platform text DEFAULT 'fb'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.meta_ad_posts FORCE ROW LEVEL SECURITY;



CREATE TABLE public.meta_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    connection_id uuid NOT NULL,
    kind text NOT NULL,
    external_id text NOT NULL,
    name text,
    page_token_ciphertext text,
    page_token_iv text,
    parent_page_id text,
    currency text,
    enabled boolean DEFAULT true NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.meta_assets FORCE ROW LEVEL SECURITY;



CREATE TABLE public.meta_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    kind text NOT NULL,
    fb_user_id text,
    token_ciphertext text,
    token_iv text,
    token_expires_at timestamp with time zone,
    granted_scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    connected_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.meta_connections FORCE ROW LEVEL SECURITY;



CREATE TABLE public.meta_lead_attribution (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    channel text NOT NULL,
    sender_id text NOT NULL,
    chat_id text,
    first_message_id text,
    first_contact_at timestamp with time zone,
    origin text DEFAULT 'unknown'::text NOT NULL,
    source text,
    ref text,
    ad_id text,
    adset_id text,
    campaign_id text,
    campaign_name text,
    ad_title text,
    photo_url text,
    video_url text,
    provenance text NOT NULL,
    confidence text NOT NULL,
    match_meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.meta_lead_attribution FORCE ROW LEVEL SECURITY;



CREATE TABLE public.meta_post_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    asset_id uuid NOT NULL,
    platform text NOT NULL,
    post_id text NOT NULL,
    permalink text,
    caption text,
    media_type text,
    posted_at timestamp with time zone,
    metric text NOT NULL,
    value numeric,
    period text DEFAULT 'lifetime'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    is_promoted boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.meta_post_insights FORCE ROW LEVEL SECURITY;



CREATE TABLE public.meta_post_media (
    org_id text NOT NULL,
    platform text NOT NULL,
    post_id text NOT NULL,
    file_id text,
    source_url text,
    media_type text,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    attempts integer DEFAULT 0 NOT NULL,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.meta_post_media FORCE ROW LEVEL SECURITY;



CREATE TABLE public.meta_sync_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    page_cursor text,
    since date,
    until date,
    counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.meta_sync_jobs FORCE ROW LEVEL SECURITY;



CREATE TABLE public.missions (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    session_id text NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    metadata text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.missions FORCE ROW LEVEL SECURITY;



CREATE TABLE public.naming_series_counters (
    org_id text NOT NULL,
    prefix text NOT NULL,
    n bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.naming_series_counters FORCE ROW LEVEL SECURITY;



CREATE TABLE public.notes (
    id text NOT NULL,
    tenant_id text,
    user_id text,
    kind text DEFAULT 'note'::text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    color text DEFAULT 'default'::text NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    data text DEFAULT '{}'::text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL
);



CREATE TABLE public.notif_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    rule_id uuid NOT NULL,
    entity_id text NOT NULL,
    trigger_key text NOT NULL,
    channel text NOT NULL,
    recipient text,
    content text,
    status text NOT NULL,
    error text,
    message_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notif_log FORCE ROW LEVEL SECURITY;



CREATE TABLE public.notif_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    trigger_table text NOT NULL,
    trigger_event text NOT NULL,
    date_field text,
    date_offset_mins integer,
    condition jsonb DEFAULT '[]'::jsonb NOT NULL,
    recipients jsonb DEFAULT '[]'::jsonb NOT NULL,
    channel text NOT NULL,
    account_id text,
    template text NOT NULL,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notif_rules FORCE ROW LEVEL SECURITY;



CREATE TABLE public.org_areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    icon text DEFAULT 'Building2'::text NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    agent_ids text[] DEFAULT '{}'::text[] NOT NULL,
    user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    skill_keys text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    integration_keys text[] DEFAULT '{}'::text[] NOT NULL,
    virtual_agents jsonb DEFAULT '[]'::jsonb NOT NULL
);

ALTER TABLE ONLY public.org_areas FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.org_areas IS 'Org areas (departments). Groups agents/users/skills per organization for the OVERVIEW graph. Member-read RLS; hub service-role writes.';



COMMENT ON COLUMN public.org_areas.integration_keys IS 'Keys into the hub INTEGRATIONS registry (branded third-party platforms used by this area).';



COMMENT ON COLUMN public.org_areas.virtual_agents IS 'Provisioned single-function agents: [{id,name,role,skillKeys,integrationKeys}].';



CREATE TABLE public.org_provision_runs (
    org_id uuid NOT NULL,
    ok boolean NOT NULL,
    steps jsonb NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.org_provision_runs FORCE ROW LEVEL SECURITY;



CREATE TABLE public.org_roles (
    org_id text NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    rank integer NOT NULL,
    source_role_key text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.org_roles FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.org_roles IS 'Org-scoped custom roles (P3-W2). Additive beside the global permission_roles catalog — a custom role key (custom-<slug>) is never inserted into permission_roles; its permission_rules rows are org_id+role_key scoped like any override.';



CREATE TABLE public.organization_members (
    organization_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.organization_members FORCE ROW LEVEL SECURITY;



CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    paperclip_company_id text,
    kind text DEFAULT 'business'::text NOT NULL,
    CONSTRAINT organizations_kind_check CHECK ((kind = ANY (ARRAY['business'::text, 'personal'::text])))
);



CREATE TABLE public.parties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    type text DEFAULT 'person'::text NOT NULL,
    name text,
    phone9 text,
    email text,
    doc_type text,
    doc_number text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_id text,
    dob date,
    dni_verified boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.parties FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pending_channel_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    channel text NOT NULL,
    method text DEFAULT 'otp'::text NOT NULL,
    channel_user_id text,
    display_name text,
    code_hash text,
    start_token text,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    last_sent_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.pending_channel_claims FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.pending_channel_claims IS 'Hub-owned in-flight channel claim state (OTP + deep-link). Service-role only.';



CREATE TABLE public.permission_roles (
    key text NOT NULL,
    name text NOT NULL,
    rank integer NOT NULL,
    description text,
    is_system boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



COMMENT ON TABLE public.permission_roles IS 'Global RBAC role catalog (ERPNext-inspired). rank = authority/escalation ceiling.';



CREATE TABLE public.permission_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    role_key text NOT NULL,
    module text NOT NULL,
    can_view boolean DEFAULT false NOT NULL,
    can_create boolean DEFAULT false NOT NULL,
    can_edit boolean DEFAULT false NOT NULL,
    can_delete boolean DEFAULT false NOT NULL,
    can_export boolean DEFAULT false NOT NULL,
    can_manage boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    if_owner boolean DEFAULT false NOT NULL,
    field_level smallint DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.permission_rules FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.permission_rules IS 'Per-org capability OVERRIDES (role×module×action). Global defaults live in permissions.service DEFAULT_MATRIX.';



CREATE TABLE public.personal_agents (
    id text NOT NULL,
    profile_id uuid NOT NULL,
    agent_id text NOT NULL,
    gateway_id uuid,
    display_name text NOT NULL,
    conversation_name text,
    avatar_url text,
    personality_preset text,
    personality_text text,
    personality_configured boolean DEFAULT false NOT NULL,
    provisioning_status text DEFAULT 'pending'::text NOT NULL,
    provisioning_error text,
    last_retry_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.plugin_org_disabled (
    org_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    plugin_id text NOT NULL,
    disabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.plugin_org_disabled FORCE ROW LEVEL SECURITY;



COMMENT ON TABLE public.plugin_org_disabled IS 'DB-authoritative per-org plugin disable state. Hub pushes the derived plugins.orgDisabled map to the gateway via reconcileOrgConfig. org_guc RLS for withOrgCore writes; gateway-filtered service-role reads for reconcile.';



CREATE TABLE public.pos_client_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    party_id uuid,
    crm_contact_id uuid,
    kind text NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency text DEFAULT 'PEN'::text NOT NULL,
    ticket_id uuid,
    plan_id uuid,
    booking_id uuid,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT pos_client_ledger_amount_chk CHECK ((amount <> (0)::numeric)),
    CONSTRAINT pos_client_ledger_client_chk CHECK (((party_id IS NOT NULL) OR (crm_contact_id IS NOT NULL))),
    CONSTRAINT pos_client_ledger_kind_chk CHECK ((kind = ANY (ARRAY['topup'::text, 'deposit'::text, 'redemption'::text, 'refund'::text, 'adjustment'::text])))
);

ALTER TABLE ONLY public.pos_client_ledger FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pos_emissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    ticket_id uuid NOT NULL,
    doc_type text NOT NULL,
    serie text NOT NULL,
    correlativo integer NOT NULL,
    environment text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    response_code text,
    response_description text,
    xml_hash text,
    total numeric,
    client_doc_type text,
    client_doc_number text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.pos_emissions FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pos_package_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    party_id uuid,
    crm_contact_id uuid,
    source_ticket_id uuid NOT NULL,
    source_line_id uuid NOT NULL,
    package_product_id uuid NOT NULL,
    service_product_id uuid NOT NULL,
    sessions_total integer NOT NULL,
    unit_value numeric(12,2) DEFAULT 0 NOT NULL,
    expires_at date,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    CONSTRAINT pos_package_grants_client_chk CHECK (((party_id IS NOT NULL) OR (crm_contact_id IS NOT NULL))),
    CONSTRAINT pos_package_grants_sessions_chk CHECK ((sessions_total > 0)),
    CONSTRAINT pos_package_grants_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'exhausted'::text, 'expired'::text, 'cancelled'::text]))),
    CONSTRAINT pos_package_grants_unit_value_chk CHECK ((unit_value >= (0)::numeric))
);

ALTER TABLE ONLY public.pos_package_grants FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pos_package_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    grant_id uuid NOT NULL,
    booking_id uuid,
    ticket_id uuid,
    ticket_line_id uuid,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL,
    redeemed_by uuid,
    reversed_at timestamp with time zone,
    reversed_by uuid,
    reversal_reason text
);

ALTER TABLE ONLY public.pos_package_redemptions FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pos_payment_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    party_id uuid,
    crm_contact_id uuid,
    title text NOT NULL,
    total_amount numeric(12,2) NOT NULL,
    currency text DEFAULT 'PEN'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    product_id uuid,
    booking_id uuid,
    due_schedule jsonb,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    CONSTRAINT pos_payment_plans_client_chk CHECK (((party_id IS NOT NULL) OR (crm_contact_id IS NOT NULL))),
    CONSTRAINT pos_payment_plans_status_chk CHECK ((status = ANY (ARRAY['open'::text, 'settled'::text, 'cancelled'::text]))),
    CONSTRAINT pos_payment_plans_total_chk CHECK ((total_amount > (0)::numeric))
);

ALTER TABLE ONLY public.pos_payment_plans FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pos_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    ticket_id uuid NOT NULL,
    shift_id uuid NOT NULL,
    method text NOT NULL,
    amount numeric NOT NULL,
    tendered numeric,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.pos_payments FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pos_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    doc_type text NOT NULL,
    serie text NOT NULL,
    next_number integer DEFAULT 1 NOT NULL,
    environment text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.pos_series FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pos_settings (
    org_id text NOT NULL,
    methods jsonb DEFAULT '["cash", "card", "yape", "plin", "transfer"]'::jsonb NOT NULL,
    currency text DEFAULT 'PEN'::text NOT NULL,
    require_customer boolean DEFAULT false NOT NULL,
    allow_price_override boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    surcharges jsonb DEFAULT '{}'::jsonb NOT NULL,
    emission jsonb DEFAULT '{"mode": "off", "docTypeDefault": "03"}'::jsonb NOT NULL,
    requirements jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.pos_settings FORCE ROW LEVEL SECURITY;



COMMENT ON COLUMN public.pos_settings.methods IS 'PaymentMethod[] objects ({id,label,enabled,takesTendered,surcharge?,documentDefault?}); legacy string[] rows are upgraded on read by pos.service.ts normalizeMethods().';



CREATE TABLE public.pos_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    opened_by uuid,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_float jsonb DEFAULT '{}'::jsonb NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    expected jsonb,
    counted jsonb,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.pos_shifts FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pos_ticket_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    ticket_id uuid NOT NULL,
    kind text NOT NULL,
    fin_product_id uuid,
    booking_id uuid,
    description text NOT NULL,
    qty numeric NOT NULL,
    unit_price numeric NOT NULL,
    discount numeric DEFAULT 0 NOT NULL,
    total numeric NOT NULL,
    line_no integer DEFAULT 0 NOT NULL,
    modifiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    plan_id uuid,
    redemption_id uuid
);

ALTER TABLE ONLY public.pos_ticket_lines FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pos_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    human_id text,
    shift_id uuid NOT NULL,
    party_id uuid,
    crm_contact_id uuid,
    customer_name text,
    status text DEFAULT 'submitted'::text NOT NULL,
    subtotal numeric NOT NULL,
    discount numeric DEFAULT 0 NOT NULL,
    total numeric NOT NULL,
    currency text DEFAULT 'PEN'::text NOT NULL,
    note text,
    stock_entry_id uuid,
    stock_warning jsonb,
    invoice_provider_ref text,
    created_by uuid,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_at timestamp with time zone,
    voided_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.pos_tickets FORCE ROW LEVEL SECURITY;



CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    display_name text,
    role text DEFAULT 'user'::text NOT NULL,
    personal_agent_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    avatar_url text,
    alias text,
    role_id text,
    account_type text DEFAULT 'person'::text NOT NULL,
    username text,
    CONSTRAINT profiles_account_type_chk CHECK ((account_type = ANY (ARRAY['person'::text, 'service'::text])))
);



CREATE TABLE public.profiles_legacy_user_id_backup_20260610 (
    id uuid,
    email text,
    legacy_user_id text,
    backed_up_at timestamp with time zone
);



CREATE TABLE public.proj_projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    human_id text,
    name text NOT NULL,
    description text,
    status text DEFAULT 'open'::text NOT NULL,
    customer_party_id uuid,
    lead_party_id uuid,
    color text,
    icon text,
    target_date date,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    archived_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.proj_projects FORCE ROW LEVEL SECURITY;



CREATE TABLE public.proj_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    project_id uuid NOT NULL,
    parent_id uuid,
    milestone_id uuid,
    is_milestone boolean DEFAULT false NOT NULL,
    human_id text,
    title text NOT NULL,
    description text,
    status text DEFAULT 'backlog'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    assignee_party_id uuid,
    est_minutes integer,
    sort_order integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.proj_tasks FORCE ROW LEVEL SECURITY;



CREATE TABLE public.proj_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    name text NOT NULL,
    description text,
    spec jsonb DEFAULT '{}'::jsonb NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.proj_templates FORCE ROW LEVEL SECURITY;



CREATE TABLE public.proj_timesheets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    project_id uuid,
    task_id uuid,
    party_id uuid NOT NULL,
    spent_date date NOT NULL,
    minutes integer NOT NULL,
    description text,
    billable boolean DEFAULT false NOT NULL,
    billing_rate_cents integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.proj_timesheets FORCE ROW LEVEL SECURITY;



CREATE TABLE public.pulse_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    summary text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    dedup_key text NOT NULL,
    decided_by text,
    executed_at timestamp with time zone,
    error text
);



CREATE TABLE public.pulse_settings (
    org_id text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    briefing_time text DEFAULT '08:00'::text NOT NULL,
    locale text DEFAULT 'es'::text NOT NULL,
    channels text[] DEFAULT '{whatsapp}'::text[] NOT NULL,
    watch jsonb DEFAULT '{"email": true, "calendar": true, "whatsapp": true}'::jsonb NOT NULL,
    auto_approve jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.sales_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    source_booking_id uuid,
    party_id uuid,
    crm_contact_id uuid,
    customer_name text,
    event_type_id uuid,
    product_id uuid,
    description text,
    quantity numeric DEFAULT 1 NOT NULL,
    unit_price numeric,
    total numeric,
    currency text DEFAULT 'PEN'::text,
    status text DEFAULT 'draft'::text NOT NULL,
    invoice_provider_ref text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    human_id text,
    owner_id uuid
);

ALTER TABLE ONLY public.sales_orders FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    schedule_id uuid NOT NULL,
    days integer[] DEFAULT '{}'::integer[] NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    date text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.sched_availability FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_booking_status_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    booking_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    reason text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sched_booking_status_log FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    uid text NOT NULL,
    event_type_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    status text DEFAULT 'accepted'::text NOT NULL,
    title text,
    notes text,
    attendee_name text,
    attendee_email text,
    attendee_phone text,
    crm_contact_id uuid,
    product_id uuid,
    source text DEFAULT 'internal'::text NOT NULL,
    rescheduled_from_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    party_id uuid,
    kind_id uuid,
    invoice_id uuid,
    package_grant_id uuid,
    payment_plan_id uuid,
    series_id uuid,
    series_index integer,
    client_note text
);

ALTER TABLE ONLY public.sched_bookings FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_event_kinds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    name text NOT NULL,
    color text NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sched_event_kinds FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_event_type_resources (
    org_id text NOT NULL,
    event_type_id uuid NOT NULL,
    resource_id uuid NOT NULL
);

ALTER TABLE ONLY public.sched_event_type_resources FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_event_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text,
    length integer NOT NULL,
    slot_interval integer,
    before_buffer integer DEFAULT 0 NOT NULL,
    after_buffer integer DEFAULT 0 NOT NULL,
    minimum_booking_notice integer DEFAULT 120 NOT NULL,
    period_type text DEFAULT 'rolling'::text NOT NULL,
    period_days integer,
    scheduling_type text,
    requires_confirmation boolean DEFAULT false NOT NULL,
    public boolean DEFAULT true NOT NULL,
    color text,
    product_id uuid,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    use_custom_schedule boolean DEFAULT false NOT NULL,
    schedule_rules jsonb DEFAULT '[]'::jsonb NOT NULL,
    kind_id uuid
);

ALTER TABLE ONLY public.sched_event_types FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text,
    event_type_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    resource_id uuid,
    active boolean DEFAULT true NOT NULL,
    expires_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sched_links FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_reminder_config (
    org_id text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    stages jsonb DEFAULT '[{"key": "confirmation"}, {"key": "24h", "minutesBefore": 1440}, {"key": "2h", "minutesBefore": 120}]'::jsonb NOT NULL,
    channel text DEFAULT 'whatsapp'::text NOT NULL,
    account_id text,
    personalize boolean DEFAULT true NOT NULL,
    locale text DEFAULT 'es'::text NOT NULL,
    from_name text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    channels jsonb DEFAULT '[]'::jsonb NOT NULL,
    infer_confirmation boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.sched_reminder_config FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    booking_id uuid NOT NULL,
    stage text NOT NULL,
    channel text NOT NULL,
    recipient text,
    content text,
    status text NOT NULL,
    message_id text,
    error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    recipient_role text DEFAULT 'client'::text NOT NULL
);

ALTER TABLE ONLY public.sched_reminders FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    kind text DEFAULT 'staff'::text NOT NULL,
    profile_id uuid,
    name text NOT NULL,
    email text,
    timezone text DEFAULT 'America/Lima'::text NOT NULL,
    color text,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sched_resources FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sched_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    resource_id uuid NOT NULL,
    name text DEFAULT 'Working hours'::text NOT NULL,
    timezone text DEFAULT 'America/Lima'::text NOT NULL,
    is_default boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sched_schedules FORCE ROW LEVEL SECURITY;



CREATE TABLE public.server_backups (
    id text NOT NULL,
    gateway_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    snapshot_path text NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    size_bytes bigint,
    status text DEFAULT 'running'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.server_backups FORCE ROW LEVEL SECURITY;



CREATE TABLE public.server_provision_configs (
    id text NOT NULL,
    gateway_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    ssh_host text,
    ssh_user text DEFAULT 'root'::text,
    ssh_port integer DEFAULT 22,
    api_key text,
    api_key_iv text,
    agent_name text,
    sandbox_mode text DEFAULT 'non-main'::text,
    dm_policy text DEFAULT 'pairing'::text,
    install_method text DEFAULT 'package'::text,
    pkg_manager text DEFAULT 'npm'::text,
    gateway_port integer DEFAULT 18789,
    gateway_bind text DEFAULT 'loopback'::text,
    enable_whatsapp boolean DEFAULT false,
    enable_telegram boolean DEFAULT false,
    enable_discord boolean DEFAULT false,
    phase_statuses text DEFAULT '{}'::text,
    last_provision_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.server_provision_configs FORCE ROW LEVEL SECURITY;



CREATE TABLE public.session_tasks (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    session_key text NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'backlog'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.session_tasks FORCE ROW LEVEL SECURITY;



CREATE TABLE public.sessions (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    agent_id text NOT NULL,
    session_key text NOT NULL,
    status text DEFAULT 'idle'::text NOT NULL,
    metadata text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sessions FORCE ROW LEVEL SECURITY;



CREATE TABLE public.settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    section text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.settings FORCE ROW LEVEL SECURITY;



CREATE TABLE public.skill_execution_stats (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    agent_id text,
    skill_name text NOT NULL,
    session_key text,
    status text NOT NULL,
    duration_ms integer,
    error_message text,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.skill_execution_stats FORCE ROW LEVEL SECURITY;



CREATE SEQUENCE public.skill_execution_stats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.skill_execution_stats_id_seq OWNED BY public.skill_execution_stats.id;



CREATE TABLE public.skills (
    skill_key text NOT NULL,
    gateway_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    emoji text,
    bundled boolean DEFAULT false NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    eligible boolean DEFAULT false NOT NULL,
    raw_json text NOT NULL,
    last_seen_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.skills FORCE ROW LEVEL SECURITY;



CREATE TABLE public.stk_accruals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    source text NOT NULL,
    source_id uuid NOT NULL,
    fin_product_id uuid,
    item_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    qty_consumption numeric NOT NULL,
    qty numeric NOT NULL,
    est_unit_cost numeric DEFAULT 0 NOT NULL,
    est_value numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    realized_entry_id uuid,
    realized_qty numeric,
    realized_value numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    realized_at timestamp with time zone,
    released_at timestamp with time zone
);

ALTER TABLE ONLY public.stk_accruals FORCE ROW LEVEL SECURITY;



CREATE TABLE public.stk_bins (
    org_id text NOT NULL,
    item_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    qty numeric DEFAULT 0 NOT NULL,
    valuation_rate numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.stk_bins FORCE ROW LEVEL SECURITY;



CREATE TABLE public.stk_bins_bak_insumos2608 (
    org_id text,
    item_id uuid,
    warehouse_id uuid,
    qty numeric,
    valuation_rate numeric,
    updated_at timestamp with time zone
);



CREATE TABLE public.stk_consumption (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    fin_product_id uuid NOT NULL,
    item_id uuid NOT NULL,
    qty_per_unit numeric NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.stk_consumption FORCE ROW LEVEL SECURITY;



CREATE TABLE public.stk_consumption_bak_insumos2608 (
    id uuid,
    org_id text,
    fin_product_id uuid,
    item_id uuid,
    qty_per_unit numeric,
    note text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);



CREATE TABLE public.stk_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    human_id text,
    type text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    party_id uuid,
    note text,
    posted_at timestamp with time zone,
    created_by text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.stk_entries FORCE ROW LEVEL SECURITY;



CREATE TABLE public.stk_entries_bak_repair (
    id uuid,
    org_id text,
    human_id text,
    type text,
    status text,
    party_id uuid,
    note text,
    posted_at timestamp with time zone,
    created_by text,
    metadata jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);



CREATE TABLE public.stk_entries_reclass_bak (
    id uuid,
    org_id text,
    human_id text,
    type text,
    status text,
    party_id uuid,
    note text,
    posted_at timestamp with time zone,
    created_by text,
    metadata jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);



CREATE TABLE public.stk_entry_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    entry_id uuid NOT NULL,
    item_id uuid NOT NULL,
    qty numeric NOT NULL,
    uom text,
    rate numeric,
    from_warehouse_id uuid,
    to_warehouse_id uuid,
    line_no integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.stk_entry_lines FORCE ROW LEVEL SECURITY;



CREATE TABLE public.stk_item_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    parent_item_id uuid NOT NULL,
    child_item_id uuid NOT NULL,
    qty numeric NOT NULL,
    optional boolean DEFAULT false NOT NULL,
    default_included boolean DEFAULT true NOT NULL,
    choice_group text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stk_item_components_no_self CHECK ((parent_item_id <> child_item_id))
);

ALTER TABLE ONLY public.stk_item_components FORCE ROW LEVEL SECURITY;



CREATE TABLE public.stk_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    uom text DEFAULT 'unit'::text NOT NULL,
    item_group text,
    is_stock_item boolean DEFAULT true NOT NULL,
    reorder_level numeric,
    reorder_qty numeric,
    valuation_method text DEFAULT 'moving_avg'::text NOT NULL,
    fin_product_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    consumption_uom text,
    units_per_stock_uom numeric,
    subunits_per_stock_uom numeric,
    diagram_enabled boolean DEFAULT false NOT NULL,
    unit_svg text,
    subunit_svg text,
    moq numeric,
    default_supplier_party_id uuid,
    sku uuid DEFAULT gen_random_uuid() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.stk_items FORCE ROW LEVEL SECURITY;



CREATE TABLE public.stk_items_bak_insumos2608 (
    id uuid,
    org_id text,
    code text,
    name text,
    uom text,
    item_group text,
    is_stock_item boolean,
    reorder_level numeric,
    reorder_qty numeric,
    valuation_method text,
    fin_product_id uuid,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    consumption_uom text,
    units_per_stock_uom numeric,
    subunits_per_stock_uom numeric,
    diagram_enabled boolean,
    unit_svg text,
    subunit_svg text,
    moq numeric,
    default_supplier_party_id uuid,
    sku uuid,
    metadata jsonb
);



CREATE TABLE public.stk_ledger (
    id bigint NOT NULL,
    org_id text NOT NULL,
    item_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    qty_delta numeric NOT NULL,
    qty_after numeric NOT NULL,
    valuation_rate numeric NOT NULL,
    value_delta numeric NOT NULL,
    posted_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.stk_ledger FORCE ROW LEVEL SECURITY;



CREATE TABLE public.stk_ledger_bak_repair (
    id bigint,
    org_id text,
    item_id uuid,
    warehouse_id uuid,
    entry_id uuid,
    qty_delta numeric,
    qty_after numeric,
    valuation_rate numeric,
    value_delta numeric,
    posted_at timestamp with time zone
);



CREATE SEQUENCE public.stk_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.stk_ledger_id_seq OWNED BY public.stk_ledger.id;



CREATE TABLE public.stk_warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone
);

ALTER TABLE ONLY public.stk_warehouses FORCE ROW LEVEL SECURITY;



CREATE TABLE public.support_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    subject text NOT NULL,
    description text,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    party_id uuid,
    crm_contact_id uuid,
    owner_id uuid,
    source text DEFAULT 'manual'::text NOT NULL,
    channel text,
    response_by timestamp with time zone,
    resolution_by timestamp with time zone,
    first_responded_at timestamp with time zone,
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    human_id text
);

ALTER TABLE ONLY public.support_issues FORCE ROW LEVEL SECURITY;



CREATE TABLE public.support_settings (
    org_id text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.support_settings FORCE ROW LEVEL SECURITY;



CREATE TABLE public.tag_links (
    org_id text NOT NULL,
    entity_kind text NOT NULL,
    entity_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    applied_by uuid,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tag_links_entity_kind_check CHECK ((entity_kind = ANY (ARRAY['booking'::text, 'event_type'::text, 'product'::text])))
);

ALTER TABLE ONLY public.tag_links FORCE ROW LEVEL SECURITY;



CREATE TABLE public.tasks (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    mission_id text NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'backlog'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.tasks FORCE ROW LEVEL SECURITY;



CREATE TABLE public.user_agents (
    user_id uuid NOT NULL,
    agent_id text NOT NULL,
    gateway_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.user_gateway (
    profile_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.user_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    kind text NOT NULL,
    external_id text NOT NULL,
    display_name text,
    scope text,
    secret_ciphertext text,
    secret_iv text,
    expires_at bigint,
    verified_at bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    shareable boolean DEFAULT false NOT NULL
);



CREATE TABLE public.user_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    section text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.workflow_defs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text NOT NULL,
    doc_type text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    states jsonb DEFAULT '[]'::jsonb NOT NULL,
    transitions jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workflow_defs FORCE ROW LEVEL SECURITY;



CREATE TABLE public.workshop_comparison_outputs (
    id text NOT NULL,
    run_id text NOT NULL,
    model_id text NOT NULL,
    provider text,
    output text,
    latency_ms integer,
    input_tokens integer,
    output_tokens integer,
    cost_usd double precision,
    error text,
    created_at bigint NOT NULL
);



CREATE TABLE public.workshop_comparison_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    server_id text,
    user_id text,
    prompt text NOT NULL,
    system text,
    params text,
    model_ids text NOT NULL,
    blind boolean DEFAULT false NOT NULL,
    category_ids text,
    created_at bigint NOT NULL,
    finished_at bigint
);



CREATE TABLE public.workshop_groupchat_agents (
    id text NOT NULL,
    run_id text NOT NULL,
    name text NOT NULL,
    system_prompt text NOT NULL,
    provider text NOT NULL,
    model_id text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL
);



CREATE TABLE public.workshop_groupchat_messages (
    id text NOT NULL,
    run_id text NOT NULL,
    agent_id text,
    round integer NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    model_id text,
    latency_ms integer,
    tokens integer,
    cost_usd double precision,
    created_at bigint NOT NULL
);



CREATE TABLE public.workshop_groupchat_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    server_id text,
    user_id text,
    prompt text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    rounds integer,
    style text,
    include_orchestrator boolean DEFAULT false NOT NULL,
    background boolean DEFAULT false NOT NULL,
    settings text,
    current_round integer DEFAULT 0 NOT NULL,
    created_at bigint NOT NULL,
    finished_at bigint
);



CREATE TABLE public.workshop_prompt_categories (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    source text NOT NULL,
    created_at bigint NOT NULL
);



CREATE TABLE public.workshop_rankings (
    id text NOT NULL,
    run_id text NOT NULL,
    model_id text NOT NULL,
    rank integer NOT NULL,
    picked boolean DEFAULT false NOT NULL,
    user_id text,
    created_at bigint NOT NULL
);



CREATE TABLE public.workshop_saves (
    id text NOT NULL,
    name text NOT NULL,
    state text NOT NULL,
    thumbnail text,
    profile_id uuid,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workshop_saves FORCE ROW LEVEL SECURITY;



CREATE TABLE public.workspace_membership (
    user_id uuid NOT NULL,
    paperclip_company_id text NOT NULL,
    role text DEFAULT 'admin'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);



ALTER TABLE ONLY public.skill_execution_stats ALTER COLUMN id SET DEFAULT nextval('public.skill_execution_stats_id_seq'::regclass);



ALTER TABLE ONLY public.stk_ledger ALTER COLUMN id SET DEFAULT nextval('public.stk_ledger_id_seq'::regclass);



ALTER TABLE ONLY public.agent_artifact_revisions
    ADD CONSTRAINT agent_artifact_revisions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.agent_artifacts
    ADD CONSTRAINT agent_artifacts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.agent_built_skills
    ADD CONSTRAINT agent_built_skills_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.agent_group_members
    ADD CONSTRAINT agent_group_members_group_id_agent_id_pk PRIMARY KEY (group_id, agent_id);



ALTER TABLE ONLY public.agent_groups
    ADD CONSTRAINT agent_groups_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.agent_memories
    ADD CONSTRAINT agent_memories_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.app_modules
    ADD CONSTRAINT app_modules_pkey PRIMARY KEY (org_id, module_id);



ALTER TABLE ONLY public.assignment_rules
    ADD CONSTRAINT assignment_rules_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.attachment_file_state
    ADD CONSTRAINT attachment_file_state_pkey PRIMARY KEY (file_id);



ALTER TABLE ONLY public.attachment_links
    ADD CONSTRAINT attachment_links_pkey PRIMARY KEY (object_type, object_id, file_id);



ALTER TABLE ONLY public.attachment_trash
    ADD CONSTRAINT attachment_trash_pkey PRIMARY KEY (object_type, object_id, file_id);



ALTER TABLE ONLY public.backup_configs
    ADD CONSTRAINT backup_configs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.bg_jobs
    ADD CONSTRAINT bg_jobs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.brain_access
    ADD CONSTRAINT brain_access_pkey PRIMARY KEY (brain_id, principal_type, principal_id);



ALTER TABLE ONLY public.brain_agent_templates
    ADD CONSTRAINT brain_agent_templates_org_id_key UNIQUE (org_id);



ALTER TABLE ONLY public.brain_agent_templates
    ADD CONSTRAINT brain_agent_templates_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.brain_chunks
    ADD CONSTRAINT brain_chunks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.brain_documents
    ADD CONSTRAINT brain_documents_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.brain_enrichment_settings
    ADD CONSTRAINT brain_enrichment_settings_org_id_key UNIQUE (org_id);



ALTER TABLE ONLY public.brain_enrichment_settings
    ADD CONSTRAINT brain_enrichment_settings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.brain_sources
    ADD CONSTRAINT brain_sources_pkey PRIMARY KEY (brain_id, source_id);



ALTER TABLE ONLY public.brain_vector_generations
    ADD CONSTRAINT brain_vector_generations_pkey PRIMARY KEY (generation);



ALTER TABLE ONLY public.brain_vector_outbox
    ADD CONSTRAINT brain_vector_outbox_pkey PRIMARY KEY (chunk_id, collection_generation);



ALTER TABLE ONLY public.brain_vector_reconcile_state
    ADD CONSTRAINT brain_vector_reconcile_state_pkey PRIMARY KEY (collection_generation);



ALTER TABLE ONLY public.brains
    ADD CONSTRAINT brains_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.built_agent_skills
    ADD CONSTRAINT built_agent_skills_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.built_agents
    ADD CONSTRAINT built_agents_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.built_chapter_edges
    ADD CONSTRAINT built_chapter_edges_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.built_chapter_tools
    ADD CONSTRAINT built_chapter_tools_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.built_chapters
    ADD CONSTRAINT built_chapters_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.built_skill_tools
    ADD CONSTRAINT built_skill_tools_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.built_skills
    ADD CONSTRAINT built_skills_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.built_tools
    ADD CONSTRAINT built_tools_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.channel_assignments
    ADD CONSTRAINT channel_assignments_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.channel_bindings
    ADD CONSTRAINT channel_bindings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.channel_identities
    ADD CONSTRAINT channel_identities_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.channel_pairing_requests
    ADD CONSTRAINT channel_pairing_requests_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.config_snapshots
    ADD CONSTRAINT config_snapshots_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.crm_contact_activity_stats
    ADD CONSTRAINT crm_contact_activity_stats_pkey PRIMARY KEY (contact_id);



ALTER TABLE ONLY public.crm_contact_identities
    ADD CONSTRAINT crm_contact_identities_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.crm_contact_tags
    ADD CONSTRAINT crm_contact_tags_pkey PRIMARY KEY (contact_id, tag_id);



ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.crm_conversation_analysis
    ADD CONSTRAINT crm_conversation_analysis_pkey PRIMARY KEY (org_id, channel, chat_id);



ALTER TABLE ONLY public.crm_conversation_chunks
    ADD CONSTRAINT crm_conversation_chunks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.crm_conversation_index
    ADD CONSTRAINT crm_conversation_index_pkey PRIMARY KEY (org_id, channel, chat_id);



ALTER TABLE ONLY public.crm_message_sentiment
    ADD CONSTRAINT crm_message_sentiment_pkey PRIMARY KEY (org_id, message_id);



ALTER TABLE ONLY public.crm_sentiment_chat_daily
    ADD CONSTRAINT crm_sentiment_chat_daily_pkey PRIMARY KEY (org_id, chat_id, day);



ALTER TABLE ONLY public.crm_settings
    ADD CONSTRAINT crm_settings_pkey PRIMARY KEY (org_id);



ALTER TABLE ONLY public.crm_tags
    ADD CONSTRAINT crm_tags_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.crm_win_embeddings
    ADD CONSTRAINT crm_win_embeddings_pkey PRIMARY KEY (org_id, contact_id);



ALTER TABLE ONLY public.crm_word_frequency_daily
    ADD CONSTRAINT crm_word_frequency_daily_pkey PRIMARY KEY (org_id, day, word);



ALTER TABLE ONLY public.dashboard_layouts
    ADD CONSTRAINT dashboard_layouts_pkey PRIMARY KEY (org_id, dashboard_id);



ALTER TABLE ONLY public.device_identities
    ADD CONSTRAINT device_identities_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.device_identities
    ADD CONSTRAINT device_identities_tenant_id_unique UNIQUE (tenant_id);



ALTER TABLE ONLY public.doc_audit_log
    ADD CONSTRAINT doc_audit_log_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.doc_comments
    ADD CONSTRAINT doc_comments_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.email_ledger
    ADD CONSTRAINT email_ledger_mailbox_gmail_message_id_key UNIQUE (mailbox, gmail_message_id);



ALTER TABLE ONLY public.email_ledger
    ADD CONSTRAINT email_ledger_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.email_ledger_settings
    ADD CONSTRAINT email_ledger_settings_pkey PRIMARY KEY (org_id);



ALTER TABLE ONLY public.email_opens
    ADD CONSTRAINT email_opens_pkey PRIMARY KEY (user_id, gmail_message_id);



ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_clients
    ADD CONSTRAINT fin_clients_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_invoice_items
    ADD CONSTRAINT fin_invoice_items_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_invoices
    ADD CONSTRAINT fin_invoices_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_payments
    ADD CONSTRAINT fin_payments_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_product_components
    ADD CONSTRAINT fin_product_components_org_id_bundle_product_id_child_produ_key UNIQUE (org_id, bundle_product_id, child_product_id);



ALTER TABLE ONLY public.fin_product_components
    ADD CONSTRAINT fin_product_components_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_products
    ADD CONSTRAINT fin_products_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_purchase_periods
    ADD CONSTRAINT fin_purchase_periods_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_purchases
    ADD CONSTRAINT fin_purchases_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_settings
    ADD CONSTRAINT fin_settings_pkey PRIMARY KEY (org_id);



ALTER TABLE ONLY public.fin_sources
    ADD CONSTRAINT fin_sources_pkey PRIMARY KEY (org_id, provider);



ALTER TABLE ONLY public.fin_statement_imports
    ADD CONSTRAINT fin_statement_imports_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_sync_jobs
    ADD CONSTRAINT fin_sync_jobs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.fin_transactions
    ADD CONSTRAINT fin_transactions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.flow_groups
    ADD CONSTRAINT flow_groups_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.flow_runs
    ADD CONSTRAINT flow_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.flow_var_exports
    ADD CONSTRAINT flow_var_exports_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.gateway_lease
    ADD CONSTRAINT gateway_lease_pkey PRIMARY KEY (org_id, channel);



ALTER TABLE ONLY public.gateway
    ADD CONSTRAINT gateway_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.gateway_signing_keys
    ADD CONSTRAINT gateway_signing_keys_pkey PRIMARY KEY (kid);



ALTER TABLE ONLY public.hr_employees
    ADD CONSTRAINT hr_employees_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_holidays
    ADD CONSTRAINT hr_holidays_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_leave_allocations
    ADD CONSTRAINT hr_leave_allocations_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_leave_requests
    ADD CONSTRAINT hr_leave_requests_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_leave_types
    ADD CONSTRAINT hr_leave_types_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_settings
    ADD CONSTRAINT hr_settings_pkey PRIMARY KEY (org_id);



ALTER TABLE ONLY public.hub_migrations
    ADD CONSTRAINT hub_migrations_pkey PRIMARY KEY (version);



ALTER TABLE ONLY public.identity_subscriptions
    ADD CONSTRAINT identity_subscriptions_identity_id_subscriber_profile_id_key UNIQUE (identity_id, subscriber_profile_id);



ALTER TABLE ONLY public.identity_subscriptions
    ADD CONSTRAINT identity_subscriptions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.job_effect_batches
    ADD CONSTRAINT job_effect_batches_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.job_effect_pages
    ADD CONSTRAINT job_effect_pages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.job_effect_units
    ADD CONSTRAINT job_effect_units_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.job_effects
    ADD CONSTRAINT job_effects_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.join_link
    ADD CONSTRAINT join_link_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.join_link
    ADD CONSTRAINT join_link_token_unique UNIQUE (token);



ALTER TABLE ONLY public.join_request
    ADD CONSTRAINT join_request_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_org_document_key_uniq UNIQUE (org_id, document_id, chunk_key);



ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_documents_org_id_uniq UNIQUE (org_id, id);



ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_documents_org_source_external_uniq UNIQUE (org_id, source_id, external_id);



ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_documents_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.knowledge_sources
    ADD CONSTRAINT knowledge_sources_org_connector_key_uniq UNIQUE (org_id, connector, external_key);



ALTER TABLE ONLY public.knowledge_sources
    ADD CONSTRAINT knowledge_sources_org_id_uniq UNIQUE (org_id, id);



ALTER TABLE ONLY public.knowledge_sources
    ADD CONSTRAINT knowledge_sources_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.marketplace_agents
    ADD CONSTRAINT marketplace_agents_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.marketplace_installs
    ADD CONSTRAINT marketplace_installs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_pkey PRIMARY KEY (org_id, profile_id, role_key);



ALTER TABLE ONLY public.membership_cycles
    ADD CONSTRAINT membership_cycles_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.membership_plans
    ADD CONSTRAINT membership_plans_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.meta_ad_insights
    ADD CONSTRAINT meta_ad_insights_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.meta_ad_posts
    ADD CONSTRAINT meta_ad_posts_pkey PRIMARY KEY (org_id, ad_id);



ALTER TABLE ONLY public.meta_assets
    ADD CONSTRAINT meta_assets_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.meta_connections
    ADD CONSTRAINT meta_connections_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.meta_lead_attribution
    ADD CONSTRAINT meta_lead_attribution_org_id_channel_sender_id_key UNIQUE (org_id, channel, sender_id);



ALTER TABLE ONLY public.meta_lead_attribution
    ADD CONSTRAINT meta_lead_attribution_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.meta_post_insights
    ADD CONSTRAINT meta_post_insights_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.meta_post_media
    ADD CONSTRAINT meta_post_media_pkey PRIMARY KEY (org_id, platform, post_id);



ALTER TABLE ONLY public.meta_sync_jobs
    ADD CONSTRAINT meta_sync_jobs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.naming_series_counters
    ADD CONSTRAINT naming_series_counters_pkey PRIMARY KEY (org_id, prefix);



ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.notif_log
    ADD CONSTRAINT notif_log_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.notif_rules
    ADD CONSTRAINT notif_rules_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.org_areas
    ADD CONSTRAINT org_areas_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.org_provision_runs
    ADD CONSTRAINT org_provision_runs_pkey PRIMARY KEY (org_id);



ALTER TABLE ONLY public.org_roles
    ADD CONSTRAINT org_roles_pkey PRIMARY KEY (org_id, key);



ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (organization_id, profile_id);



ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);



ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pending_channel_claims
    ADD CONSTRAINT pending_channel_claims_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.permission_roles
    ADD CONSTRAINT permission_roles_pkey PRIMARY KEY (key);



ALTER TABLE ONLY public.permission_rules
    ADD CONSTRAINT permission_rules_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.personal_agents
    ADD CONSTRAINT personal_agents_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.personal_agents
    ADD CONSTRAINT personal_agents_profile_id_unique UNIQUE (profile_id);



ALTER TABLE ONLY public.plugin_org_disabled
    ADD CONSTRAINT plugin_org_disabled_pkey PRIMARY KEY (org_id, gateway_id, plugin_id);



ALTER TABLE ONLY public.pos_client_ledger
    ADD CONSTRAINT pos_client_ledger_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pos_emissions
    ADD CONSTRAINT pos_emissions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pos_package_grants
    ADD CONSTRAINT pos_package_grants_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pos_package_redemptions
    ADD CONSTRAINT pos_package_redemptions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pos_payment_plans
    ADD CONSTRAINT pos_payment_plans_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pos_payments
    ADD CONSTRAINT pos_payments_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pos_series
    ADD CONSTRAINT pos_series_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pos_settings
    ADD CONSTRAINT pos_settings_pkey PRIMARY KEY (org_id);



ALTER TABLE ONLY public.pos_shifts
    ADD CONSTRAINT pos_shifts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pos_ticket_lines
    ADD CONSTRAINT pos_ticket_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pos_tickets
    ADD CONSTRAINT pos_tickets_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.proj_projects
    ADD CONSTRAINT proj_projects_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.proj_tasks
    ADD CONSTRAINT proj_tasks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.proj_templates
    ADD CONSTRAINT proj_templates_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.proj_timesheets
    ADD CONSTRAINT proj_timesheets_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pulse_proposals
    ADD CONSTRAINT pulse_proposals_org_id_dedup_key_key UNIQUE (org_id, dedup_key);



ALTER TABLE ONLY public.pulse_proposals
    ADD CONSTRAINT pulse_proposals_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.pulse_settings
    ADD CONSTRAINT pulse_settings_pkey PRIMARY KEY (org_id);



ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sched_availability
    ADD CONSTRAINT sched_availability_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sched_booking_status_log
    ADD CONSTRAINT sched_booking_status_log_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sched_bookings
    ADD CONSTRAINT sched_bookings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sched_event_kinds
    ADD CONSTRAINT sched_event_kinds_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sched_event_type_resources
    ADD CONSTRAINT sched_event_type_resources_pkey PRIMARY KEY (event_type_id, resource_id);



ALTER TABLE ONLY public.sched_event_types
    ADD CONSTRAINT sched_event_types_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sched_links
    ADD CONSTRAINT sched_links_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sched_reminder_config
    ADD CONSTRAINT sched_reminder_config_pkey PRIMARY KEY (org_id);



ALTER TABLE ONLY public.sched_reminders
    ADD CONSTRAINT sched_reminders_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sched_resources
    ADD CONSTRAINT sched_resources_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sched_schedules
    ADD CONSTRAINT sched_schedules_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.server_backups
    ADD CONSTRAINT server_backups_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.server_provision_configs
    ADD CONSTRAINT server_provision_configs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.session_tasks
    ADD CONSTRAINT session_tasks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.skill_execution_stats
    ADD CONSTRAINT skill_execution_stats_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_skill_key_gateway_id_pk PRIMARY KEY (skill_key, gateway_id);



ALTER TABLE ONLY public.stk_accruals
    ADD CONSTRAINT stk_accruals_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.stk_bins
    ADD CONSTRAINT stk_bins_pkey PRIMARY KEY (org_id, item_id, warehouse_id);



ALTER TABLE ONLY public.stk_consumption
    ADD CONSTRAINT stk_consumption_org_id_fin_product_id_item_id_key UNIQUE (org_id, fin_product_id, item_id);



ALTER TABLE ONLY public.stk_consumption
    ADD CONSTRAINT stk_consumption_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.stk_entries
    ADD CONSTRAINT stk_entries_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.stk_entry_lines
    ADD CONSTRAINT stk_entry_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.stk_item_components
    ADD CONSTRAINT stk_item_components_org_id_parent_item_id_child_item_id_key UNIQUE (org_id, parent_item_id, child_item_id);



ALTER TABLE ONLY public.stk_item_components
    ADD CONSTRAINT stk_item_components_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.stk_items
    ADD CONSTRAINT stk_items_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.stk_ledger
    ADD CONSTRAINT stk_ledger_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.stk_warehouses
    ADD CONSTRAINT stk_warehouses_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.support_issues
    ADD CONSTRAINT support_issues_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.support_settings
    ADD CONSTRAINT support_settings_pkey PRIMARY KEY (org_id);



ALTER TABLE ONLY public.tag_links
    ADD CONSTRAINT tag_links_pkey PRIMARY KEY (entity_kind, entity_id, tag_id);



ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.user_agents
    ADD CONSTRAINT user_agents_user_id_agent_id_gateway_id_pk PRIMARY KEY (user_id, agent_id, gateway_id);



ALTER TABLE ONLY public.user_gateway
    ADD CONSTRAINT user_gateway_profile_id_gateway_id_pk PRIMARY KEY (profile_id, gateway_id);



ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workflow_defs
    ADD CONSTRAINT workflow_defs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workshop_comparison_outputs
    ADD CONSTRAINT workshop_comparison_outputs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workshop_comparison_runs
    ADD CONSTRAINT workshop_comparison_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workshop_groupchat_agents
    ADD CONSTRAINT workshop_groupchat_agents_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workshop_groupchat_messages
    ADD CONSTRAINT workshop_groupchat_messages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workshop_groupchat_runs
    ADD CONSTRAINT workshop_groupchat_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workshop_prompt_categories
    ADD CONSTRAINT workshop_prompt_categories_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workshop_rankings
    ADD CONSTRAINT workshop_rankings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workshop_saves
    ADD CONSTRAINT workshop_saves_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workspace_membership
    ADD CONSTRAINT workspace_membership_user_id_paperclip_company_id_pk PRIMARY KEY (user_id, paperclip_company_id);



CREATE INDEX agent_artifact_revisions_org_artifact_idx ON public.agent_artifact_revisions USING btree (org_id, artifact_id, version);



CREATE INDEX agent_artifacts_org_agent_idx ON public.agent_artifacts USING btree (org_id, agent_id);



CREATE INDEX agent_memories_org_agent_idx ON public.agent_memories USING btree (org_id, agent_id);



CREATE INDEX agent_memories_org_category_idx ON public.agent_memories USING btree (org_id, category);



CREATE INDEX agent_memories_org_time_idx ON public.agent_memories USING btree (org_id, created_at);



CREATE UNIQUE INDEX agent_memories_source_uniq ON public.agent_memories USING btree (org_id, source, source_id) WHERE (source_id IS NOT NULL);



CREATE INDEX ai_usage_created_idx ON public.ai_usage USING btree (created_at);



CREATE INDEX ai_usage_org_created_idx ON public.ai_usage USING btree (org_id, created_at);



CREATE INDEX assignment_rules_org_idx ON public.assignment_rules USING btree (org_id, doc_type, enabled);



CREATE INDEX attachment_file_state_pending_idx ON public.attachment_file_state USING btree (org_id, COALESCE(delete_attempted_at, delete_requested_at), file_id) WHERE (state = 'deleting'::text);



CREATE INDEX attachment_links_org_file_idx ON public.attachment_links USING btree (org_id, file_id);



CREATE INDEX attachment_links_org_object_idx ON public.attachment_links USING btree (org_id, object_type, object_id);



CREATE INDEX attachment_trash_org_file_hidden_idx ON public.attachment_trash USING btree (org_id, file_id, hidden_at);



CREATE INDEX attachment_trash_org_object_idx ON public.attachment_trash USING btree (org_id, object_type, object_id);



CREATE INDEX brain_access_org_brain_idx ON public.brain_access USING btree (org_id, brain_id);



CREATE INDEX brain_chunks_document_idx ON public.brain_chunks USING btree (document_id);



CREATE INDEX brain_chunks_embedding_hnsw ON public.brain_chunks USING hnsw (embedding public.vector_cosine_ops);



CREATE INDEX brain_chunks_org_brain_idx ON public.brain_chunks USING btree (org_id, brain_id);



CREATE INDEX brain_documents_org_brain_idx ON public.brain_documents USING btree (org_id, brain_id);



CREATE INDEX brain_sources_org_brain_idx ON public.brain_sources USING btree (org_id, brain_id);



CREATE INDEX brain_sources_org_source_idx ON public.brain_sources USING btree (org_id, source_id);



CREATE UNIQUE INDEX brain_vector_generations_one_active_uniq ON public.brain_vector_generations USING btree (is_active) WHERE is_active;



CREATE INDEX brain_vector_outbox_claim_idx ON public.brain_vector_outbox USING btree (available_at, updated_at) WHERE (status = 'queued'::text);



CREATE INDEX brain_vector_outbox_expired_lease_idx ON public.brain_vector_outbox USING btree (lease_until) WHERE (status = 'running'::text);



CREATE INDEX brain_vector_outbox_org_idx ON public.brain_vector_outbox USING btree (org_id, collection_generation);



CREATE UNIQUE INDEX brains_org_id_uniq ON public.brains USING btree (org_id, id);



CREATE INDEX brains_org_idx ON public.brains USING btree (org_id);



CREATE UNIQUE INDEX brains_org_master_uniq ON public.brains USING btree (org_id) WHERE (kind = 'master'::text);



CREATE UNIQUE INDEX channel_assign_uniq ON public.channel_assignments USING btree (channel_id, target_type, target_id);



CREATE UNIQUE INDEX channel_bindings_uniq ON public.channel_bindings USING btree (channel_id, match_kind, match_peer);



CREATE UNIQUE INDEX channel_pairing_uniq_sender ON public.channel_pairing_requests USING btree (tenant_id, gateway_id, channel_type, account_id, sender_id);



CREATE INDEX channels_owner_profile_idx ON public.channels USING btree (owner_profile_id);



CREATE UNIQUE INDEX channels_uniq_type_account ON public.channels USING btree (tenant_id, gateway_id, type, account_id);



CREATE UNIQUE INDEX channels_uniq_type_label ON public.channels USING btree (tenant_id, gateway_id, type, label);



CREATE INDEX crm_activities_contact_idx ON public.crm_activities USING btree (contact_id, occurred_at);



CREATE INDEX crm_activities_org_idx ON public.crm_activities USING btree (org_id, occurred_at);



CREATE INDEX crm_contact_activity_stats_org_count_idx ON public.crm_contact_activity_stats USING btree (org_id, message_count DESC, contact_id);



CREATE INDEX crm_contact_activity_stats_org_last_idx ON public.crm_contact_activity_stats USING btree (org_id, last_contact_at DESC, contact_id);



CREATE INDEX crm_contact_identities_contact_idx ON public.crm_contact_identities USING btree (contact_id);



CREATE INDEX crm_contact_identities_lookup_idx ON public.crm_contact_identities USING btree (org_id, channel, external_id);



CREATE UNIQUE INDEX crm_contact_identity_uniq ON public.crm_contact_identities USING btree (org_id, channel, external_id);



CREATE INDEX crm_contact_tags_tag_idx ON public.crm_contact_tags USING btree (tag_id);



CREATE UNIQUE INDEX crm_contacts_human_id_uniq ON public.crm_contacts USING btree (org_id, human_id) WHERE (human_id IS NOT NULL);



CREATE INDEX crm_contacts_org_recent_idx ON public.crm_contacts USING btree (org_id, updated_at);



CREATE INDEX crm_contacts_party_idx ON public.crm_contacts USING btree (party_id);



CREATE INDEX crm_contacts_profile_idx ON public.crm_contacts USING btree (profile_id);



CREATE INDEX crm_conversation_analysis_org_last_idx ON public.crm_conversation_analysis USING btree (org_id, last_at DESC);



CREATE INDEX crm_conversation_analysis_over_answered_idx ON public.crm_conversation_analysis USING btree (org_id, over_answered);



CREATE INDEX crm_conversation_chunks_org_chat_idx ON public.crm_conversation_chunks USING btree (org_id, channel, chat_id);



CREATE UNIQUE INDEX crm_conversation_chunks_uniq ON public.crm_conversation_chunks USING btree (org_id, channel, chat_id, chunk_index);



CREATE INDEX crm_conversation_index_ingested_idx ON public.crm_conversation_index USING btree (org_id, last_ingested_at);



CREATE INDEX crm_conversation_index_pending_idx ON public.crm_conversation_index USING btree (org_id) WHERE (analyzed_at IS NULL);



CREATE INDEX crm_message_sentiment_org_analyzed_idx ON public.crm_message_sentiment USING btree (org_id, analyzed_at DESC) INCLUDE (score);



CREATE INDEX crm_message_sentiment_org_time_idx ON public.crm_message_sentiment USING btree (org_id, analyzed_at);



CREATE INDEX crm_sentiment_chat_daily_org_day_idx ON public.crm_sentiment_chat_daily USING btree (org_id, day) INCLUDE (score, message_count);



CREATE INDEX crm_tags_org_idx ON public.crm_tags USING btree (org_id);



CREATE UNIQUE INDEX crm_tags_org_name_uniq ON public.crm_tags USING btree (org_id, name);



CREATE INDEX crm_win_embeddings_vec_idx ON public.crm_win_embeddings USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='10');



CREATE INDEX doc_audit_log_ref_idx ON public.doc_audit_log USING btree (org_id, ref_type, ref_id, occurred_at);



CREATE INDEX doc_comments_ref_idx ON public.doc_comments USING btree (org_id, ref_type, ref_id, created_at);



CREATE INDEX email_ledger_expires_idx ON public.email_ledger USING btree (expires_at);



CREATE INDEX email_ledger_org_processed_idx ON public.email_ledger USING btree (org_id, processed_at DESC);



CREATE INDEX email_opens_user_idx ON public.email_opens USING btree (user_id, opened_at DESC);



CREATE INDEX fin_clients_org_dni_idx ON public.fin_clients USING btree (org_id, doc_number);



CREATE INDEX fin_clients_party_idx ON public.fin_clients USING btree (party_id);



CREATE UNIQUE INDEX fin_clients_provider_ref_uniq ON public.fin_clients USING btree (org_id, provider, provider_ref);



CREATE INDEX fin_invoice_items_invoice_idx ON public.fin_invoice_items USING btree (invoice_id);



CREATE INDEX fin_invoice_items_product_idx ON public.fin_invoice_items USING btree (product_id);



CREATE INDEX fin_invoices_client_idx ON public.fin_invoices USING btree (client_id);



CREATE INDEX fin_invoices_org_dni_idx ON public.fin_invoices USING btree (org_id, client_doc_number);



CREATE INDEX fin_invoices_org_issued_idx ON public.fin_invoices USING btree (org_id, issued_at);



CREATE UNIQUE INDEX fin_invoices_provider_ref_uniq ON public.fin_invoices USING btree (org_id, provider, provider_ref);



CREATE INDEX fin_payments_invoice_idx ON public.fin_payments USING btree (invoice_id);



CREATE INDEX fin_payments_org_paid_idx ON public.fin_payments USING btree (org_id, paid_at);



CREATE INDEX fin_product_components_org_bundle_idx ON public.fin_product_components USING btree (org_id, bundle_product_id);



CREATE INDEX fin_product_components_org_child_idx ON public.fin_product_components USING btree (org_id, child_product_id);



CREATE INDEX fin_products_org_aliases_idx ON public.fin_products USING gin (((metadata -> 'aliases'::text)) jsonb_path_ops);



CREATE UNIQUE INDEX fin_products_org_code_uniq ON public.fin_products USING btree (org_id, code);



CREATE INDEX fin_products_org_sku_idx ON public.fin_products USING btree (org_id, sku);



CREATE UNIQUE INDEX fin_purchase_periods_org_period_uniq ON public.fin_purchase_periods USING btree (org_id, period);



CREATE INDEX fin_purchases_org_period_idx ON public.fin_purchases USING btree (org_id, period);



CREATE UNIQUE INDEX fin_purchases_org_provider_ref_uniq ON public.fin_purchases USING btree (org_id, provider_ref) WHERE (provider_ref IS NOT NULL);



CREATE UNIQUE INDEX fin_statement_imports_org_id_uniq ON public.fin_statement_imports USING btree (org_id, id);



CREATE INDEX fin_statement_imports_org_idx ON public.fin_statement_imports USING btree (org_id, created_at);



CREATE UNIQUE INDEX fin_statement_imports_org_sha_uniq ON public.fin_statement_imports USING btree (org_id, content_sha256);



CREATE UNIQUE INDEX fin_sync_jobs_active_uq ON public.fin_sync_jobs USING btree (org_id, provider) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));



CREATE INDEX fin_sync_jobs_org_provider_created_idx ON public.fin_sync_jobs USING btree (org_id, provider, created_at);



CREATE INDEX fin_sync_jobs_status_heartbeat_idx ON public.fin_sync_jobs USING btree (status, heartbeat_at);



CREATE UNIQUE INDEX fin_transactions_import_row_uniq ON public.fin_transactions USING btree (import_id, source_row);



CREATE INDEX fin_transactions_org_posted_idx ON public.fin_transactions USING btree (org_id, posted_on DESC);



CREATE INDEX fin_transactions_party_idx ON public.fin_transactions USING btree (party_id);



CREATE INDEX flow_groups_owner_idx ON public.flow_groups USING btree (user_id, tenant_id);



CREATE INDEX flow_runs_flow_idx ON public.flow_runs USING btree (flow_id, started_at);



CREATE UNIQUE INDEX flow_var_exports_org_flow_key_uniq ON public.flow_var_exports USING btree (org_id, flow_id, var_key);



CREATE INDEX flows_tenant_updated_idx ON public.flows USING btree (tenant_id, updated_at);



CREATE INDEX gateway_org_channel_idx ON public.gateway USING btree (org_id, channel);



CREATE UNIQUE INDEX gateway_uniq_url_org_channel ON public.gateway USING btree (url, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), channel);



CREATE INDEX hr_employees_org_idx ON public.hr_employees USING btree (org_id);



CREATE UNIQUE INDEX hr_employees_org_profile_uniq ON public.hr_employees USING btree (org_id, profile_id) WHERE (profile_id IS NOT NULL);



CREATE UNIQUE INDEX hr_employees_org_resource_uniq ON public.hr_employees USING btree (org_id, resource_id) WHERE (resource_id IS NOT NULL);



CREATE UNIQUE INDEX hr_holidays_org_date_uniq ON public.hr_holidays USING btree (org_id, date);



CREATE UNIQUE INDEX hr_holidays_org_source_key_uniq ON public.hr_holidays USING btree (org_id, source_key) WHERE (source_key IS NOT NULL);



CREATE INDEX hr_leave_allocations_employee_idx ON public.hr_leave_allocations USING btree (employee_id);



CREATE INDEX hr_leave_requests_employee_idx ON public.hr_leave_requests USING btree (employee_id, from_date);



CREATE INDEX hr_leave_requests_org_status_idx ON public.hr_leave_requests USING btree (org_id, status);



CREATE UNIQUE INDEX hr_leave_types_org_code_uniq ON public.hr_leave_types USING btree (org_id, code);



CREATE INDEX idx_agent_built_skills_gateway_agent ON public.agent_built_skills USING btree (gateway_agent_id);



CREATE INDEX idx_agent_built_skills_tenant ON public.agent_built_skills USING btree (tenant_id);



CREATE INDEX idx_agent_groups_profile ON public.agent_groups USING btree (profile_id, tenant_id);



CREATE INDEX idx_backup_configs_tenant ON public.backup_configs USING btree (tenant_id);



CREATE INDEX idx_bgjobs_ref ON public.bg_jobs USING btree (ref_id);



CREATE INDEX idx_bgjobs_status ON public.bg_jobs USING btree (status);



CREATE INDEX idx_bgjobs_tenant ON public.bg_jobs USING btree (tenant_id);



CREATE INDEX idx_built_agent_skills_agent ON public.built_agent_skills USING btree (agent_id);



CREATE INDEX idx_built_agents_gateway ON public.built_agents USING btree (gateway_id);



CREATE INDEX idx_built_agents_runtime_agent ON public.built_agents USING btree (runtime_agent_id) WHERE (runtime_agent_id IS NOT NULL);



CREATE INDEX idx_built_agents_tenant ON public.built_agents USING btree (tenant_id);



CREATE INDEX idx_built_chapter_edges_skill ON public.built_chapter_edges USING btree (skill_id);



CREATE INDEX idx_built_chapter_tools_chapter ON public.built_chapter_tools USING btree (chapter_id);



CREATE INDEX idx_built_chapters_skill ON public.built_chapters USING btree (skill_id);



CREATE INDEX idx_built_skill_tools_skill ON public.built_skill_tools USING btree (skill_id);



CREATE INDEX idx_built_skills_gateway ON public.built_skills USING btree (gateway_id);



CREATE INDEX idx_built_skills_tenant ON public.built_skills USING btree (tenant_id);



CREATE INDEX idx_built_tools_gateway ON public.built_tools USING btree (gateway_id);



CREATE INDEX idx_built_tools_tenant ON public.built_tools USING btree (tenant_id);



CREATE INDEX idx_channel_assign_channel ON public.channel_assignments USING btree (channel_id);



CREATE INDEX idx_channel_bindings_channel ON public.channel_bindings USING btree (channel_id);



CREATE UNIQUE INDEX idx_channel_identity_unique ON public.channel_identities USING btree (channel, channel_user_id);



CREATE INDEX idx_channel_identity_user ON public.channel_identities USING btree (user_id);



CREATE INDEX idx_channel_pairing_lookup ON public.channel_pairing_requests USING btree (tenant_id, gateway_id, channel_type, account_id);



CREATE INDEX idx_channels_tenant_gateway ON public.channels USING btree (tenant_id, gateway_id);



CREATE INDEX idx_chat_by_agent ON public.chat_messages USING btree (agent_id, session_key, "timestamp");



CREATE INDEX idx_chat_tenant ON public.chat_messages USING btree (tenant_id);



CREATE UNIQUE INDEX idx_config_snapshots_gateway ON public.config_snapshots USING btree (gateway_id);



CREATE INDEX idx_files_tenant ON public.files USING btree (tenant_id);



CREATE INDEX idx_gateway_legacy ON public.gateway USING btree (legacy_server_id);



CREATE INDEX idx_idsub_identity ON public.identity_subscriptions USING btree (identity_id);



CREATE INDEX idx_idsub_subscriber ON public.identity_subscriptions USING btree (subscriber_profile_id);



CREATE INDEX idx_marketplace_installs_agent ON public.marketplace_installs USING btree (agent_id);



CREATE INDEX idx_marketplace_installs_tenant ON public.marketplace_installs USING btree (tenant_id);



CREATE INDEX idx_missions_gateway ON public.missions USING btree (gateway_id);



CREATE INDEX idx_missions_session ON public.missions USING btree (session_id);



CREATE INDEX idx_missions_tenant ON public.missions USING btree (tenant_id);



CREATE INDEX idx_org_members_org ON public.organization_members USING btree (organization_id);



CREATE INDEX idx_org_members_profile ON public.organization_members USING btree (profile_id);



CREATE INDEX idx_personal_agents_agent ON public.personal_agents USING btree (agent_id);



CREATE INDEX idx_personal_agents_profile ON public.personal_agents USING btree (profile_id);



CREATE INDEX idx_personal_agents_status ON public.personal_agents USING btree (provisioning_status);



CREATE INDEX idx_provision_configs_tenant ON public.server_provision_configs USING btree (tenant_id);



CREATE INDEX idx_server_backups_gateway ON public.server_backups USING btree (gateway_id);



CREATE INDEX idx_server_backups_tenant ON public.server_backups USING btree (tenant_id);



CREATE INDEX idx_session_tasks_gateway_session ON public.session_tasks USING btree (gateway_id, session_key);



CREATE INDEX idx_session_tasks_tenant ON public.session_tasks USING btree (tenant_id);



CREATE INDEX idx_sessions_gateway ON public.sessions USING btree (gateway_id);



CREATE INDEX idx_sessions_tenant ON public.sessions USING btree (tenant_id);



CREATE INDEX idx_settings_tenant ON public.settings USING btree (tenant_id);



CREATE INDEX idx_skill_stats_gateway_skill_time ON public.skill_execution_stats USING btree (gateway_id, skill_name, occurred_at);



CREATE INDEX idx_skill_stats_tenant ON public.skill_execution_stats USING btree (tenant_id);



CREATE INDEX idx_skills_tenant ON public.skills USING btree (tenant_id);



CREATE INDEX idx_tasks_mission ON public.tasks USING btree (mission_id);



CREATE INDEX idx_tasks_tenant ON public.tasks USING btree (tenant_id);



CREATE INDEX idx_user_agents_gateway ON public.user_agents USING btree (gateway_id);



CREATE INDEX idx_user_gateway_gateway ON public.user_gateway USING btree (gateway_id);



CREATE UNIQUE INDEX idx_user_identity_unique ON public.user_identities USING btree (provider, external_id);



CREATE INDEX idx_user_identity_user ON public.user_identities USING btree (user_id);



CREATE INDEX idx_user_prefs_profile ON public.user_preferences USING btree (profile_id);



CREATE INDEX idx_wco_run ON public.workshop_comparison_outputs USING btree (run_id);



CREATE INDEX idx_wcr_tenant ON public.workshop_comparison_runs USING btree (tenant_id);



CREATE INDEX idx_wga_run ON public.workshop_groupchat_agents USING btree (run_id);



CREATE INDEX idx_wgm_run ON public.workshop_groupchat_messages USING btree (run_id);



CREATE INDEX idx_wgr_status ON public.workshop_groupchat_runs USING btree (status);



CREATE INDEX idx_wgr_tenant ON public.workshop_groupchat_runs USING btree (tenant_id);



CREATE INDEX idx_workspace_membership_user ON public.workspace_membership USING btree (user_id);



CREATE INDEX idx_wr_model ON public.workshop_rankings USING btree (model_id);



CREATE INDEX idx_wr_run ON public.workshop_rankings USING btree (run_id);



CREATE INDEX job_effect_batches_owner ON public.job_effect_batches USING btree (tenant_id, reservation_job_id);



CREATE UNIQUE INDEX job_effect_batches_tenant_id ON public.job_effect_batches USING btree (tenant_id, id);



CREATE UNIQUE INDEX job_effect_pages_job_key ON public.job_effect_pages USING btree (tenant_id, job_id, page_key);



CREATE UNIQUE INDEX job_effect_units_position ON public.job_effect_units USING btree (tenant_id, batch_id, vector_index) WHERE (batch_id IS NOT NULL);



CREATE UNIQUE INDEX job_effect_units_semantic ON public.job_effect_units USING btree (tenant_id, head_id, revision, source_hash, manifest_hash, chunk_key, payload_hash, policy_hash);



CREATE UNIQUE INDEX job_effects_head_identity ON public.job_effects USING btree (tenant_id, family, entity_id) WHERE (kind = 'head'::text);



CREATE INDEX job_effects_revision ON public.job_effects USING btree (tenant_id, family, entity_id, revision);



CREATE UNIQUE INDEX job_effects_tenant_id_kind ON public.job_effects USING btree (tenant_id, id, kind);



CREATE UNIQUE INDEX job_effects_unit_identity ON public.job_effects USING btree (tenant_id, family, entity_id, revision, unit) WHERE (kind = 'effect'::text);



CREATE INDEX knowledge_chunks_chunk_text_trgm_gin ON public.knowledge_chunks USING gin (lower(chunk_text) public.gin_trgm_ops);



COMMENT ON INDEX public.knowledge_chunks_chunk_text_trgm_gin IS 'Supports bounded Brain word-similarity candidates via lower(chunk_text) %> query token';



CREATE INDEX knowledge_chunks_org_source_document_idx ON public.knowledge_chunks USING btree (org_id, source_id, document_id);



CREATE INDEX knowledge_chunks_org_source_occurred_idx ON public.knowledge_chunks USING btree (org_id, source_id, occurred_at DESC);



CREATE INDEX knowledge_chunks_org_source_unembedded_idx ON public.knowledge_chunks USING btree (org_id, source_id) WHERE (embedding IS NULL);



CREATE INDEX knowledge_chunks_search_gin ON public.knowledge_chunks USING gin (search_vector);



CREATE INDEX knowledge_documents_org_source_status_idx ON public.knowledge_documents USING btree (org_id, source_id, status);



CREATE INDEX knowledge_documents_org_source_updated_idx ON public.knowledge_documents USING btree (org_id, source_id, source_updated_at DESC);



CREATE INDEX knowledge_sources_org_status_idx ON public.knowledge_sources USING btree (org_id, status);



CREATE INDEX member_roles_profile_idx ON public.member_roles USING btree (org_id, profile_id);



CREATE INDEX membership_cycles_org_idx ON public.membership_cycles USING btree (org_id, created_at);



CREATE UNIQUE INDEX membership_cycles_uniq ON public.membership_cycles USING btree (membership_id, cycle_no);



CREATE INDEX membership_plans_org_idx ON public.membership_plans USING btree (org_id, enabled);



CREATE INDEX memberships_contact_idx ON public.memberships USING btree (crm_contact_id);



CREATE INDEX memberships_org_status_idx ON public.memberships USING btree (org_id, status, next_cycle_date);



CREATE INDEX messages_conversation_corpus_scan_idx ON public.messages USING btree (org_id, lower(TRIM(BOTH FROM channel)), COALESCE(NULLIF(TRIM(BOTH FROM account_id), ''::text), 'default'::text), chat_id, COALESCE(occurred_at, created_at), id) WHERE ((NULLIF(TRIM(BOTH FROM chat_id), ''::text) IS NOT NULL) AND (COALESCE(is_group, false) = false) AND (is_bot IS NOT TRUE) AND (NULLIF(TRIM(BOTH FROM content), ''::text) IS NOT NULL));



CREATE INDEX messages_crm_agg_covering_idx ON public.messages USING btree (org_id, channel, chat_id) INCLUDE (occurred_at, created_at, direction) WHERE (is_bot IS NOT TRUE);



CREATE INDEX messages_crm_insights_inbound_time_idx ON public.messages USING btree (org_id, COALESCE(occurred_at, created_at)) WHERE ((direction = 'inbound'::text) AND (is_bot IS NOT TRUE));



CREATE INDEX messages_crm_insights_rollup_time_idx ON public.messages USING btree (COALESCE(occurred_at, created_at)) WHERE ((direction = 'inbound'::text) AND (is_bot IS NOT TRUE) AND (content IS NOT NULL) AND (length(TRIM(BOTH FROM content)) > 0));



CREATE INDEX messages_org_agent_idx ON public.messages USING btree (org_id, agent_id);



CREATE UNIQUE INDEX messages_org_channel_account_msg_uniq ON public.messages USING btree (org_id, channel, account_id, message_id) WHERE (message_id IS NOT NULL);



CREATE INDEX messages_org_channel_sender_idx ON public.messages USING btree (org_id, channel, sender_id);



CREATE INDEX messages_org_chat_idx ON public.messages USING btree (org_id, channel, chat_id, occurred_at);



CREATE UNIQUE INDEX messages_org_client_id_uniq ON public.messages USING btree (org_id, client_id);



CREATE INDEX messages_org_time_idx ON public.messages USING btree (org_id, occurred_at);



CREATE INDEX meta_ad_insights_org_account_date_idx ON public.meta_ad_insights USING btree (org_id, ad_account_id, date);



CREATE UNIQUE INDEX meta_ad_insights_org_ad_date_uniq ON public.meta_ad_insights USING btree (org_id, ad_id, date);



CREATE INDEX meta_ad_insights_org_date_idx ON public.meta_ad_insights USING btree (org_id, date);



CREATE INDEX meta_assets_connection_idx ON public.meta_assets USING btree (connection_id);



CREATE UNIQUE INDEX meta_assets_org_kind_ext_uniq ON public.meta_assets USING btree (org_id, kind, external_id);



CREATE INDEX meta_connections_org_idx ON public.meta_connections USING btree (org_id);



CREATE UNIQUE INDEX meta_connections_org_kind_fbuser_uniq ON public.meta_connections USING btree (org_id, kind, fb_user_id);



CREATE INDEX meta_lead_attribution_org_campaign_idx ON public.meta_lead_attribution USING btree (org_id, campaign_id);



CREATE INDEX meta_lead_attribution_org_origin_idx ON public.meta_lead_attribution USING btree (org_id, origin);



CREATE INDEX meta_post_insights_asset_idx ON public.meta_post_insights USING btree (asset_id);



CREATE INDEX meta_post_insights_org_period_post_idx ON public.meta_post_insights USING btree (org_id, period, post_id);



CREATE UNIQUE INDEX meta_post_insights_org_post_metric_period_uniq ON public.meta_post_insights USING btree (org_id, post_id, metric, period);



CREATE INDEX meta_post_media_org_status_idx ON public.meta_post_media USING btree (org_id, status);



CREATE UNIQUE INDEX meta_sync_jobs_active_uq ON public.meta_sync_jobs USING btree (org_id, kind) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));



CREATE INDEX meta_sync_jobs_org_kind_created_idx ON public.meta_sync_jobs USING btree (org_id, kind, created_at);



CREATE INDEX notes_owner_idx ON public.notes USING btree (tenant_id, user_id);



CREATE INDEX notes_updated_idx ON public.notes USING btree (updated_at);



CREATE INDEX notif_log_org_idx ON public.notif_log USING btree (org_id, created_at);



CREATE UNIQUE INDEX notif_log_rule_entity_key_uniq ON public.notif_log USING btree (rule_id, entity_id, trigger_key);



CREATE INDEX notif_rules_org_idx ON public.notif_rules USING btree (org_id);



CREATE INDEX org_areas_org_idx ON public.org_areas USING btree (organization_id, sort_order);



CREATE UNIQUE INDEX org_areas_org_slug_uniq ON public.org_areas USING btree (organization_id, slug);



CREATE INDEX org_roles_org_idx ON public.org_roles USING btree (org_id);



CREATE UNIQUE INDEX organizations_paperclip_company_id_key ON public.organizations USING btree (paperclip_company_id) WHERE (paperclip_company_id IS NOT NULL);



CREATE UNIQUE INDEX parties_org_agent_uniq ON public.parties USING btree (org_id, agent_id) WHERE (agent_id IS NOT NULL);



CREATE INDEX parties_org_doc_idx ON public.parties USING btree (org_id, doc_number);



CREATE UNIQUE INDEX parties_org_doc_uniq ON public.parties USING btree (org_id, doc_number) WHERE (doc_number IS NOT NULL);



CREATE INDEX parties_org_idx ON public.parties USING btree (org_id);



CREATE INDEX parties_org_phone9_idx ON public.parties USING btree (org_id, phone9);



CREATE INDEX pending_claim_expires_idx ON public.pending_channel_claims USING btree (expires_at);



CREATE UNIQUE INDEX pending_claim_live_uniq ON public.pending_channel_claims USING btree (user_id, channel, channel_user_id) WHERE ((consumed_at IS NULL) AND (channel_user_id IS NOT NULL));



CREATE UNIQUE INDEX pending_claim_token_uniq ON public.pending_channel_claims USING btree (start_token) WHERE (start_token IS NOT NULL);



CREATE INDEX pending_claim_user_idx ON public.pending_channel_claims USING btree (user_id, created_at);



CREATE UNIQUE INDEX permission_rules_scope_uniq ON public.permission_rules USING btree (org_id, role_key, module);



CREATE INDEX plugin_org_disabled_gateway_idx ON public.plugin_org_disabled USING btree (gateway_id);



CREATE INDEX pos_client_ledger_org_contact_idx ON public.pos_client_ledger USING btree (org_id, crm_contact_id);



CREATE INDEX pos_client_ledger_org_party_idx ON public.pos_client_ledger USING btree (org_id, party_id);



CREATE UNIQUE INDEX pos_emissions_org_doc_serie_correlativo_uniq ON public.pos_emissions USING btree (org_id, doc_type, serie, correlativo);



CREATE INDEX pos_emissions_org_ticket_idx ON public.pos_emissions USING btree (org_id, ticket_id);



CREATE INDEX pos_package_grants_org_contact_idx ON public.pos_package_grants USING btree (org_id, crm_contact_id);



CREATE INDEX pos_package_grants_org_party_idx ON public.pos_package_grants USING btree (org_id, party_id);



CREATE INDEX pos_package_grants_org_ticket_idx ON public.pos_package_grants USING btree (org_id, source_ticket_id);



CREATE UNIQUE INDEX pos_package_redemptions_live_booking_uniq ON public.pos_package_redemptions USING btree (org_id, booking_id) WHERE ((booking_id IS NOT NULL) AND (reversed_at IS NULL));



CREATE INDEX pos_package_redemptions_org_booking_idx ON public.pos_package_redemptions USING btree (org_id, booking_id);



CREATE INDEX pos_package_redemptions_org_grant_idx ON public.pos_package_redemptions USING btree (org_id, grant_id);



CREATE INDEX pos_package_redemptions_org_ticket_idx ON public.pos_package_redemptions USING btree (org_id, ticket_id);



CREATE UNIQUE INDEX pos_package_redemptions_ticket_line_uniq ON public.pos_package_redemptions USING btree (org_id, ticket_line_id) WHERE (ticket_line_id IS NOT NULL);



CREATE INDEX pos_payment_plans_org_booking_idx ON public.pos_payment_plans USING btree (org_id, booking_id);



CREATE INDEX pos_payment_plans_org_contact_idx ON public.pos_payment_plans USING btree (org_id, crm_contact_id);



CREATE INDEX pos_payment_plans_org_party_idx ON public.pos_payment_plans USING btree (org_id, party_id);



CREATE INDEX pos_payment_plans_org_status_idx ON public.pos_payment_plans USING btree (org_id, status);



CREATE INDEX pos_payments_org_shift_idx ON public.pos_payments USING btree (org_id, shift_id);



CREATE INDEX pos_payments_ticket_idx ON public.pos_payments USING btree (ticket_id);



CREATE UNIQUE INDEX pos_series_one_active_per_env ON public.pos_series USING btree (org_id, doc_type, environment) WHERE active;



CREATE UNIQUE INDEX pos_series_org_doc_serie_uniq ON public.pos_series USING btree (org_id, doc_type, serie);



CREATE UNIQUE INDEX pos_shifts_one_open_per_org ON public.pos_shifts USING btree (org_id) WHERE (status = 'open'::text);



CREATE INDEX pos_ticket_lines_org_pending_scheduling_idx ON public.pos_ticket_lines USING btree (org_id, ticket_id) WHERE ((booking_id IS NULL) AND (kind = 'service'::text));



CREATE INDEX pos_ticket_lines_org_plan_idx ON public.pos_ticket_lines USING btree (org_id, plan_id) WHERE (plan_id IS NOT NULL);



CREATE INDEX pos_ticket_lines_org_product_idx ON public.pos_ticket_lines USING btree (org_id, fin_product_id);



CREATE INDEX pos_ticket_lines_org_redemption_idx ON public.pos_ticket_lines USING btree (org_id, redemption_id) WHERE (redemption_id IS NOT NULL);



CREATE INDEX pos_ticket_lines_org_ticket_idx ON public.pos_ticket_lines USING btree (org_id, ticket_id);



CREATE INDEX pos_tickets_org_party_idx ON public.pos_tickets USING btree (org_id, party_id);



CREATE INDEX pos_tickets_org_shift_idx ON public.pos_tickets USING btree (org_id, shift_id);



CREATE INDEX pos_tickets_org_submitted_idx ON public.pos_tickets USING btree (org_id, submitted_at);



CREATE UNIQUE INDEX profiles_alias_key ON public.profiles USING btree (alias) WHERE (alias IS NOT NULL);



CREATE UNIQUE INDEX profiles_username_key ON public.profiles USING btree (username);



CREATE INDEX proj_projects_customer_idx ON public.proj_projects USING btree (customer_party_id);



CREATE INDEX proj_projects_lead_idx ON public.proj_projects USING btree (lead_party_id);



CREATE INDEX proj_projects_org_created_idx ON public.proj_projects USING btree (org_id, created_at);



CREATE UNIQUE INDEX proj_projects_org_human_uniq ON public.proj_projects USING btree (org_id, human_id) WHERE (human_id IS NOT NULL);



CREATE INDEX proj_projects_org_status_idx ON public.proj_projects USING btree (org_id, status);



CREATE INDEX proj_tasks_org_assignee_status_idx ON public.proj_tasks USING btree (org_id, assignee_party_id, status);



CREATE UNIQUE INDEX proj_tasks_org_human_uniq ON public.proj_tasks USING btree (org_id, human_id) WHERE (human_id IS NOT NULL);



CREATE INDEX proj_tasks_org_milestone_idx ON public.proj_tasks USING btree (org_id, milestone_id);



CREATE INDEX proj_tasks_org_parent_idx ON public.proj_tasks USING btree (org_id, parent_id);



CREATE INDEX proj_tasks_org_project_status_idx ON public.proj_tasks USING btree (org_id, project_id, status);



CREATE INDEX proj_templates_org_idx ON public.proj_templates USING btree (org_id);



CREATE INDEX proj_timesheets_org_party_idx ON public.proj_timesheets USING btree (org_id, party_id);



CREATE INDEX proj_timesheets_org_project_idx ON public.proj_timesheets USING btree (org_id, project_id);



CREATE INDEX proj_timesheets_org_spent_idx ON public.proj_timesheets USING btree (org_id, spent_date);



CREATE INDEX proj_timesheets_org_task_idx ON public.proj_timesheets USING btree (org_id, task_id);



CREATE UNIQUE INDEX provision_configs_uniq_gateway ON public.server_provision_configs USING btree (gateway_id);



CREATE INDEX pulse_proposals_org_status_idx ON public.pulse_proposals USING btree (org_id, status, created_at DESC);



CREATE UNIQUE INDEX sales_orders_booking_uniq ON public.sales_orders USING btree (org_id, source_booking_id) WHERE (source_booking_id IS NOT NULL);



CREATE INDEX sales_orders_contact_idx ON public.sales_orders USING btree (crm_contact_id);



CREATE UNIQUE INDEX sales_orders_human_id_uniq ON public.sales_orders USING btree (org_id, human_id) WHERE (human_id IS NOT NULL);



CREATE INDEX sales_orders_org_created_idx ON public.sales_orders USING btree (org_id, created_at);



CREATE INDEX sales_orders_org_status_idx ON public.sales_orders USING btree (org_id, status);



CREATE INDEX sales_orders_owner_idx ON public.sales_orders USING btree (org_id, owner_id);



CREATE INDEX sales_orders_party_idx ON public.sales_orders USING btree (party_id);



CREATE INDEX sched_availability_schedule_date_idx ON public.sched_availability USING btree (schedule_id, date);



CREATE INDEX sched_availability_schedule_idx ON public.sched_availability USING btree (schedule_id);



CREATE INDEX sched_booking_status_log_org_booking_idx ON public.sched_booking_status_log USING btree (org_id, booking_id, changed_at);



CREATE INDEX sched_bookings_crm_idx ON public.sched_bookings USING btree (crm_contact_id);



CREATE INDEX sched_bookings_org_grant_idx ON public.sched_bookings USING btree (org_id, package_grant_id) WHERE (package_grant_id IS NOT NULL);



CREATE INDEX sched_bookings_org_invoice_idx ON public.sched_bookings USING btree (org_id, invoice_id) WHERE (invoice_id IS NOT NULL);



CREATE INDEX sched_bookings_org_plan_idx ON public.sched_bookings USING btree (org_id, payment_plan_id) WHERE (payment_plan_id IS NOT NULL);



CREATE INDEX sched_bookings_org_series_idx ON public.sched_bookings USING btree (org_id, series_id, series_index) WHERE (series_id IS NOT NULL);



CREATE INDEX sched_bookings_org_start_idx ON public.sched_bookings USING btree (org_id, start_time);



CREATE INDEX sched_bookings_org_status_idx ON public.sched_bookings USING btree (org_id, status);



CREATE UNIQUE INDEX sched_bookings_org_uid_uniq ON public.sched_bookings USING btree (org_id, uid);



CREATE INDEX sched_bookings_party_idx ON public.sched_bookings USING btree (party_id);



CREATE INDEX sched_bookings_resource_start_idx ON public.sched_bookings USING btree (resource_id, start_time);



CREATE INDEX sched_bookings_resource_status_start_idx ON public.sched_bookings USING btree (resource_id, status, start_time);



CREATE INDEX sched_etr_resource_idx ON public.sched_event_type_resources USING btree (resource_id);



CREATE UNIQUE INDEX sched_event_kinds_org_default_uniq ON public.sched_event_kinds USING btree (org_id) WHERE is_default;



CREATE UNIQUE INDEX sched_event_kinds_org_name_uniq ON public.sched_event_kinds USING btree (org_id, name);



CREATE INDEX sched_event_types_org_idx ON public.sched_event_types USING btree (org_id);



CREATE UNIQUE INDEX sched_event_types_org_slug_uniq ON public.sched_event_types USING btree (org_id, slug);



CREATE INDEX sched_links_org_idx ON public.sched_links USING btree (org_id);



CREATE UNIQUE INDEX sched_links_org_slug_uniq ON public.sched_links USING btree (org_id, slug);



CREATE INDEX sched_reminders_booking_idx ON public.sched_reminders USING btree (booking_id);



CREATE UNIQUE INDEX sched_reminders_booking_stage_chan_uniq ON public.sched_reminders USING btree (org_id, booking_id, stage, channel, recipient_role);



CREATE INDEX sched_reminders_org_created_idx ON public.sched_reminders USING btree (org_id, created_at);



CREATE INDEX sched_resources_org_idx ON public.sched_resources USING btree (org_id);



CREATE UNIQUE INDEX sched_resources_org_profile_uniq ON public.sched_resources USING btree (org_id, profile_id) WHERE (profile_id IS NOT NULL);



CREATE INDEX sched_schedules_org_idx ON public.sched_schedules USING btree (org_id);



CREATE INDEX sched_schedules_resource_idx ON public.sched_schedules USING btree (resource_id);



CREATE UNIQUE INDEX sessions_uniq_key ON public.sessions USING btree (tenant_id, gateway_id, session_key);



CREATE INDEX stk_accruals_org_item_wh_status_idx ON public.stk_accruals USING btree (org_id, item_id, warehouse_id, status);



CREATE UNIQUE INDEX stk_accruals_org_source_item_uniq ON public.stk_accruals USING btree (org_id, source, source_id, item_id);



CREATE INDEX stk_accruals_org_status_idx ON public.stk_accruals USING btree (org_id, status);



CREATE INDEX stk_accruals_source_idx ON public.stk_accruals USING btree (source, source_id);



CREATE INDEX stk_consumption_org_product_idx ON public.stk_consumption USING btree (org_id, fin_product_id);



CREATE UNIQUE INDEX stk_entries_org_active_invoice_issue_uniq ON public.stk_entries USING btree (org_id, lower(btrim((metadata ->> 'invoiceId'::text)))) WHERE ((type = 'issue'::text) AND (status = ANY (ARRAY['draft'::text, 'submitted'::text])) AND (jsonb_typeof((metadata -> 'invoiceId'::text)) = 'string'::text) AND (btrim((metadata ->> 'invoiceId'::text)) <> ''::text));



CREATE INDEX stk_entries_org_created_idx ON public.stk_entries USING btree (org_id, created_at);



CREATE UNIQUE INDEX stk_entries_org_human_id_uniq ON public.stk_entries USING btree (org_id, human_id) WHERE (human_id IS NOT NULL);



CREATE INDEX stk_entries_org_status_idx ON public.stk_entries USING btree (org_id, status);



CREATE INDEX stk_entry_lines_entry_idx ON public.stk_entry_lines USING btree (entry_id);



CREATE INDEX stk_entry_lines_org_idx ON public.stk_entry_lines USING btree (org_id);



CREATE INDEX stk_item_components_org_child_idx ON public.stk_item_components USING btree (org_id, child_item_id);



CREATE INDEX stk_item_components_org_parent_idx ON public.stk_item_components USING btree (org_id, parent_item_id);



CREATE INDEX stk_items_org_aliases_idx ON public.stk_items USING gin (((metadata -> 'aliases'::text)) jsonb_path_ops);



CREATE UNIQUE INDEX stk_items_org_code_uniq ON public.stk_items USING btree (org_id, code);



CREATE UNIQUE INDEX stk_items_org_fin_product_uniq ON public.stk_items USING btree (org_id, fin_product_id) WHERE (fin_product_id IS NOT NULL);



CREATE INDEX stk_items_org_idx ON public.stk_items USING btree (org_id);



CREATE INDEX stk_items_org_sku_idx ON public.stk_items USING btree (org_id, sku);



CREATE INDEX stk_items_org_supplier_idx ON public.stk_items USING btree (org_id, default_supplier_party_id) WHERE (default_supplier_party_id IS NOT NULL);



CREATE INDEX stk_ledger_entry_idx ON public.stk_ledger USING btree (entry_id);



CREATE INDEX stk_ledger_org_item_posted_idx ON public.stk_ledger USING btree (org_id, item_id, posted_at);



CREATE UNIQUE INDEX stk_warehouses_default_one_per_org ON public.stk_warehouses USING btree (org_id) WHERE is_default;



CREATE INDEX stk_warehouses_org_idx ON public.stk_warehouses USING btree (org_id);



CREATE INDEX stk_warehouses_org_parent_idx ON public.stk_warehouses USING btree (org_id, parent_id);



CREATE INDEX support_issues_contact_idx ON public.support_issues USING btree (crm_contact_id);



CREATE UNIQUE INDEX support_issues_human_id_uniq ON public.support_issues USING btree (org_id, human_id) WHERE (human_id IS NOT NULL);



CREATE INDEX support_issues_org_created_idx ON public.support_issues USING btree (org_id, created_at);



CREATE INDEX support_issues_org_status_idx ON public.support_issues USING btree (org_id, status);



CREATE INDEX support_issues_owner_idx ON public.support_issues USING btree (owner_id);



CREATE INDEX support_issues_party_idx ON public.support_issues USING btree (party_id);



CREATE INDEX tag_links_org_entity_idx ON public.tag_links USING btree (org_id, entity_kind, entity_id);



CREATE INDEX tag_links_org_tag_idx ON public.tag_links USING btree (org_id, tag_id);



CREATE UNIQUE INDEX uq_join_request_pending ON public.join_request USING btree (user_id, organization_id) WHERE (status = 'pending'::text);



CREATE UNIQUE INDEX uq_settings_gateway_section ON public.settings USING btree (gateway_id, section);



CREATE UNIQUE INDEX uq_user_prefs_profile_section ON public.user_preferences USING btree (profile_id, section);



CREATE UNIQUE INDEX uq_wpc_tenant_name ON public.workshop_prompt_categories USING btree (tenant_id, name);



CREATE UNIQUE INDEX workflow_defs_org_doctype_uniq ON public.workflow_defs USING btree (org_id, doc_type);



CREATE TRIGGER attachment_contact_soft_deleted AFTER UPDATE OF deleted_at ON public.crm_contacts FOR EACH ROW WHEN (((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL))) EXECUTE FUNCTION public.detach_deleted_record_attachments();



CREATE TRIGGER attachment_file_state_immutable BEFORE UPDATE ON public.attachment_file_state FOR EACH ROW EXECUTE FUNCTION public.guard_attachment_file_state();



CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.crm_contacts FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();



CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.fin_invoices FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();



CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.fin_products FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();



CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.pos_tickets FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();



CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.sched_bookings FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();



CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.sched_event_types FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();



CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.stk_entries FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();



CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.stk_items FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();



CREATE TRIGGER crm_contact_activity_identity_change AFTER INSERT OR DELETE OR UPDATE OF org_id, contact_id, channel, external_id ON public.crm_contact_identities FOR EACH ROW EXECUTE FUNCTION public.crm_contact_activity_on_identity_change();



CREATE TRIGGER crm_contact_activity_message_change AFTER DELETE OR UPDATE OF org_id, channel, chat_id, direction, is_bot, occurred_at, created_at ON public.messages FOR EACH ROW EXECUTE FUNCTION public.crm_contact_activity_on_message_change();



CREATE TRIGGER crm_contact_activity_message_insert AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.crm_contact_activity_on_message_insert();



CREATE CONSTRAINT TRIGGER job_effect_batches_complete AFTER INSERT OR UPDATE ON public.job_effect_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.job_effect_membership_guard();



CREATE TRIGGER job_effect_batches_guard BEFORE INSERT OR DELETE OR UPDATE ON public.job_effect_batches FOR EACH ROW EXECUTE FUNCTION public.job_effect_batches_guard();



CREATE TRIGGER job_effect_pages_guard BEFORE INSERT OR DELETE OR UPDATE ON public.job_effect_pages FOR EACH ROW EXECUTE FUNCTION public.job_effect_pages_guard();



CREATE CONSTRAINT TRIGGER job_effect_units_complete AFTER INSERT OR DELETE OR UPDATE ON public.job_effect_units DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.job_effect_membership_guard();



CREATE TRIGGER job_effect_units_guard BEFORE INSERT OR DELETE OR UPDATE ON public.job_effect_units FOR EACH ROW EXECUTE FUNCTION public.job_effect_units_guard();



CREATE TRIGGER knowledge_chunks_vector_outbox AFTER INSERT OR DELETE OR UPDATE OF content_hash, embedding_model, embedding, org_id, source_id, document_id, kind, occurred_at ON public.knowledge_chunks FOR EACH ROW EXECUTE FUNCTION public.enqueue_brain_vector_chunk();



CREATE TRIGGER managed_attachment_identity BEFORE INSERT OR UPDATE OF id, tenant_id, b2_file_key ON public.files FOR EACH ROW EXECUTE FUNCTION public.guard_managed_file_identity();



CREATE TRIGGER messages_realtime_broadcast AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.hub_broadcast_message_committed();



ALTER TABLE ONLY public.agent_artifact_revisions
    ADD CONSTRAINT agent_artifact_revisions_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.agent_artifacts(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.agent_built_skills
    ADD CONSTRAINT agent_built_skills_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.agent_built_skills
    ADD CONSTRAINT agent_built_skills_skill_id_built_skills_id_fk FOREIGN KEY (skill_id) REFERENCES public.built_skills(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.agent_group_members
    ADD CONSTRAINT agent_group_members_group_id_agent_groups_id_fk FOREIGN KEY (group_id) REFERENCES public.agent_groups(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.agent_groups
    ADD CONSTRAINT agent_groups_profile_id_profiles_id_fk FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.brain_access
    ADD CONSTRAINT brain_access_brain_id_fkey FOREIGN KEY (brain_id) REFERENCES public.brains(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.brain_chunks
    ADD CONSTRAINT brain_chunks_brain_id_fkey FOREIGN KEY (brain_id) REFERENCES public.brains(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.brain_chunks
    ADD CONSTRAINT brain_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.brain_documents(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.brain_documents
    ADD CONSTRAINT brain_documents_brain_id_fkey FOREIGN KEY (brain_id) REFERENCES public.brains(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.brain_sources
    ADD CONSTRAINT brain_sources_brain_fk FOREIGN KEY (org_id, brain_id) REFERENCES public.brains(org_id, id) ON DELETE CASCADE;



ALTER TABLE ONLY public.brain_sources
    ADD CONSTRAINT brain_sources_source_fk FOREIGN KEY (org_id, source_id) REFERENCES public.knowledge_sources(org_id, id) ON DELETE CASCADE;



ALTER TABLE ONLY public.brain_vector_outbox
    ADD CONSTRAINT brain_vector_outbox_generation_fk FOREIGN KEY (collection_generation) REFERENCES public.brain_vector_generations(generation);



ALTER TABLE ONLY public.brain_vector_reconcile_state
    ADD CONSTRAINT brain_vector_reconcile_state_collection_generation_fkey FOREIGN KEY (collection_generation) REFERENCES public.brain_vector_generations(generation);



ALTER TABLE ONLY public.built_agent_skills
    ADD CONSTRAINT built_agent_skills_agent_id_built_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.built_agents(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.built_agent_skills
    ADD CONSTRAINT built_agent_skills_skill_id_built_skills_id_fk FOREIGN KEY (skill_id) REFERENCES public.built_skills(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.built_agents
    ADD CONSTRAINT built_agents_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.built_chapter_edges
    ADD CONSTRAINT built_chapter_edges_skill_id_built_skills_id_fk FOREIGN KEY (skill_id) REFERENCES public.built_skills(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.built_chapter_edges
    ADD CONSTRAINT built_chapter_edges_source_chapter_id_built_chapters_id_fk FOREIGN KEY (source_chapter_id) REFERENCES public.built_chapters(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.built_chapter_edges
    ADD CONSTRAINT built_chapter_edges_target_chapter_id_built_chapters_id_fk FOREIGN KEY (target_chapter_id) REFERENCES public.built_chapters(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.built_chapter_tools
    ADD CONSTRAINT built_chapter_tools_chapter_id_built_chapters_id_fk FOREIGN KEY (chapter_id) REFERENCES public.built_chapters(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.built_chapters
    ADD CONSTRAINT built_chapters_skill_id_built_skills_id_fk FOREIGN KEY (skill_id) REFERENCES public.built_skills(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.built_skill_tools
    ADD CONSTRAINT built_skill_tools_skill_id_built_skills_id_fk FOREIGN KEY (skill_id) REFERENCES public.built_skills(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.built_skills
    ADD CONSTRAINT built_skills_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.built_tools
    ADD CONSTRAINT built_tools_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.channel_assignments
    ADD CONSTRAINT channel_assignments_channel_id_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.channel_bindings
    ADD CONSTRAINT channel_bindings_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.channel_identities
    ADD CONSTRAINT channel_identities_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.channel_pairing_requests
    ADD CONSTRAINT channel_pairing_requests_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_owner_profile_id_fkey FOREIGN KEY (owner_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.config_snapshots
    ADD CONSTRAINT config_snapshots_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.crm_contact_activity_stats
    ADD CONSTRAINT crm_contact_activity_stats_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.crm_contact_identities
    ADD CONSTRAINT crm_contact_identities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.crm_contact_tags
    ADD CONSTRAINT crm_contact_tags_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.crm_contact_tags
    ADD CONSTRAINT crm_contact_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.crm_tags(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_uploaded_by_profiles_id_fk FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.fin_invoice_items
    ADD CONSTRAINT fin_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.fin_invoices(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.fin_invoice_items
    ADD CONSTRAINT fin_invoice_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.fin_products(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.fin_invoices
    ADD CONSTRAINT fin_invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.fin_clients(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.fin_payments
    ADD CONSTRAINT fin_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.fin_invoices(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.fin_product_components
    ADD CONSTRAINT fin_product_components_bundle_product_id_fkey FOREIGN KEY (bundle_product_id) REFERENCES public.fin_products(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.fin_product_components
    ADD CONSTRAINT fin_product_components_child_product_id_fkey FOREIGN KEY (child_product_id) REFERENCES public.fin_products(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.fin_transactions
    ADD CONSTRAINT fin_transactions_org_import_fk FOREIGN KEY (org_id, import_id) REFERENCES public.fin_statement_imports(org_id, id) ON DELETE CASCADE;



ALTER TABLE ONLY public.gateway_lease
    ADD CONSTRAINT gateway_lease_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.hr_employees
    ADD CONSTRAINT hr_employees_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.sched_resources(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.hr_leave_allocations
    ADD CONSTRAINT hr_leave_allocations_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.hr_employees(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.hr_leave_allocations
    ADD CONSTRAINT hr_leave_allocations_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES public.hr_leave_types(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.hr_leave_requests
    ADD CONSTRAINT hr_leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.hr_employees(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.hr_leave_requests
    ADD CONSTRAINT hr_leave_requests_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES public.hr_leave_types(id);



ALTER TABLE ONLY public.identity_subscriptions
    ADD CONSTRAINT identity_subscriptions_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.user_identities(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.identity_subscriptions
    ADD CONSTRAINT identity_subscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.identity_subscriptions
    ADD CONSTRAINT identity_subscriptions_subscriber_profile_id_fkey FOREIGN KEY (subscriber_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.job_effect_units
    ADD CONSTRAINT job_effect_units_batch_fk FOREIGN KEY (tenant_id, batch_id) REFERENCES public.job_effect_batches(tenant_id, id);



ALTER TABLE ONLY public.job_effect_units
    ADD CONSTRAINT job_effect_units_head_fk FOREIGN KEY (tenant_id, head_id, head_kind) REFERENCES public.job_effects(tenant_id, id, kind);



ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_document_fk FOREIGN KEY (org_id, document_id) REFERENCES public.knowledge_documents(org_id, id) ON DELETE CASCADE;



ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_source_fk FOREIGN KEY (org_id, source_id) REFERENCES public.knowledge_sources(org_id, id) ON DELETE CASCADE;



ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_documents_source_fk FOREIGN KEY (org_id, source_id) REFERENCES public.knowledge_sources(org_id, id) ON DELETE CASCADE;



ALTER TABLE ONLY public.marketplace_installs
    ADD CONSTRAINT marketplace_installs_agent_id_marketplace_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.marketplace_agents(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.marketplace_installs
    ADD CONSTRAINT marketplace_installs_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.meta_assets
    ADD CONSTRAINT meta_assets_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.meta_connections(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.meta_post_insights
    ADD CONSTRAINT meta_post_insights_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.meta_assets(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_session_id_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.org_areas
    ADD CONSTRAINT org_areas_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.org_provision_runs
    ADD CONSTRAINT org_provision_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.pending_channel_claims
    ADD CONSTRAINT pending_channel_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.personal_agents
    ADD CONSTRAINT personal_agents_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.personal_agents
    ADD CONSTRAINT personal_agents_profile_id_profiles_id_fk FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.plugin_org_disabled
    ADD CONSTRAINT plugin_org_disabled_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.pos_emissions
    ADD CONSTRAINT pos_emissions_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.pos_tickets(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.pos_package_grants
    ADD CONSTRAINT pos_package_grants_source_line_id_fkey FOREIGN KEY (source_line_id) REFERENCES public.pos_ticket_lines(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.pos_package_grants
    ADD CONSTRAINT pos_package_grants_source_ticket_id_fkey FOREIGN KEY (source_ticket_id) REFERENCES public.pos_tickets(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.pos_package_redemptions
    ADD CONSTRAINT pos_package_redemptions_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.pos_package_grants(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.pos_payments
    ADD CONSTRAINT pos_payments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.pos_tickets(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.pos_ticket_lines
    ADD CONSTRAINT pos_ticket_lines_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.pos_tickets(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.pos_tickets
    ADD CONSTRAINT pos_tickets_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.pos_shifts(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.sched_availability
    ADD CONSTRAINT sched_availability_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.sched_schedules(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.sched_bookings
    ADD CONSTRAINT sched_bookings_event_type_id_fkey FOREIGN KEY (event_type_id) REFERENCES public.sched_event_types(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.sched_bookings
    ADD CONSTRAINT sched_bookings_kind_id_fkey FOREIGN KEY (kind_id) REFERENCES public.sched_event_kinds(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.sched_bookings
    ADD CONSTRAINT sched_bookings_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.sched_resources(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.sched_event_type_resources
    ADD CONSTRAINT sched_event_type_resources_event_type_id_fkey FOREIGN KEY (event_type_id) REFERENCES public.sched_event_types(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.sched_event_type_resources
    ADD CONSTRAINT sched_event_type_resources_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.sched_resources(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.sched_event_types
    ADD CONSTRAINT sched_event_types_kind_id_fkey FOREIGN KEY (kind_id) REFERENCES public.sched_event_kinds(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.sched_reminders
    ADD CONSTRAINT sched_reminders_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.sched_bookings(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.sched_schedules
    ADD CONSTRAINT sched_schedules_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.sched_resources(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.server_backups
    ADD CONSTRAINT server_backups_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.server_provision_configs
    ADD CONSTRAINT server_provision_configs_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.session_tasks
    ADD CONSTRAINT session_tasks_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.skill_execution_stats
    ADD CONSTRAINT skill_execution_stats_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.stk_accruals
    ADD CONSTRAINT stk_accruals_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.stk_items(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.stk_accruals
    ADD CONSTRAINT stk_accruals_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.stk_warehouses(id);



ALTER TABLE ONLY public.stk_bins
    ADD CONSTRAINT stk_bins_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.stk_items(id);



ALTER TABLE ONLY public.stk_bins
    ADD CONSTRAINT stk_bins_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.stk_warehouses(id);



ALTER TABLE ONLY public.stk_consumption
    ADD CONSTRAINT stk_consumption_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.stk_items(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.stk_entry_lines
    ADD CONSTRAINT stk_entry_lines_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.stk_entries(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.stk_entry_lines
    ADD CONSTRAINT stk_entry_lines_from_warehouse_id_fkey FOREIGN KEY (from_warehouse_id) REFERENCES public.stk_warehouses(id);



ALTER TABLE ONLY public.stk_entry_lines
    ADD CONSTRAINT stk_entry_lines_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.stk_items(id);



ALTER TABLE ONLY public.stk_entry_lines
    ADD CONSTRAINT stk_entry_lines_to_warehouse_id_fkey FOREIGN KEY (to_warehouse_id) REFERENCES public.stk_warehouses(id);



ALTER TABLE ONLY public.stk_item_components
    ADD CONSTRAINT stk_item_components_child_item_id_fkey FOREIGN KEY (child_item_id) REFERENCES public.stk_items(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.stk_item_components
    ADD CONSTRAINT stk_item_components_parent_item_id_fkey FOREIGN KEY (parent_item_id) REFERENCES public.stk_items(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.stk_ledger
    ADD CONSTRAINT stk_ledger_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.stk_entries(id);



ALTER TABLE ONLY public.stk_ledger
    ADD CONSTRAINT stk_ledger_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.stk_items(id);



ALTER TABLE ONLY public.stk_ledger
    ADD CONSTRAINT stk_ledger_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.stk_warehouses(id);



ALTER TABLE ONLY public.stk_warehouses
    ADD CONSTRAINT stk_warehouses_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.stk_warehouses(id);



ALTER TABLE ONLY public.tag_links
    ADD CONSTRAINT tag_links_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.crm_tags(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_mission_id_missions_id_fk FOREIGN KEY (mission_id) REFERENCES public.missions(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_agents
    ADD CONSTRAINT user_agents_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_agents
    ADD CONSTRAINT user_agents_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_gateway
    ADD CONSTRAINT user_gateway_gateway_id_gateway_id_fk FOREIGN KEY (gateway_id) REFERENCES public.gateway(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_gateway
    ADD CONSTRAINT user_gateway_profile_id_profiles_id_fk FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_profile_id_profiles_id_fk FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.workspace_membership
    ADD CONSTRAINT workspace_membership_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



CREATE POLICY admin_all ON public.agent_group_members USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY admin_all ON public.agent_groups USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY admin_all ON public.device_identities USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY admin_all ON public.files USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY admin_all ON public.marketplace_agents USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY admin_all ON public.marketplace_installs USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY admin_all ON public.settings USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY admin_all ON public.workshop_saves USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



ALTER TABLE public.agent_artifact_revisions ENABLE ROW LEVEL SECURITY;


CREATE POLICY agent_artifact_revisions_org_guc ON public.agent_artifact_revisions USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.agent_artifacts ENABLE ROW LEVEL SECURITY;


CREATE POLICY agent_artifacts_org_guc ON public.agent_artifacts USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.agent_built_skills ENABLE ROW LEVEL SECURITY;


CREATE POLICY agent_built_skills_access ON public.agent_built_skills TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = agent_built_skills.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = agent_built_skills.tenant_id))))));



CREATE POLICY agent_built_skills_org_guc ON public.agent_built_skills USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.agent_group_members ENABLE ROW LEVEL SECURITY;


CREATE POLICY agent_group_members_org_guc ON public.agent_group_members USING ((EXISTS ( SELECT 1
   FROM public.agent_groups g
  WHERE ((g.id = agent_group_members.group_id) AND ((g.tenant_id)::text = current_setting('app.current_org_id'::text, true)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.agent_groups g
  WHERE ((g.id = agent_group_members.group_id) AND ((g.tenant_id)::text = current_setting('app.current_org_id'::text, true))))));



ALTER TABLE public.agent_groups ENABLE ROW LEVEL SECURITY;


CREATE POLICY agent_groups_org_guc ON public.agent_groups USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;


CREATE POLICY agent_memories_org_isolation ON public.agent_memories USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.app_modules ENABLE ROW LEVEL SECURITY;


CREATE POLICY app_modules_org_guc ON public.app_modules USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.assignment_rules ENABLE ROW LEVEL SECURITY;


CREATE POLICY assignment_rules_org_guc ON public.assignment_rules USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.attachment_file_state ENABLE ROW LEVEL SECURITY;


CREATE POLICY attachment_file_state_org_guc ON public.attachment_file_state TO app_ledger USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.attachment_links ENABLE ROW LEVEL SECURITY;


CREATE POLICY attachment_links_org_guc ON public.attachment_links USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.attachment_trash ENABLE ROW LEVEL SECURITY;


CREATE POLICY attachment_trash_org_guc ON public.attachment_trash TO app_ledger USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



CREATE POLICY auth_sel ON public.marketplace_agents FOR SELECT USING ((( SELECT auth.uid() AS uid) IS NOT NULL));



ALTER TABLE public.backup_configs ENABLE ROW LEVEL SECURITY;


CREATE POLICY backup_configs_access ON public.backup_configs TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = backup_configs.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = backup_configs.tenant_id))))));



CREATE POLICY backup_configs_org_guc ON public.backup_configs USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.bg_jobs ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.brain_access ENABLE ROW LEVEL SECURITY;


CREATE POLICY brain_access_org_guc ON public.brain_access USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.brain_agent_templates ENABLE ROW LEVEL SECURITY;


CREATE POLICY brain_agent_templates_org_guc ON public.brain_agent_templates USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.brain_chunks ENABLE ROW LEVEL SECURITY;


CREATE POLICY brain_chunks_org_guc ON public.brain_chunks USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.brain_documents ENABLE ROW LEVEL SECURITY;


CREATE POLICY brain_documents_org_guc ON public.brain_documents USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.brain_enrichment_settings ENABLE ROW LEVEL SECURITY;


CREATE POLICY brain_enrichment_settings_org_guc ON public.brain_enrichment_settings USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.brain_sources ENABLE ROW LEVEL SECURITY;


CREATE POLICY brain_sources_org_guc ON public.brain_sources USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.brain_vector_generations ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.brain_vector_outbox ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.brain_vector_reconcile_state ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.brains ENABLE ROW LEVEL SECURITY;


CREATE POLICY brains_org_guc ON public.brains USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.built_agent_skills ENABLE ROW LEVEL SECURITY;


CREATE POLICY built_agent_skills_access ON public.built_agent_skills TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.built_agents a
     JOIN public.organization_members om ON ((om.organization_id = a.tenant_id)))
  WHERE ((a.id = built_agent_skills.agent_id) AND (om.profile_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.built_agents a
     JOIN public.organization_members om ON ((om.organization_id = a.tenant_id)))
  WHERE ((a.id = built_agent_skills.agent_id) AND (om.profile_id = ( SELECT auth.uid() AS uid)))))));



CREATE POLICY built_agent_skills_org_guc ON public.built_agent_skills USING ((EXISTS ( SELECT 1
   FROM public.built_agents a
  WHERE ((a.id = built_agent_skills.agent_id) AND ((a.tenant_id)::text = current_setting('app.current_org_id'::text, true)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.built_agents a
  WHERE ((a.id = built_agent_skills.agent_id) AND ((a.tenant_id)::text = current_setting('app.current_org_id'::text, true))))));



ALTER TABLE public.built_agents ENABLE ROW LEVEL SECURITY;


CREATE POLICY built_agents_access ON public.built_agents TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = built_agents.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = built_agents.tenant_id))))));



CREATE POLICY built_agents_org_guc ON public.built_agents USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.built_chapter_edges ENABLE ROW LEVEL SECURITY;


CREATE POLICY built_chapter_edges_access ON public.built_chapter_edges TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.built_skills s
     JOIN public.organization_members om ON ((om.organization_id = s.tenant_id)))
  WHERE ((s.id = built_chapter_edges.skill_id) AND (om.profile_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.built_skills s
     JOIN public.organization_members om ON ((om.organization_id = s.tenant_id)))
  WHERE ((s.id = built_chapter_edges.skill_id) AND (om.profile_id = ( SELECT auth.uid() AS uid)))))));



CREATE POLICY built_chapter_edges_org_guc ON public.built_chapter_edges USING ((EXISTS ( SELECT 1
   FROM public.built_skills s
  WHERE ((s.id = built_chapter_edges.skill_id) AND ((s.tenant_id)::text = current_setting('app.current_org_id'::text, true)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.built_skills s
  WHERE ((s.id = built_chapter_edges.skill_id) AND ((s.tenant_id)::text = current_setting('app.current_org_id'::text, true))))));



ALTER TABLE public.built_chapter_tools ENABLE ROW LEVEL SECURITY;


CREATE POLICY built_chapter_tools_access ON public.built_chapter_tools TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM ((public.built_chapters c
     JOIN public.built_skills s ON ((s.id = c.skill_id)))
     JOIN public.organization_members om ON ((om.organization_id = s.tenant_id)))
  WHERE ((c.id = built_chapter_tools.chapter_id) AND (om.profile_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM ((public.built_chapters c
     JOIN public.built_skills s ON ((s.id = c.skill_id)))
     JOIN public.organization_members om ON ((om.organization_id = s.tenant_id)))
  WHERE ((c.id = built_chapter_tools.chapter_id) AND (om.profile_id = ( SELECT auth.uid() AS uid)))))));



CREATE POLICY built_chapter_tools_org_guc ON public.built_chapter_tools USING ((EXISTS ( SELECT 1
   FROM (public.built_chapters c
     JOIN public.built_skills s ON ((s.id = c.skill_id)))
  WHERE ((c.id = built_chapter_tools.chapter_id) AND ((s.tenant_id)::text = current_setting('app.current_org_id'::text, true)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.built_chapters c
     JOIN public.built_skills s ON ((s.id = c.skill_id)))
  WHERE ((c.id = built_chapter_tools.chapter_id) AND ((s.tenant_id)::text = current_setting('app.current_org_id'::text, true))))));



ALTER TABLE public.built_chapters ENABLE ROW LEVEL SECURITY;


CREATE POLICY built_chapters_access ON public.built_chapters TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.built_skills s
     JOIN public.organization_members om ON ((om.organization_id = s.tenant_id)))
  WHERE ((s.id = built_chapters.skill_id) AND (om.profile_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.built_skills s
     JOIN public.organization_members om ON ((om.organization_id = s.tenant_id)))
  WHERE ((s.id = built_chapters.skill_id) AND (om.profile_id = ( SELECT auth.uid() AS uid)))))));



CREATE POLICY built_chapters_org_guc ON public.built_chapters USING ((EXISTS ( SELECT 1
   FROM public.built_skills s
  WHERE ((s.id = built_chapters.skill_id) AND ((s.tenant_id)::text = current_setting('app.current_org_id'::text, true)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.built_skills s
  WHERE ((s.id = built_chapters.skill_id) AND ((s.tenant_id)::text = current_setting('app.current_org_id'::text, true))))));



ALTER TABLE public.built_skill_tools ENABLE ROW LEVEL SECURITY;


CREATE POLICY built_skill_tools_access ON public.built_skill_tools TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.built_skills s
     JOIN public.organization_members om ON ((om.organization_id = s.tenant_id)))
  WHERE ((s.id = built_skill_tools.skill_id) AND (om.profile_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.built_skills s
     JOIN public.organization_members om ON ((om.organization_id = s.tenant_id)))
  WHERE ((s.id = built_skill_tools.skill_id) AND (om.profile_id = ( SELECT auth.uid() AS uid)))))));



CREATE POLICY built_skill_tools_org_guc ON public.built_skill_tools USING ((EXISTS ( SELECT 1
   FROM public.built_skills s
  WHERE ((s.id = built_skill_tools.skill_id) AND ((s.tenant_id)::text = current_setting('app.current_org_id'::text, true)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.built_skills s
  WHERE ((s.id = built_skill_tools.skill_id) AND ((s.tenant_id)::text = current_setting('app.current_org_id'::text, true))))));



ALTER TABLE public.built_skills ENABLE ROW LEVEL SECURITY;


CREATE POLICY built_skills_access ON public.built_skills TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = built_skills.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = built_skills.tenant_id))))));



CREATE POLICY built_skills_org_guc ON public.built_skills USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.built_tools ENABLE ROW LEVEL SECURITY;


CREATE POLICY built_tools_access ON public.built_tools TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = built_tools.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = built_tools.tenant_id))))));



CREATE POLICY built_tools_org_guc ON public.built_tools USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.channel_assignments ENABLE ROW LEVEL SECURITY;


CREATE POLICY channel_assignments_access ON public.channel_assignments TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = channel_assignments.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = channel_assignments.tenant_id))))));



CREATE POLICY channel_assignments_org_guc ON public.channel_assignments USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.channel_bindings ENABLE ROW LEVEL SECURITY;


CREATE POLICY channel_bindings_org_guc ON public.channel_bindings USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.channel_identities ENABLE ROW LEVEL SECURITY;


CREATE POLICY channel_identities_access ON public.channel_identities TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))));



ALTER TABLE public.channel_pairing_requests ENABLE ROW LEVEL SECURITY;


CREATE POLICY channel_pairing_requests_org_guc ON public.channel_pairing_requests USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;


CREATE POLICY channels_access ON public.channels TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = channels.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = channels.tenant_id))))));



CREATE POLICY channels_org_guc ON public.channels USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;


CREATE POLICY chat_messages_access ON public.chat_messages TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = chat_messages.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = chat_messages.tenant_id))))));



CREATE POLICY chat_messages_org_guc ON public.chat_messages USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.config_snapshots ENABLE ROW LEVEL SECURITY;


CREATE POLICY config_snapshots_access ON public.config_snapshots TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = config_snapshots.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = config_snapshots.tenant_id))))));



CREATE POLICY config_snapshots_org_guc ON public.config_snapshots USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_activities_org_guc ON public.crm_activities USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_contact_activity_stats ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_contact_activity_stats_org_guc ON public.crm_contact_activity_stats USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_contact_identities ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_contact_identities_org_guc ON public.crm_contact_identities USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_contact_tags ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_contact_tags_org_guc ON public.crm_contact_tags USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_contacts_org_guc ON public.crm_contacts USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_conversation_analysis ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_conversation_analysis_org_guc ON public.crm_conversation_analysis USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_conversation_chunks ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_conversation_chunks_org_guc ON public.crm_conversation_chunks USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_conversation_index ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_conversation_index_org_guc ON public.crm_conversation_index USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_message_sentiment ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_message_sentiment_org_guc ON public.crm_message_sentiment USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_sentiment_chat_daily ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_sentiment_chat_daily_org_guc ON public.crm_sentiment_chat_daily FOR SELECT USING ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_settings_org_guc ON public.crm_settings USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_tags ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_tags_org_guc ON public.crm_tags USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_win_embeddings ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_win_embeddings_org_guc ON public.crm_win_embeddings USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.crm_word_frequency_daily ENABLE ROW LEVEL SECURITY;


CREATE POLICY crm_word_frequency_daily_org_guc ON public.crm_word_frequency_daily FOR SELECT USING ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;


CREATE POLICY dashboard_layouts_org_guc ON public.dashboard_layouts USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.device_identities ENABLE ROW LEVEL SECURITY;


CREATE POLICY device_identities_org_guc ON public.device_identities USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.doc_audit_log ENABLE ROW LEVEL SECURITY;


CREATE POLICY doc_audit_log_org_guc ON public.doc_audit_log USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.doc_comments ENABLE ROW LEVEL SECURITY;


CREATE POLICY doc_comments_org_guc ON public.doc_comments USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.email_ledger ENABLE ROW LEVEL SECURITY;


CREATE POLICY email_ledger_org ON public.email_ledger USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.email_ledger_settings ENABLE ROW LEVEL SECURITY;


CREATE POLICY email_ledger_settings_org ON public.email_ledger_settings USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.email_opens ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;


CREATE POLICY files_org_guc ON public.files USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_clients ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_clients_org_guc ON public.fin_clients USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_dni_placeholder_null_bak ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.fin_dni_reassign_bak_cli ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.fin_dni_reassign_bak_inv ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.fin_invoice_items ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_invoice_items_org_guc ON public.fin_invoice_items USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_invoices ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_invoices_org_guc ON public.fin_invoices USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_payments ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.fin_payments_method_bak_20260814 ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_payments_org_guc ON public.fin_payments USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_product_components ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_product_components_org_guc ON public.fin_product_components USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_products ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.fin_products_bak_insumos2608 ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_products_org_guc ON public.fin_products USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_purchase_periods ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_purchase_periods_org_guc ON public.fin_purchase_periods USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_purchases ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_purchases_org_guc ON public.fin_purchases USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_settings ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_settings_org ON public.fin_settings USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_sources ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_sources_org_guc ON public.fin_sources USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_statement_imports ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_statement_imports_org_guc ON public.fin_statement_imports USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_sync_jobs ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_sync_jobs_org_guc ON public.fin_sync_jobs USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.fin_transactions ENABLE ROW LEVEL SECURITY;


CREATE POLICY fin_transactions_org_guc ON public.fin_transactions USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.flow_groups ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.flow_groups_backup_20260604 ENABLE ROW LEVEL SECURITY;


CREATE POLICY flow_groups_org_guc ON public.flow_groups USING ((tenant_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((tenant_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;


CREATE POLICY flow_runs_org_guc ON public.flow_runs USING ((tenant_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((tenant_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.flow_var_exports ENABLE ROW LEVEL SECURITY;


CREATE POLICY flow_var_exports_org_guc ON public.flow_var_exports USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.flows_backup_20260604 ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.flows_backup_20260605_triage ENABLE ROW LEVEL SECURITY;


CREATE POLICY flows_org_guc ON public.flows USING ((tenant_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((tenant_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.gateway ENABLE ROW LEVEL SECURITY;


CREATE POLICY gateway_admin_all ON public.gateway USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



ALTER TABLE public.gateway_lease ENABLE ROW LEVEL SECURITY;


CREATE POLICY gateway_linked_select ON public.gateway FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_gateway ug
  WHERE ((ug.gateway_id = gateway.id) AND (ug.profile_id = ( SELECT auth.uid() AS uid))))));



ALTER TABLE public.gateway_signing_keys ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;


CREATE POLICY hr_employees_org_guc ON public.hr_employees USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.hr_holidays ENABLE ROW LEVEL SECURITY;


CREATE POLICY hr_holidays_org_guc ON public.hr_holidays USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.hr_leave_allocations ENABLE ROW LEVEL SECURITY;


CREATE POLICY hr_leave_allocations_org_guc ON public.hr_leave_allocations USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.hr_leave_requests ENABLE ROW LEVEL SECURITY;


CREATE POLICY hr_leave_requests_org_guc ON public.hr_leave_requests USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.hr_leave_types ENABLE ROW LEVEL SECURITY;


CREATE POLICY hr_leave_types_org_guc ON public.hr_leave_types USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.hr_settings ENABLE ROW LEVEL SECURITY;


CREATE POLICY hr_settings_org_guc ON public.hr_settings USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.hub_migrations ENABLE ROW LEVEL SECURITY;


CREATE POLICY identities_self_select ON public.user_identities FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));



ALTER TABLE public.identity_subscriptions ENABLE ROW LEVEL SECURITY;


CREATE POLICY idsub_self_delete ON public.identity_subscriptions FOR DELETE USING ((subscriber_profile_id = ( SELECT auth.uid() AS uid)));



CREATE POLICY idsub_self_insert ON public.identity_subscriptions FOR INSERT WITH CHECK ((subscriber_profile_id = ( SELECT auth.uid() AS uid)));



CREATE POLICY idsub_self_select ON public.identity_subscriptions FOR SELECT USING ((subscriber_profile_id = ( SELECT auth.uid() AS uid)));



ALTER TABLE public.job_effect_batches ENABLE ROW LEVEL SECURITY;


CREATE POLICY job_effect_batches_org ON public.job_effect_batches TO app_ledger USING ((tenant_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((tenant_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.job_effect_pages ENABLE ROW LEVEL SECURITY;


CREATE POLICY job_effect_pages_org ON public.job_effect_pages TO app_ledger USING ((tenant_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((tenant_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.job_effect_units ENABLE ROW LEVEL SECURITY;


CREATE POLICY job_effect_units_org ON public.job_effect_units TO app_ledger USING ((tenant_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((tenant_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.job_effects ENABLE ROW LEVEL SECURITY;


CREATE POLICY job_effects_org ON public.job_effects TO app_ledger USING ((tenant_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((tenant_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.join_link ENABLE ROW LEVEL SECURITY;


CREATE POLICY join_link_admin_all ON public.join_link USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



ALTER TABLE public.join_request ENABLE ROW LEVEL SECURITY;


CREATE POLICY join_request_admin_all ON public.join_request USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY join_request_self_insert ON public.join_request FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = supabase_id));



CREATE POLICY join_request_self_select ON public.join_request FOR SELECT USING ((( SELECT auth.uid() AS uid) = supabase_id));



ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;


CREATE POLICY knowledge_chunks_org_guc ON public.knowledge_chunks USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;


CREATE POLICY knowledge_documents_org_guc ON public.knowledge_documents USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;


CREATE POLICY knowledge_sources_org_guc ON public.knowledge_sources USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.marketplace_agents ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.marketplace_installs ENABLE ROW LEVEL SECURITY;


CREATE POLICY marketplace_installs_org_guc ON public.marketplace_installs USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.member_roles ENABLE ROW LEVEL SECURITY;


CREATE POLICY member_roles_org_guc ON public.member_roles FOR SELECT TO app_ledger USING (((org_id)::text = current_setting('app.current_org_id'::text, true)));



CREATE POLICY member_sel ON public.agent_group_members FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.agent_groups g
     JOIN public.organization_members m ON ((m.organization_id = g.tenant_id)))
  WHERE ((g.id = agent_group_members.group_id) AND (m.profile_id = ( SELECT auth.uid() AS uid))))));



CREATE POLICY member_sel ON public.agent_groups FOR SELECT USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = agent_groups.tenant_id) AND (m.profile_id = ( SELECT auth.uid() AS uid)))))));



CREATE POLICY member_sel ON public.device_identities FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = device_identities.tenant_id) AND (m.profile_id = ( SELECT auth.uid() AS uid))))));



CREATE POLICY member_sel ON public.files FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = files.tenant_id) AND (m.profile_id = ( SELECT auth.uid() AS uid))))));



CREATE POLICY member_sel ON public.marketplace_installs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = marketplace_installs.tenant_id) AND (m.profile_id = ( SELECT auth.uid() AS uid))))));



CREATE POLICY member_sel ON public.settings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = settings.tenant_id) AND (m.profile_id = ( SELECT auth.uid() AS uid))))));



ALTER TABLE public.membership_cycles ENABLE ROW LEVEL SECURITY;


CREATE POLICY membership_cycles_org_guc ON public.membership_cycles USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;


CREATE POLICY membership_plans_org_guc ON public.membership_plans USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;


CREATE POLICY memberships_org_guc ON public.memberships USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;


CREATE POLICY messages_org_isolation ON public.messages USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.meta_ad_insights ENABLE ROW LEVEL SECURITY;


CREATE POLICY meta_ad_insights_org_guc ON public.meta_ad_insights USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.meta_ad_posts ENABLE ROW LEVEL SECURITY;


CREATE POLICY meta_ad_posts_org_guc ON public.meta_ad_posts USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.meta_assets ENABLE ROW LEVEL SECURITY;


CREATE POLICY meta_assets_org_guc ON public.meta_assets USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;


CREATE POLICY meta_connections_org_guc ON public.meta_connections USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.meta_lead_attribution ENABLE ROW LEVEL SECURITY;


CREATE POLICY meta_lead_attribution_org_guc ON public.meta_lead_attribution USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.meta_post_insights ENABLE ROW LEVEL SECURITY;


CREATE POLICY meta_post_insights_org_guc ON public.meta_post_insights USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.meta_post_media ENABLE ROW LEVEL SECURITY;


CREATE POLICY meta_post_media_org_guc ON public.meta_post_media USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.meta_sync_jobs ENABLE ROW LEVEL SECURITY;


CREATE POLICY meta_sync_jobs_org_guc ON public.meta_sync_jobs USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;


CREATE POLICY missions_access ON public.missions TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = missions.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = missions.tenant_id))))));



CREATE POLICY missions_org_guc ON public.missions USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.naming_series_counters ENABLE ROW LEVEL SECURITY;


CREATE POLICY naming_series_counters_org_guc ON public.naming_series_counters USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.notif_log ENABLE ROW LEVEL SECURITY;


CREATE POLICY notif_log_org_guc ON public.notif_log USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.notif_rules ENABLE ROW LEVEL SECURITY;


CREATE POLICY notif_rules_org_guc ON public.notif_rules USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.org_areas ENABLE ROW LEVEL SECURITY;


CREATE POLICY org_areas_member_read ON public.org_areas FOR SELECT USING ((organization_id IN ( SELECT organization_members.organization_id
   FROM public.organization_members
  WHERE (organization_members.profile_id = ( SELECT auth.uid() AS uid)))));



CREATE POLICY org_areas_org_guc ON public.org_areas FOR SELECT TO app_ledger USING (((organization_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.org_provision_runs ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.org_roles ENABLE ROW LEVEL SECURITY;


CREATE POLICY org_roles_org_guc ON public.org_roles USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;


CREATE POLICY organization_members_admin_all ON public.organization_members USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY organization_members_org_guc ON public.organization_members FOR SELECT TO app_ledger USING (((organization_id)::text = current_setting('app.current_org_id'::text, true)));



CREATE POLICY organization_members_self_select ON public.organization_members FOR SELECT USING ((profile_id = ( SELECT auth.uid() AS uid)));



ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;


CREATE POLICY organizations_admin_all ON public.organizations USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY organizations_member_select ON public.organizations FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = organizations.id) AND (m.profile_id = ( SELECT auth.uid() AS uid))))));



ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;


CREATE POLICY parties_org_guc ON public.parties USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pending_channel_claims ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.permission_roles ENABLE ROW LEVEL SECURITY;


CREATE POLICY permission_roles_read_all ON public.permission_roles FOR SELECT USING (true);



ALTER TABLE public.permission_rules ENABLE ROW LEVEL SECURITY;


CREATE POLICY permission_rules_org_guc ON public.permission_rules USING (((org_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((org_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.personal_agents ENABLE ROW LEVEL SECURITY;


CREATE POLICY personal_agents_admin_all ON public.personal_agents USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY personal_agents_self_select ON public.personal_agents FOR SELECT USING ((profile_id = ( SELECT auth.uid() AS uid)));



ALTER TABLE public.plugin_org_disabled ENABLE ROW LEVEL SECURITY;


CREATE POLICY plugin_org_disabled_org_guc ON public.plugin_org_disabled USING (((org_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((org_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_client_ledger ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_client_ledger_org_guc ON public.pos_client_ledger USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_emissions ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_emissions_org_guc ON public.pos_emissions USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_package_grants ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_package_grants_org_guc ON public.pos_package_grants USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_package_redemptions ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_package_redemptions_org_guc ON public.pos_package_redemptions USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_payment_plans ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_payment_plans_org_guc ON public.pos_payment_plans USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_payments ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_payments_org_guc ON public.pos_payments USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_series ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_series_org_guc ON public.pos_series USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_settings ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_settings_org_guc ON public.pos_settings USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_shifts ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_shifts_org_guc ON public.pos_shifts USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_ticket_lines ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_ticket_lines_org_guc ON public.pos_ticket_lines USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pos_tickets ENABLE ROW LEVEL SECURITY;


CREATE POLICY pos_tickets_org_guc ON public.pos_tickets USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.profiles_legacy_user_id_backup_20260610 ENABLE ROW LEVEL SECURITY;


CREATE POLICY profiles_self_select ON public.profiles FOR SELECT USING ((( SELECT auth.uid() AS uid) = id));



CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE USING ((( SELECT auth.uid() AS uid) = id));



ALTER TABLE public.proj_projects ENABLE ROW LEVEL SECURITY;


CREATE POLICY proj_projects_org_guc ON public.proj_projects USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.proj_tasks ENABLE ROW LEVEL SECURITY;


CREATE POLICY proj_tasks_org_guc ON public.proj_tasks USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.proj_templates ENABLE ROW LEVEL SECURITY;


CREATE POLICY proj_templates_org_guc ON public.proj_templates USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.proj_timesheets ENABLE ROW LEVEL SECURITY;


CREATE POLICY proj_timesheets_org_guc ON public.proj_timesheets USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pulse_proposals ENABLE ROW LEVEL SECURITY;


CREATE POLICY pulse_proposals_org ON public.pulse_proposals USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.pulse_settings ENABLE ROW LEVEL SECURITY;


CREATE POLICY pulse_settings_org ON public.pulse_settings USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;


CREATE POLICY sales_orders_org_guc ON public.sales_orders USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sched_availability ENABLE ROW LEVEL SECURITY;


CREATE POLICY sched_availability_org_guc ON public.sched_availability USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sched_booking_status_log ENABLE ROW LEVEL SECURITY;


CREATE POLICY sched_booking_status_log_org_guc ON public.sched_booking_status_log USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sched_bookings ENABLE ROW LEVEL SECURITY;


CREATE POLICY sched_bookings_org_guc ON public.sched_bookings USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



CREATE POLICY sched_etr_org_guc ON public.sched_event_type_resources USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sched_event_kinds ENABLE ROW LEVEL SECURITY;


CREATE POLICY sched_event_kinds_org_guc ON public.sched_event_kinds USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sched_event_type_resources ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.sched_event_types ENABLE ROW LEVEL SECURITY;


CREATE POLICY sched_event_types_org_guc ON public.sched_event_types USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sched_links ENABLE ROW LEVEL SECURITY;


CREATE POLICY sched_links_org_guc ON public.sched_links USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sched_reminder_config ENABLE ROW LEVEL SECURITY;


CREATE POLICY sched_reminder_config_org_guc ON public.sched_reminder_config USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sched_reminders ENABLE ROW LEVEL SECURITY;


CREATE POLICY sched_reminders_org_guc ON public.sched_reminders USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sched_resources ENABLE ROW LEVEL SECURITY;


CREATE POLICY sched_resources_org_guc ON public.sched_resources USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sched_schedules ENABLE ROW LEVEL SECURITY;


CREATE POLICY sched_schedules_org_guc ON public.sched_schedules USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.server_backups ENABLE ROW LEVEL SECURITY;


CREATE POLICY server_backups_access ON public.server_backups TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = server_backups.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = server_backups.tenant_id))))));



CREATE POLICY server_backups_org_guc ON public.server_backups USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.server_provision_configs ENABLE ROW LEVEL SECURITY;


CREATE POLICY server_provision_configs_access ON public.server_provision_configs TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = server_provision_configs.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = server_provision_configs.tenant_id))))));



CREATE POLICY server_provision_configs_org_guc ON public.server_provision_configs USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.session_tasks ENABLE ROW LEVEL SECURITY;


CREATE POLICY session_tasks_access ON public.session_tasks TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = session_tasks.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = session_tasks.tenant_id))))));



CREATE POLICY session_tasks_org_guc ON public.session_tasks USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;


CREATE POLICY sessions_access ON public.sessions TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = sessions.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = sessions.tenant_id))))));



CREATE POLICY sessions_org_guc ON public.sessions USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;


CREATE POLICY settings_org_guc ON public.settings USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.skill_execution_stats ENABLE ROW LEVEL SECURITY;


CREATE POLICY skill_execution_stats_access ON public.skill_execution_stats TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = skill_execution_stats.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = skill_execution_stats.tenant_id))))));



CREATE POLICY skill_execution_stats_org_guc ON public.skill_execution_stats USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;


CREATE POLICY skills_access ON public.skills TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = skills.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = skills.tenant_id))))));



CREATE POLICY skills_org_guc ON public.skills USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.stk_accruals ENABLE ROW LEVEL SECURITY;


CREATE POLICY stk_accruals_org_guc ON public.stk_accruals USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.stk_bins ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.stk_bins_bak_insumos2608 ENABLE ROW LEVEL SECURITY;


CREATE POLICY stk_bins_org_guc ON public.stk_bins USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.stk_consumption ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.stk_consumption_bak_insumos2608 ENABLE ROW LEVEL SECURITY;


CREATE POLICY stk_consumption_org_guc ON public.stk_consumption USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.stk_entries ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.stk_entries_bak_repair ENABLE ROW LEVEL SECURITY;


CREATE POLICY stk_entries_org_guc ON public.stk_entries USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.stk_entries_reclass_bak ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.stk_entry_lines ENABLE ROW LEVEL SECURITY;


CREATE POLICY stk_entry_lines_org_guc ON public.stk_entry_lines USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.stk_item_components ENABLE ROW LEVEL SECURITY;


CREATE POLICY stk_item_components_org_guc ON public.stk_item_components USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.stk_items ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.stk_items_bak_insumos2608 ENABLE ROW LEVEL SECURITY;


CREATE POLICY stk_items_org_guc ON public.stk_items USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.stk_ledger ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.stk_ledger_bak_repair ENABLE ROW LEVEL SECURITY;


CREATE POLICY stk_ledger_org_guc ON public.stk_ledger USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.stk_warehouses ENABLE ROW LEVEL SECURITY;


CREATE POLICY stk_warehouses_org_guc ON public.stk_warehouses USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.support_issues ENABLE ROW LEVEL SECURITY;


CREATE POLICY support_issues_org_guc ON public.support_issues USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.support_settings ENABLE ROW LEVEL SECURITY;


CREATE POLICY support_settings_org_guc ON public.support_settings USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.tag_links ENABLE ROW LEVEL SECURITY;


CREATE POLICY tag_links_org_guc ON public.tag_links USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;


CREATE POLICY tasks_access ON public.tasks TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = tasks.tenant_id)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.organization_id = tasks.tenant_id))))));



CREATE POLICY tasks_org_guc ON public.tasks USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.user_agents ENABLE ROW LEVEL SECURITY;


CREATE POLICY user_agents_access ON public.user_agents TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))));



ALTER TABLE public.user_gateway ENABLE ROW LEVEL SECURITY;


CREATE POLICY user_gateway_admin_all ON public.user_gateway USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY user_gateway_self_select ON public.user_gateway FOR SELECT USING ((profile_id = ( SELECT auth.uid() AS uid)));



ALTER TABLE public.user_identities ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;


CREATE POLICY user_preferences_admin_all ON public.user_preferences USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))));



CREATE POLICY user_preferences_self_all ON public.user_preferences USING ((profile_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));



ALTER TABLE public.workflow_defs ENABLE ROW LEVEL SECURITY;


CREATE POLICY workflow_defs_org_guc ON public.workflow_defs USING ((org_id = current_setting('app.current_org_id'::text, true))) WITH CHECK ((org_id = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.workshop_comparison_outputs ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.workshop_comparison_runs ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.workshop_groupchat_agents ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.workshop_groupchat_messages ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.workshop_groupchat_runs ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.workshop_prompt_categories ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.workshop_rankings ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.workshop_saves ENABLE ROW LEVEL SECURITY;


CREATE POLICY workshop_saves_member_sel ON public.workshop_saves FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = workshop_saves.tenant_id) AND (m.profile_id = ( SELECT auth.uid() AS uid))))));



CREATE POLICY workshop_saves_org_guc ON public.workshop_saves USING (((tenant_id)::text = current_setting('app.current_org_id'::text, true))) WITH CHECK (((tenant_id)::text = current_setting('app.current_org_id'::text, true)));



ALTER TABLE public.workspace_membership ENABLE ROW LEVEL SECURITY;


CREATE POLICY workspace_membership_access ON public.workspace_membership TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))));



GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO app_ledger;
GRANT USAGE ON SCHEMA public TO app_assistant_ro;
GRANT USAGE ON SCHEMA public TO brain_vector_worker;



REVOKE ALL ON FUNCTION public.ack_brain_vector_job(chunk_id uuid, generation text, revision bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ack_brain_vector_job(chunk_id uuid, generation text, revision bigint) TO service_role;
GRANT ALL ON FUNCTION public.ack_brain_vector_job(chunk_id uuid, generation text, revision bigint) TO brain_vector_worker;



REVOKE ALL ON FUNCTION public.brain_vector_app_generation_mode() FROM PUBLIC;
GRANT ALL ON FUNCTION public.brain_vector_app_generation_mode() TO service_role;
GRANT ALL ON FUNCTION public.brain_vector_app_generation_mode() TO app_ledger;



REVOKE ALL ON FUNCTION public.brain_vector_app_source_pending_count(p_source_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.brain_vector_app_source_pending_count(p_source_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.brain_vector_app_source_pending_count(p_source_id uuid) TO app_ledger;



REVOKE ALL ON FUNCTION public.brain_vector_app_source_state(p_source_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.brain_vector_app_source_state(p_source_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.brain_vector_app_source_state(p_source_id uuid) TO app_ledger;



REVOKE ALL ON FUNCTION public.brain_vector_worker_status(p_generation text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.brain_vector_worker_status(p_generation text) TO service_role;
GRANT ALL ON FUNCTION public.brain_vector_worker_status(p_generation text) TO brain_vector_worker;



REVOKE ALL ON FUNCTION public.claim_brain_vector_jobs(p_generation text, worker_id text, job_limit integer, lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_brain_vector_jobs(p_generation text, worker_id text, job_limit integer, lease_seconds integer) TO service_role;
GRANT ALL ON FUNCTION public.claim_brain_vector_jobs(p_generation text, worker_id text, job_limit integer, lease_seconds integer) TO brain_vector_worker;



GRANT ALL ON FUNCTION public.crm_contact_activity_on_identity_change() TO anon;
GRANT ALL ON FUNCTION public.crm_contact_activity_on_identity_change() TO authenticated;
GRANT ALL ON FUNCTION public.crm_contact_activity_on_identity_change() TO service_role;



GRANT ALL ON FUNCTION public.crm_contact_activity_on_message_change() TO anon;
GRANT ALL ON FUNCTION public.crm_contact_activity_on_message_change() TO authenticated;
GRANT ALL ON FUNCTION public.crm_contact_activity_on_message_change() TO service_role;



GRANT ALL ON FUNCTION public.crm_contact_activity_on_message_insert() TO anon;
GRANT ALL ON FUNCTION public.crm_contact_activity_on_message_insert() TO authenticated;
GRANT ALL ON FUNCTION public.crm_contact_activity_on_message_insert() TO service_role;



REVOKE ALL ON FUNCTION public.crm_rebuild_contact_activity(p_contact_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.crm_rebuild_contact_activity(p_contact_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.crm_rebuild_contact_activity(p_contact_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.crm_rebuild_contact_activity(p_contact_ids uuid[]) TO service_role;
GRANT ALL ON FUNCTION public.crm_rebuild_contact_activity(p_contact_ids uuid[]) TO app_ledger;



REVOKE ALL ON FUNCTION public.crm_rebuild_org_contact_activity(p_org_id text, p_after uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.crm_rebuild_org_contact_activity(p_org_id text, p_after uuid, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.crm_rebuild_org_contact_activity(p_org_id text, p_after uuid, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.crm_rebuild_org_contact_activity(p_org_id text, p_after uuid, p_limit integer) TO service_role;



REVOKE ALL ON FUNCTION public.crm_refresh_sentiment_chat_daily(p_org_id text, p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.crm_refresh_sentiment_chat_daily(p_org_id text, p_from date, p_to date) TO service_role;



REVOKE ALL ON FUNCTION public.crm_refresh_word_frequency_daily(p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.crm_refresh_word_frequency_daily(p_from date, p_to date) TO service_role;



REVOKE ALL ON FUNCTION public.dead_letter_brain_vector_job(chunk_id uuid, generation text, revision bigint, error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dead_letter_brain_vector_job(chunk_id uuid, generation text, revision bigint, error text) TO service_role;
GRANT ALL ON FUNCTION public.dead_letter_brain_vector_job(chunk_id uuid, generation text, revision bigint, error text) TO brain_vector_worker;



REVOKE ALL ON FUNCTION public.detach_deleted_record_attachments() FROM PUBLIC;
GRANT ALL ON FUNCTION public.detach_deleted_record_attachments() TO anon;
GRANT ALL ON FUNCTION public.detach_deleted_record_attachments() TO authenticated;
GRANT ALL ON FUNCTION public.detach_deleted_record_attachments() TO service_role;
GRANT ALL ON FUNCTION public.detach_deleted_record_attachments() TO app_ledger;



REVOKE ALL ON FUNCTION public.enqueue_brain_vector_backfill(generation text, after_chunk_id uuid, row_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_brain_vector_backfill(generation text, after_chunk_id uuid, row_limit integer) TO service_role;
GRANT ALL ON FUNCTION public.enqueue_brain_vector_backfill(generation text, after_chunk_id uuid, row_limit integer) TO brain_vector_worker;



REVOKE ALL ON FUNCTION public.enqueue_brain_vector_chunk() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_brain_vector_chunk() TO service_role;



REVOKE ALL ON FUNCTION public.filter_existing_brain_vector_chunks(chunk_ids uuid[], generation text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.filter_existing_brain_vector_chunks(chunk_ids uuid[], generation text) TO service_role;
GRANT ALL ON FUNCTION public.filter_existing_brain_vector_chunks(chunk_ids uuid[], generation text) TO brain_vector_worker;



REVOKE ALL ON FUNCTION public.guard_attachment_file_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.guard_attachment_file_state() TO anon;
GRANT ALL ON FUNCTION public.guard_attachment_file_state() TO authenticated;
GRANT ALL ON FUNCTION public.guard_attachment_file_state() TO service_role;
GRANT ALL ON FUNCTION public.guard_attachment_file_state() TO app_ledger;



REVOKE ALL ON FUNCTION public.guard_managed_file_identity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.guard_managed_file_identity() TO anon;
GRANT ALL ON FUNCTION public.guard_managed_file_identity() TO authenticated;
GRANT ALL ON FUNCTION public.guard_managed_file_identity() TO service_role;
GRANT ALL ON FUNCTION public.guard_managed_file_identity() TO app_ledger;



REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_auth_user() TO service_role;



REVOKE ALL ON FUNCTION public.hub_broadcast_message_committed() FROM PUBLIC;
GRANT ALL ON FUNCTION public.hub_broadcast_message_committed() TO service_role;



REVOKE ALL ON FUNCTION public.job_effect_batch_complete(tenant text, batch text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_effect_batch_complete(tenant text, batch text) TO service_role;



REVOKE ALL ON FUNCTION public.job_effect_batch_descriptor_valid(descriptor jsonb, members jsonb, expected integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_effect_batch_descriptor_valid(descriptor jsonb, members jsonb, expected integer) TO service_role;
GRANT ALL ON FUNCTION public.job_effect_batch_descriptor_valid(descriptor jsonb, members jsonb, expected integer) TO app_ledger;



REVOKE ALL ON FUNCTION public.job_effect_batches_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_effect_batches_guard() TO service_role;



REVOKE ALL ON FUNCTION public.job_effect_membership_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_effect_membership_guard() TO service_role;



REVOKE ALL ON FUNCTION public.job_effect_page_actor(tenant text, expected_job text, expected_generation integer, previous_job text, previous_generation integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_effect_page_actor(tenant text, expected_job text, expected_generation integer, previous_job text, previous_generation integer) TO service_role;



REVOKE ALL ON FUNCTION public.job_effect_pages_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_effect_pages_guard() TO service_role;



REVOKE ALL ON FUNCTION public.job_effect_units_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_effect_units_guard() TO service_role;



REVOKE ALL ON FUNCTION public.job_effect_vectors_valid(value jsonb, expected integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_effect_vectors_valid(value jsonb, expected integer) TO service_role;
GRANT ALL ON FUNCTION public.job_effect_vectors_valid(value jsonb, expected integer) TO app_ledger;



REVOKE ALL ON FUNCTION public.list_brain_vector_chunks(after_chunk_id uuid, row_limit integer, generation text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_brain_vector_chunks(after_chunk_id uuid, row_limit integer, generation text) TO service_role;
GRANT ALL ON FUNCTION public.list_brain_vector_chunks(after_chunk_id uuid, row_limit integer, generation text) TO brain_vector_worker;



REVOKE ALL ON FUNCTION public.load_brain_vector_reconcile_cursor(p_generation text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.load_brain_vector_reconcile_cursor(p_generation text) TO service_role;
GRANT ALL ON FUNCTION public.load_brain_vector_reconcile_cursor(p_generation text) TO brain_vector_worker;



REVOKE ALL ON FUNCTION public.retry_brain_vector_job(chunk_id uuid, generation text, revision bigint, error text, available_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retry_brain_vector_job(chunk_id uuid, generation text, revision bigint, error text, available_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.retry_brain_vector_job(chunk_id uuid, generation text, revision bigint, error text, available_at timestamp with time zone) TO brain_vector_worker;



REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;



REVOKE ALL ON FUNCTION public.save_brain_vector_reconcile_cursor(p_generation text, next_chunk_id uuid, next_qdrant_offset jsonb, scanned_delta integer, repaired_delta integer, orphaned_delta integer, failed_delta integer, cycle_complete boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_brain_vector_reconcile_cursor(p_generation text, next_chunk_id uuid, next_qdrant_offset jsonb, scanned_delta integer, repaired_delta integer, orphaned_delta integer, failed_delta integer, cycle_complete boolean) TO service_role;
GRANT ALL ON FUNCTION public.save_brain_vector_reconcile_cursor(p_generation text, next_chunk_id uuid, next_qdrant_offset jsonb, scanned_delta integer, repaired_delta integer, orphaned_delta integer, failed_delta integer, cycle_complete boolean) TO brain_vector_worker;



GRANT ALL ON TABLE public.agent_artifact_revisions TO anon;
GRANT ALL ON TABLE public.agent_artifact_revisions TO authenticated;
GRANT ALL ON TABLE public.agent_artifact_revisions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_artifact_revisions TO app_ledger;



GRANT ALL ON TABLE public.agent_artifacts TO anon;
GRANT ALL ON TABLE public.agent_artifacts TO authenticated;
GRANT ALL ON TABLE public.agent_artifacts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_artifacts TO app_ledger;



GRANT ALL ON TABLE public.agent_built_skills TO anon;
GRANT ALL ON TABLE public.agent_built_skills TO authenticated;
GRANT ALL ON TABLE public.agent_built_skills TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_built_skills TO app_ledger;



GRANT ALL ON TABLE public.agent_group_members TO anon;
GRANT ALL ON TABLE public.agent_group_members TO authenticated;
GRANT ALL ON TABLE public.agent_group_members TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_group_members TO app_ledger;



GRANT ALL ON TABLE public.agent_groups TO anon;
GRANT ALL ON TABLE public.agent_groups TO authenticated;
GRANT ALL ON TABLE public.agent_groups TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_groups TO app_ledger;



GRANT ALL ON TABLE public.agent_memories TO anon;
GRANT ALL ON TABLE public.agent_memories TO authenticated;
GRANT ALL ON TABLE public.agent_memories TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_memories TO app_ledger;



GRANT ALL ON TABLE public.ai_usage TO anon;
GRANT ALL ON TABLE public.ai_usage TO authenticated;
GRANT ALL ON TABLE public.ai_usage TO service_role;



GRANT ALL ON TABLE public.app_modules TO anon;
GRANT ALL ON TABLE public.app_modules TO authenticated;
GRANT ALL ON TABLE public.app_modules TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_modules TO app_ledger;
GRANT SELECT ON TABLE public.app_modules TO app_assistant_ro;



GRANT ALL ON TABLE public.assignment_rules TO anon;
GRANT ALL ON TABLE public.assignment_rules TO authenticated;
GRANT ALL ON TABLE public.assignment_rules TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assignment_rules TO app_ledger;



GRANT ALL ON TABLE public.attachment_file_state TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.attachment_file_state TO app_ledger;



GRANT ALL ON TABLE public.attachment_links TO anon;
GRANT ALL ON TABLE public.attachment_links TO authenticated;
GRANT ALL ON TABLE public.attachment_links TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.attachment_links TO app_ledger;



GRANT ALL ON TABLE public.attachment_trash TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.attachment_trash TO app_ledger;



GRANT ALL ON TABLE public.backup_configs TO anon;
GRANT ALL ON TABLE public.backup_configs TO authenticated;
GRANT ALL ON TABLE public.backup_configs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.backup_configs TO app_ledger;



GRANT ALL ON TABLE public.bg_jobs TO anon;
GRANT ALL ON TABLE public.bg_jobs TO authenticated;
GRANT ALL ON TABLE public.bg_jobs TO service_role;



GRANT ALL ON TABLE public.brain_access TO anon;
GRANT ALL ON TABLE public.brain_access TO authenticated;
GRANT ALL ON TABLE public.brain_access TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brain_access TO app_ledger;



GRANT ALL ON TABLE public.brain_agent_templates TO anon;
GRANT ALL ON TABLE public.brain_agent_templates TO authenticated;
GRANT ALL ON TABLE public.brain_agent_templates TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brain_agent_templates TO app_ledger;



GRANT ALL ON TABLE public.brain_chunks TO anon;
GRANT ALL ON TABLE public.brain_chunks TO authenticated;
GRANT ALL ON TABLE public.brain_chunks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brain_chunks TO app_ledger;



GRANT ALL ON TABLE public.brain_documents TO anon;
GRANT ALL ON TABLE public.brain_documents TO authenticated;
GRANT ALL ON TABLE public.brain_documents TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brain_documents TO app_ledger;



GRANT ALL ON TABLE public.brain_enrichment_settings TO anon;
GRANT ALL ON TABLE public.brain_enrichment_settings TO authenticated;
GRANT ALL ON TABLE public.brain_enrichment_settings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brain_enrichment_settings TO app_ledger;



GRANT ALL ON TABLE public.brain_sources TO anon;
GRANT ALL ON TABLE public.brain_sources TO authenticated;
GRANT ALL ON TABLE public.brain_sources TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brain_sources TO app_ledger;



GRANT ALL ON TABLE public.brain_vector_generations TO service_role;



GRANT ALL ON TABLE public.brain_vector_outbox TO service_role;



GRANT ALL ON TABLE public.brain_vector_reconcile_state TO service_role;



GRANT ALL ON TABLE public.brains TO anon;
GRANT ALL ON TABLE public.brains TO authenticated;
GRANT ALL ON TABLE public.brains TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brains TO app_ledger;



GRANT ALL ON TABLE public.built_agent_skills TO anon;
GRANT ALL ON TABLE public.built_agent_skills TO authenticated;
GRANT ALL ON TABLE public.built_agent_skills TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.built_agent_skills TO app_ledger;



GRANT ALL ON TABLE public.built_agents TO anon;
GRANT ALL ON TABLE public.built_agents TO authenticated;
GRANT ALL ON TABLE public.built_agents TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.built_agents TO app_ledger;



GRANT ALL ON TABLE public.built_chapter_edges TO anon;
GRANT ALL ON TABLE public.built_chapter_edges TO authenticated;
GRANT ALL ON TABLE public.built_chapter_edges TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.built_chapter_edges TO app_ledger;



GRANT ALL ON TABLE public.built_chapter_tools TO anon;
GRANT ALL ON TABLE public.built_chapter_tools TO authenticated;
GRANT ALL ON TABLE public.built_chapter_tools TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.built_chapter_tools TO app_ledger;



GRANT ALL ON TABLE public.built_chapters TO anon;
GRANT ALL ON TABLE public.built_chapters TO authenticated;
GRANT ALL ON TABLE public.built_chapters TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.built_chapters TO app_ledger;



GRANT ALL ON TABLE public.built_skill_tools TO anon;
GRANT ALL ON TABLE public.built_skill_tools TO authenticated;
GRANT ALL ON TABLE public.built_skill_tools TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.built_skill_tools TO app_ledger;



GRANT ALL ON TABLE public.built_skills TO anon;
GRANT ALL ON TABLE public.built_skills TO authenticated;
GRANT ALL ON TABLE public.built_skills TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.built_skills TO app_ledger;



GRANT ALL ON TABLE public.built_tools TO anon;
GRANT ALL ON TABLE public.built_tools TO authenticated;
GRANT ALL ON TABLE public.built_tools TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.built_tools TO app_ledger;



GRANT ALL ON TABLE public.channel_assignments TO anon;
GRANT ALL ON TABLE public.channel_assignments TO authenticated;
GRANT ALL ON TABLE public.channel_assignments TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.channel_assignments TO app_ledger;



GRANT ALL ON TABLE public.channel_bindings TO anon;
GRANT ALL ON TABLE public.channel_bindings TO authenticated;
GRANT ALL ON TABLE public.channel_bindings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.channel_bindings TO app_ledger;



GRANT ALL ON TABLE public.channel_identities TO anon;
GRANT ALL ON TABLE public.channel_identities TO authenticated;
GRANT ALL ON TABLE public.channel_identities TO service_role;



GRANT ALL ON TABLE public.channel_pairing_requests TO anon;
GRANT ALL ON TABLE public.channel_pairing_requests TO authenticated;
GRANT ALL ON TABLE public.channel_pairing_requests TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.channel_pairing_requests TO app_ledger;



GRANT ALL ON TABLE public.channels TO anon;
GRANT ALL ON TABLE public.channels TO authenticated;
GRANT ALL ON TABLE public.channels TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.channels TO app_ledger;



GRANT ALL ON TABLE public.chat_messages TO anon;
GRANT ALL ON TABLE public.chat_messages TO authenticated;
GRANT ALL ON TABLE public.chat_messages TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages TO app_ledger;



GRANT ALL ON SEQUENCE public.chat_messages_id_seq TO anon;
GRANT ALL ON SEQUENCE public.chat_messages_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.chat_messages_id_seq TO service_role;



GRANT ALL ON TABLE public.config_snapshots TO anon;
GRANT ALL ON TABLE public.config_snapshots TO authenticated;
GRANT ALL ON TABLE public.config_snapshots TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.config_snapshots TO app_ledger;



GRANT ALL ON TABLE public.crm_activities TO anon;
GRANT ALL ON TABLE public.crm_activities TO authenticated;
GRANT ALL ON TABLE public.crm_activities TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_activities TO app_ledger;
GRANT SELECT ON TABLE public.crm_activities TO app_assistant_ro;



GRANT ALL ON TABLE public.crm_contact_activity_stats TO anon;
GRANT ALL ON TABLE public.crm_contact_activity_stats TO authenticated;
GRANT ALL ON TABLE public.crm_contact_activity_stats TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_contact_activity_stats TO app_ledger;



GRANT ALL ON TABLE public.crm_contact_identities TO anon;
GRANT ALL ON TABLE public.crm_contact_identities TO authenticated;
GRANT ALL ON TABLE public.crm_contact_identities TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_contact_identities TO app_ledger;
GRANT SELECT ON TABLE public.crm_contact_identities TO app_assistant_ro;



GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.messages TO app_ledger;
GRANT SELECT ON TABLE public.messages TO app_assistant_ro;



GRANT ALL ON TABLE public.crm_contact_stats TO anon;
GRANT ALL ON TABLE public.crm_contact_stats TO authenticated;
GRANT ALL ON TABLE public.crm_contact_stats TO service_role;
GRANT SELECT ON TABLE public.crm_contact_stats TO app_ledger;



GRANT ALL ON TABLE public.crm_contact_tags TO anon;
GRANT ALL ON TABLE public.crm_contact_tags TO authenticated;
GRANT ALL ON TABLE public.crm_contact_tags TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_contact_tags TO app_ledger;
GRANT SELECT ON TABLE public.crm_contact_tags TO app_assistant_ro;



GRANT ALL ON TABLE public.crm_contact_timeline TO service_role;
GRANT SELECT ON TABLE public.crm_contact_timeline TO app_ledger;



GRANT ALL ON TABLE public.crm_contacts TO anon;
GRANT ALL ON TABLE public.crm_contacts TO authenticated;
GRANT ALL ON TABLE public.crm_contacts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_contacts TO app_ledger;
GRANT SELECT ON TABLE public.crm_contacts TO app_assistant_ro;



GRANT ALL ON TABLE public.crm_conversation_analysis TO anon;
GRANT ALL ON TABLE public.crm_conversation_analysis TO authenticated;
GRANT ALL ON TABLE public.crm_conversation_analysis TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_conversation_analysis TO app_ledger;



GRANT ALL ON TABLE public.crm_conversation_chunks TO anon;
GRANT ALL ON TABLE public.crm_conversation_chunks TO authenticated;
GRANT ALL ON TABLE public.crm_conversation_chunks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_conversation_chunks TO app_ledger;



GRANT ALL ON TABLE public.crm_conversation_index TO anon;
GRANT ALL ON TABLE public.crm_conversation_index TO authenticated;
GRANT ALL ON TABLE public.crm_conversation_index TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_conversation_index TO app_ledger;



GRANT ALL ON TABLE public.crm_message_sentiment TO anon;
GRANT ALL ON TABLE public.crm_message_sentiment TO authenticated;
GRANT ALL ON TABLE public.crm_message_sentiment TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_message_sentiment TO app_ledger;
GRANT SELECT ON TABLE public.crm_message_sentiment TO app_assistant_ro;



GRANT ALL ON TABLE public.crm_sentiment_chat_daily TO anon;
GRANT ALL ON TABLE public.crm_sentiment_chat_daily TO authenticated;
GRANT ALL ON TABLE public.crm_sentiment_chat_daily TO service_role;
GRANT SELECT ON TABLE public.crm_sentiment_chat_daily TO app_ledger;



GRANT ALL ON TABLE public.crm_settings TO anon;
GRANT ALL ON TABLE public.crm_settings TO authenticated;
GRANT ALL ON TABLE public.crm_settings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_settings TO app_ledger;



GRANT ALL ON TABLE public.crm_tags TO anon;
GRANT ALL ON TABLE public.crm_tags TO authenticated;
GRANT ALL ON TABLE public.crm_tags TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_tags TO app_ledger;
GRANT SELECT ON TABLE public.crm_tags TO app_assistant_ro;



GRANT ALL ON TABLE public.crm_win_embeddings TO anon;
GRANT ALL ON TABLE public.crm_win_embeddings TO authenticated;
GRANT ALL ON TABLE public.crm_win_embeddings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_win_embeddings TO app_ledger;



GRANT ALL ON TABLE public.crm_word_frequency_daily TO anon;
GRANT ALL ON TABLE public.crm_word_frequency_daily TO authenticated;
GRANT ALL ON TABLE public.crm_word_frequency_daily TO service_role;
GRANT SELECT ON TABLE public.crm_word_frequency_daily TO app_ledger;



GRANT ALL ON TABLE public.dashboard_layouts TO anon;
GRANT ALL ON TABLE public.dashboard_layouts TO authenticated;
GRANT ALL ON TABLE public.dashboard_layouts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dashboard_layouts TO app_ledger;



GRANT ALL ON TABLE public.device_identities TO anon;
GRANT ALL ON TABLE public.device_identities TO authenticated;
GRANT ALL ON TABLE public.device_identities TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.device_identities TO app_ledger;



GRANT ALL ON TABLE public.doc_audit_log TO anon;
GRANT ALL ON TABLE public.doc_audit_log TO authenticated;
GRANT ALL ON TABLE public.doc_audit_log TO service_role;
GRANT SELECT,INSERT ON TABLE public.doc_audit_log TO app_ledger;



GRANT ALL ON TABLE public.doc_comments TO anon;
GRANT ALL ON TABLE public.doc_comments TO authenticated;
GRANT ALL ON TABLE public.doc_comments TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doc_comments TO app_ledger;



GRANT ALL ON TABLE public.email_ledger TO anon;
GRANT ALL ON TABLE public.email_ledger TO authenticated;
GRANT ALL ON TABLE public.email_ledger TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_ledger TO app_ledger;



GRANT ALL ON TABLE public.email_ledger_settings TO anon;
GRANT ALL ON TABLE public.email_ledger_settings TO authenticated;
GRANT ALL ON TABLE public.email_ledger_settings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_ledger_settings TO app_ledger;



GRANT ALL ON TABLE public.email_opens TO anon;
GRANT ALL ON TABLE public.email_opens TO authenticated;
GRANT ALL ON TABLE public.email_opens TO service_role;



GRANT ALL ON TABLE public.files TO anon;
GRANT ALL ON TABLE public.files TO authenticated;
GRANT ALL ON TABLE public.files TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.files TO app_ledger;



GRANT ALL ON TABLE public.fin_clients TO anon;
GRANT ALL ON TABLE public.fin_clients TO authenticated;
GRANT ALL ON TABLE public.fin_clients TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_clients TO app_ledger;
GRANT SELECT ON TABLE public.fin_clients TO app_assistant_ro;



GRANT ALL ON TABLE public.fin_dni_placeholder_null_bak TO anon;
GRANT ALL ON TABLE public.fin_dni_placeholder_null_bak TO authenticated;
GRANT ALL ON TABLE public.fin_dni_placeholder_null_bak TO service_role;



GRANT ALL ON TABLE public.fin_dni_reassign_bak_cli TO anon;
GRANT ALL ON TABLE public.fin_dni_reassign_bak_cli TO authenticated;
GRANT ALL ON TABLE public.fin_dni_reassign_bak_cli TO service_role;



GRANT ALL ON TABLE public.fin_dni_reassign_bak_inv TO anon;
GRANT ALL ON TABLE public.fin_dni_reassign_bak_inv TO authenticated;
GRANT ALL ON TABLE public.fin_dni_reassign_bak_inv TO service_role;



GRANT ALL ON TABLE public.fin_invoice_items TO anon;
GRANT ALL ON TABLE public.fin_invoice_items TO authenticated;
GRANT ALL ON TABLE public.fin_invoice_items TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_invoice_items TO app_ledger;
GRANT SELECT ON TABLE public.fin_invoice_items TO app_assistant_ro;



GRANT ALL ON TABLE public.fin_invoices TO anon;
GRANT ALL ON TABLE public.fin_invoices TO authenticated;
GRANT ALL ON TABLE public.fin_invoices TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_invoices TO app_ledger;
GRANT SELECT ON TABLE public.fin_invoices TO app_assistant_ro;



GRANT ALL ON TABLE public.fin_payments TO anon;
GRANT ALL ON TABLE public.fin_payments TO authenticated;
GRANT ALL ON TABLE public.fin_payments TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_payments TO app_ledger;
GRANT SELECT ON TABLE public.fin_payments TO app_assistant_ro;



GRANT ALL ON TABLE public.fin_payments_method_bak_20260814 TO anon;
GRANT ALL ON TABLE public.fin_payments_method_bak_20260814 TO authenticated;
GRANT ALL ON TABLE public.fin_payments_method_bak_20260814 TO service_role;



GRANT ALL ON TABLE public.fin_product_components TO anon;
GRANT ALL ON TABLE public.fin_product_components TO authenticated;
GRANT ALL ON TABLE public.fin_product_components TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_product_components TO app_ledger;



GRANT ALL ON TABLE public.fin_products TO anon;
GRANT ALL ON TABLE public.fin_products TO authenticated;
GRANT ALL ON TABLE public.fin_products TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_products TO app_ledger;
GRANT SELECT ON TABLE public.fin_products TO app_assistant_ro;



GRANT ALL ON TABLE public.fin_products_bak_insumos2608 TO anon;
GRANT ALL ON TABLE public.fin_products_bak_insumos2608 TO authenticated;
GRANT ALL ON TABLE public.fin_products_bak_insumos2608 TO service_role;



GRANT ALL ON TABLE public.fin_purchase_periods TO anon;
GRANT ALL ON TABLE public.fin_purchase_periods TO authenticated;
GRANT ALL ON TABLE public.fin_purchase_periods TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_purchase_periods TO app_ledger;



GRANT ALL ON TABLE public.fin_purchases TO anon;
GRANT ALL ON TABLE public.fin_purchases TO authenticated;
GRANT ALL ON TABLE public.fin_purchases TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_purchases TO app_ledger;



GRANT ALL ON TABLE public.fin_settings TO anon;
GRANT ALL ON TABLE public.fin_settings TO authenticated;
GRANT ALL ON TABLE public.fin_settings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_settings TO app_ledger;



GRANT ALL ON TABLE public.fin_sources TO anon;
GRANT ALL ON TABLE public.fin_sources TO authenticated;
GRANT ALL ON TABLE public.fin_sources TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_sources TO app_ledger;
GRANT SELECT ON TABLE public.fin_sources TO app_assistant_ro;



GRANT ALL ON TABLE public.fin_statement_imports TO anon;
GRANT ALL ON TABLE public.fin_statement_imports TO authenticated;
GRANT ALL ON TABLE public.fin_statement_imports TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_statement_imports TO app_ledger;



GRANT ALL ON TABLE public.fin_sync_jobs TO anon;
GRANT ALL ON TABLE public.fin_sync_jobs TO authenticated;
GRANT ALL ON TABLE public.fin_sync_jobs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_sync_jobs TO app_ledger;



GRANT ALL ON TABLE public.fin_transactions TO anon;
GRANT ALL ON TABLE public.fin_transactions TO authenticated;
GRANT ALL ON TABLE public.fin_transactions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_transactions TO app_ledger;



GRANT ALL ON TABLE public.flow_groups TO anon;
GRANT ALL ON TABLE public.flow_groups TO authenticated;
GRANT ALL ON TABLE public.flow_groups TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.flow_groups TO app_ledger;



GRANT ALL ON TABLE public.flow_groups_backup_20260604 TO anon;
GRANT ALL ON TABLE public.flow_groups_backup_20260604 TO authenticated;
GRANT ALL ON TABLE public.flow_groups_backup_20260604 TO service_role;



GRANT ALL ON TABLE public.flow_runs TO anon;
GRANT ALL ON TABLE public.flow_runs TO authenticated;
GRANT ALL ON TABLE public.flow_runs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.flow_runs TO app_ledger;



GRANT ALL ON TABLE public.flow_var_exports TO anon;
GRANT ALL ON TABLE public.flow_var_exports TO authenticated;
GRANT ALL ON TABLE public.flow_var_exports TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.flow_var_exports TO app_ledger;



GRANT ALL ON TABLE public.flows TO anon;
GRANT ALL ON TABLE public.flows TO authenticated;
GRANT ALL ON TABLE public.flows TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.flows TO app_ledger;



GRANT ALL ON TABLE public.flows_backup_20260604 TO anon;
GRANT ALL ON TABLE public.flows_backup_20260604 TO authenticated;
GRANT ALL ON TABLE public.flows_backup_20260604 TO service_role;



GRANT ALL ON TABLE public.flows_backup_20260605_triage TO anon;
GRANT ALL ON TABLE public.flows_backup_20260605_triage TO authenticated;
GRANT ALL ON TABLE public.flows_backup_20260605_triage TO service_role;



GRANT ALL ON TABLE public.gateway TO anon;
GRANT ALL ON TABLE public.gateway TO authenticated;
GRANT ALL ON TABLE public.gateway TO service_role;



GRANT ALL ON TABLE public.gateway_lease TO anon;
GRANT ALL ON TABLE public.gateway_lease TO authenticated;
GRANT ALL ON TABLE public.gateway_lease TO service_role;



GRANT ALL ON TABLE public.gateway_signing_keys TO anon;
GRANT ALL ON TABLE public.gateway_signing_keys TO authenticated;
GRANT ALL ON TABLE public.gateway_signing_keys TO service_role;



GRANT ALL ON TABLE public.hr_employees TO anon;
GRANT ALL ON TABLE public.hr_employees TO authenticated;
GRANT ALL ON TABLE public.hr_employees TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_employees TO app_ledger;



GRANT ALL ON TABLE public.hr_holidays TO anon;
GRANT ALL ON TABLE public.hr_holidays TO authenticated;
GRANT ALL ON TABLE public.hr_holidays TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_holidays TO app_ledger;



GRANT ALL ON TABLE public.hr_leave_allocations TO anon;
GRANT ALL ON TABLE public.hr_leave_allocations TO authenticated;
GRANT ALL ON TABLE public.hr_leave_allocations TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_leave_allocations TO app_ledger;



GRANT ALL ON TABLE public.hr_leave_requests TO anon;
GRANT ALL ON TABLE public.hr_leave_requests TO authenticated;
GRANT ALL ON TABLE public.hr_leave_requests TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_leave_requests TO app_ledger;



GRANT ALL ON TABLE public.hr_leave_types TO anon;
GRANT ALL ON TABLE public.hr_leave_types TO authenticated;
GRANT ALL ON TABLE public.hr_leave_types TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_leave_types TO app_ledger;



GRANT ALL ON TABLE public.hr_settings TO anon;
GRANT ALL ON TABLE public.hr_settings TO authenticated;
GRANT ALL ON TABLE public.hr_settings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_settings TO app_ledger;



GRANT ALL ON TABLE public.hub_migrations TO anon;
GRANT ALL ON TABLE public.hub_migrations TO authenticated;
GRANT ALL ON TABLE public.hub_migrations TO service_role;



GRANT ALL ON TABLE public.identity_subscriptions TO anon;
GRANT ALL ON TABLE public.identity_subscriptions TO authenticated;
GRANT ALL ON TABLE public.identity_subscriptions TO service_role;



GRANT ALL ON TABLE public.job_effect_batches TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.job_effect_batches TO app_ledger;



GRANT ALL ON TABLE public.job_effect_pages TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.job_effect_pages TO app_ledger;



GRANT ALL ON TABLE public.job_effect_units TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.job_effect_units TO app_ledger;



GRANT ALL ON TABLE public.job_effects TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.job_effects TO app_ledger;



GRANT ALL ON TABLE public.join_link TO anon;
GRANT ALL ON TABLE public.join_link TO authenticated;
GRANT ALL ON TABLE public.join_link TO service_role;



GRANT ALL ON TABLE public.join_request TO anon;
GRANT ALL ON TABLE public.join_request TO authenticated;
GRANT ALL ON TABLE public.join_request TO service_role;



GRANT ALL ON TABLE public.knowledge_chunks TO anon;
GRANT ALL ON TABLE public.knowledge_chunks TO authenticated;
GRANT ALL ON TABLE public.knowledge_chunks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.knowledge_chunks TO app_ledger;



GRANT ALL ON TABLE public.knowledge_documents TO anon;
GRANT ALL ON TABLE public.knowledge_documents TO authenticated;
GRANT ALL ON TABLE public.knowledge_documents TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.knowledge_documents TO app_ledger;



GRANT ALL ON TABLE public.knowledge_sources TO anon;
GRANT ALL ON TABLE public.knowledge_sources TO authenticated;
GRANT ALL ON TABLE public.knowledge_sources TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.knowledge_sources TO app_ledger;



GRANT ALL ON TABLE public.marketplace_agents TO anon;
GRANT ALL ON TABLE public.marketplace_agents TO authenticated;
GRANT ALL ON TABLE public.marketplace_agents TO service_role;



GRANT ALL ON TABLE public.marketplace_installs TO anon;
GRANT ALL ON TABLE public.marketplace_installs TO authenticated;
GRANT ALL ON TABLE public.marketplace_installs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.marketplace_installs TO app_ledger;



GRANT ALL ON TABLE public.member_roles TO anon;
GRANT ALL ON TABLE public.member_roles TO authenticated;
GRANT ALL ON TABLE public.member_roles TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.member_roles TO app_ledger;



GRANT ALL ON TABLE public.membership_cycles TO anon;
GRANT ALL ON TABLE public.membership_cycles TO authenticated;
GRANT ALL ON TABLE public.membership_cycles TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.membership_cycles TO app_ledger;
GRANT SELECT ON TABLE public.membership_cycles TO app_assistant_ro;



GRANT ALL ON TABLE public.membership_plans TO anon;
GRANT ALL ON TABLE public.membership_plans TO authenticated;
GRANT ALL ON TABLE public.membership_plans TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.membership_plans TO app_ledger;
GRANT SELECT ON TABLE public.membership_plans TO app_assistant_ro;



GRANT ALL ON TABLE public.memberships TO anon;
GRANT ALL ON TABLE public.memberships TO authenticated;
GRANT ALL ON TABLE public.memberships TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.memberships TO app_ledger;
GRANT SELECT ON TABLE public.memberships TO app_assistant_ro;



GRANT ALL ON TABLE public.meta_ad_insights TO anon;
GRANT ALL ON TABLE public.meta_ad_insights TO authenticated;
GRANT ALL ON TABLE public.meta_ad_insights TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meta_ad_insights TO app_ledger;



GRANT ALL ON TABLE public.meta_ad_posts TO anon;
GRANT ALL ON TABLE public.meta_ad_posts TO authenticated;
GRANT ALL ON TABLE public.meta_ad_posts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meta_ad_posts TO app_ledger;



GRANT ALL ON TABLE public.meta_assets TO anon;
GRANT ALL ON TABLE public.meta_assets TO authenticated;
GRANT ALL ON TABLE public.meta_assets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meta_assets TO app_ledger;



GRANT ALL ON TABLE public.meta_connections TO anon;
GRANT ALL ON TABLE public.meta_connections TO authenticated;
GRANT ALL ON TABLE public.meta_connections TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meta_connections TO app_ledger;



GRANT ALL ON TABLE public.meta_lead_attribution TO anon;
GRANT ALL ON TABLE public.meta_lead_attribution TO authenticated;
GRANT ALL ON TABLE public.meta_lead_attribution TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meta_lead_attribution TO app_ledger;



GRANT ALL ON TABLE public.meta_post_insights TO anon;
GRANT ALL ON TABLE public.meta_post_insights TO authenticated;
GRANT ALL ON TABLE public.meta_post_insights TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meta_post_insights TO app_ledger;



GRANT ALL ON TABLE public.meta_post_media TO anon;
GRANT ALL ON TABLE public.meta_post_media TO authenticated;
GRANT ALL ON TABLE public.meta_post_media TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meta_post_media TO app_ledger;



GRANT ALL ON TABLE public.meta_sync_jobs TO anon;
GRANT ALL ON TABLE public.meta_sync_jobs TO authenticated;
GRANT ALL ON TABLE public.meta_sync_jobs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meta_sync_jobs TO app_ledger;



GRANT ALL ON TABLE public.missions TO anon;
GRANT ALL ON TABLE public.missions TO authenticated;
GRANT ALL ON TABLE public.missions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.missions TO app_ledger;



GRANT ALL ON TABLE public.naming_series_counters TO anon;
GRANT ALL ON TABLE public.naming_series_counters TO authenticated;
GRANT ALL ON TABLE public.naming_series_counters TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.naming_series_counters TO app_ledger;



GRANT ALL ON TABLE public.notes TO anon;
GRANT ALL ON TABLE public.notes TO authenticated;
GRANT ALL ON TABLE public.notes TO service_role;



GRANT ALL ON TABLE public.notif_log TO anon;
GRANT ALL ON TABLE public.notif_log TO authenticated;
GRANT ALL ON TABLE public.notif_log TO service_role;
GRANT SELECT,INSERT ON TABLE public.notif_log TO app_ledger;
GRANT SELECT ON TABLE public.notif_log TO app_assistant_ro;



GRANT ALL ON TABLE public.notif_rules TO anon;
GRANT ALL ON TABLE public.notif_rules TO authenticated;
GRANT ALL ON TABLE public.notif_rules TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notif_rules TO app_ledger;



GRANT ALL ON TABLE public.org_areas TO anon;
GRANT ALL ON TABLE public.org_areas TO authenticated;
GRANT ALL ON TABLE public.org_areas TO service_role;
GRANT SELECT ON TABLE public.org_areas TO app_ledger;



GRANT ALL ON TABLE public.org_provision_runs TO anon;
GRANT ALL ON TABLE public.org_provision_runs TO authenticated;
GRANT ALL ON TABLE public.org_provision_runs TO service_role;



GRANT ALL ON TABLE public.org_roles TO anon;
GRANT ALL ON TABLE public.org_roles TO authenticated;
GRANT ALL ON TABLE public.org_roles TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.org_roles TO app_ledger;



GRANT ALL ON TABLE public.organization_members TO anon;
GRANT ALL ON TABLE public.organization_members TO authenticated;
GRANT ALL ON TABLE public.organization_members TO service_role;
GRANT SELECT ON TABLE public.organization_members TO app_ledger;



GRANT ALL ON TABLE public.organizations TO anon;
GRANT ALL ON TABLE public.organizations TO authenticated;
GRANT ALL ON TABLE public.organizations TO service_role;



GRANT ALL ON TABLE public.parties TO anon;
GRANT ALL ON TABLE public.parties TO authenticated;
GRANT ALL ON TABLE public.parties TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.parties TO app_ledger;
GRANT SELECT ON TABLE public.parties TO app_assistant_ro;



GRANT ALL ON TABLE public.pending_channel_claims TO anon;
GRANT ALL ON TABLE public.pending_channel_claims TO authenticated;
GRANT ALL ON TABLE public.pending_channel_claims TO service_role;



GRANT ALL ON TABLE public.permission_roles TO anon;
GRANT ALL ON TABLE public.permission_roles TO authenticated;
GRANT ALL ON TABLE public.permission_roles TO service_role;
GRANT SELECT ON TABLE public.permission_roles TO app_ledger;



GRANT ALL ON TABLE public.permission_rules TO anon;
GRANT ALL ON TABLE public.permission_rules TO authenticated;
GRANT ALL ON TABLE public.permission_rules TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.permission_rules TO app_ledger;



GRANT ALL ON TABLE public.personal_agents TO anon;
GRANT ALL ON TABLE public.personal_agents TO authenticated;
GRANT ALL ON TABLE public.personal_agents TO service_role;



GRANT ALL ON TABLE public.plugin_org_disabled TO anon;
GRANT ALL ON TABLE public.plugin_org_disabled TO authenticated;
GRANT ALL ON TABLE public.plugin_org_disabled TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.plugin_org_disabled TO app_ledger;



GRANT ALL ON TABLE public.pos_client_ledger TO anon;
GRANT ALL ON TABLE public.pos_client_ledger TO authenticated;
GRANT ALL ON TABLE public.pos_client_ledger TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_client_ledger TO app_ledger;



GRANT ALL ON TABLE public.pos_emissions TO anon;
GRANT ALL ON TABLE public.pos_emissions TO authenticated;
GRANT ALL ON TABLE public.pos_emissions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_emissions TO app_ledger;



GRANT ALL ON TABLE public.pos_package_grants TO anon;
GRANT ALL ON TABLE public.pos_package_grants TO authenticated;
GRANT ALL ON TABLE public.pos_package_grants TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_package_grants TO app_ledger;



GRANT ALL ON TABLE public.pos_package_redemptions TO anon;
GRANT ALL ON TABLE public.pos_package_redemptions TO authenticated;
GRANT ALL ON TABLE public.pos_package_redemptions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_package_redemptions TO app_ledger;



GRANT ALL ON TABLE public.pos_payment_plans TO anon;
GRANT ALL ON TABLE public.pos_payment_plans TO authenticated;
GRANT ALL ON TABLE public.pos_payment_plans TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_payment_plans TO app_ledger;



GRANT ALL ON TABLE public.pos_payments TO anon;
GRANT ALL ON TABLE public.pos_payments TO authenticated;
GRANT ALL ON TABLE public.pos_payments TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_payments TO app_ledger;



GRANT ALL ON TABLE public.pos_series TO anon;
GRANT ALL ON TABLE public.pos_series TO authenticated;
GRANT ALL ON TABLE public.pos_series TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_series TO app_ledger;



GRANT ALL ON TABLE public.pos_settings TO anon;
GRANT ALL ON TABLE public.pos_settings TO authenticated;
GRANT ALL ON TABLE public.pos_settings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_settings TO app_ledger;



GRANT ALL ON TABLE public.pos_shifts TO anon;
GRANT ALL ON TABLE public.pos_shifts TO authenticated;
GRANT ALL ON TABLE public.pos_shifts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_shifts TO app_ledger;



GRANT ALL ON TABLE public.pos_ticket_lines TO anon;
GRANT ALL ON TABLE public.pos_ticket_lines TO authenticated;
GRANT ALL ON TABLE public.pos_ticket_lines TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_ticket_lines TO app_ledger;



GRANT ALL ON TABLE public.pos_tickets TO anon;
GRANT ALL ON TABLE public.pos_tickets TO authenticated;
GRANT ALL ON TABLE public.pos_tickets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_tickets TO app_ledger;



GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO app_ledger;



GRANT ALL ON TABLE public.profiles_legacy_user_id_backup_20260610 TO anon;
GRANT ALL ON TABLE public.profiles_legacy_user_id_backup_20260610 TO authenticated;
GRANT ALL ON TABLE public.profiles_legacy_user_id_backup_20260610 TO service_role;



GRANT ALL ON TABLE public.proj_projects TO anon;
GRANT ALL ON TABLE public.proj_projects TO authenticated;
GRANT ALL ON TABLE public.proj_projects TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.proj_projects TO app_ledger;
GRANT SELECT ON TABLE public.proj_projects TO app_assistant_ro;



GRANT ALL ON TABLE public.proj_tasks TO anon;
GRANT ALL ON TABLE public.proj_tasks TO authenticated;
GRANT ALL ON TABLE public.proj_tasks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.proj_tasks TO app_ledger;
GRANT SELECT ON TABLE public.proj_tasks TO app_assistant_ro;



GRANT ALL ON TABLE public.proj_templates TO anon;
GRANT ALL ON TABLE public.proj_templates TO authenticated;
GRANT ALL ON TABLE public.proj_templates TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.proj_templates TO app_ledger;
GRANT SELECT ON TABLE public.proj_templates TO app_assistant_ro;



GRANT ALL ON TABLE public.proj_timesheets TO anon;
GRANT ALL ON TABLE public.proj_timesheets TO authenticated;
GRANT ALL ON TABLE public.proj_timesheets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.proj_timesheets TO app_ledger;
GRANT SELECT ON TABLE public.proj_timesheets TO app_assistant_ro;



GRANT ALL ON TABLE public.pulse_proposals TO anon;
GRANT ALL ON TABLE public.pulse_proposals TO authenticated;
GRANT ALL ON TABLE public.pulse_proposals TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pulse_proposals TO app_ledger;



GRANT ALL ON TABLE public.pulse_settings TO anon;
GRANT ALL ON TABLE public.pulse_settings TO authenticated;
GRANT ALL ON TABLE public.pulse_settings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pulse_settings TO app_ledger;



GRANT ALL ON TABLE public.sales_orders TO anon;
GRANT ALL ON TABLE public.sales_orders TO authenticated;
GRANT ALL ON TABLE public.sales_orders TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sales_orders TO app_ledger;
GRANT SELECT ON TABLE public.sales_orders TO app_assistant_ro;



GRANT ALL ON TABLE public.sched_availability TO anon;
GRANT ALL ON TABLE public.sched_availability TO authenticated;
GRANT ALL ON TABLE public.sched_availability TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_availability TO app_ledger;
GRANT SELECT ON TABLE public.sched_availability TO app_assistant_ro;



GRANT ALL ON TABLE public.sched_booking_status_log TO anon;
GRANT ALL ON TABLE public.sched_booking_status_log TO authenticated;
GRANT ALL ON TABLE public.sched_booking_status_log TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_booking_status_log TO app_ledger;



GRANT ALL ON TABLE public.sched_bookings TO anon;
GRANT ALL ON TABLE public.sched_bookings TO authenticated;
GRANT ALL ON TABLE public.sched_bookings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_bookings TO app_ledger;
GRANT SELECT ON TABLE public.sched_bookings TO app_assistant_ro;



GRANT ALL ON TABLE public.sched_event_kinds TO anon;
GRANT ALL ON TABLE public.sched_event_kinds TO authenticated;
GRANT ALL ON TABLE public.sched_event_kinds TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_event_kinds TO app_ledger;



GRANT ALL ON TABLE public.sched_event_type_resources TO anon;
GRANT ALL ON TABLE public.sched_event_type_resources TO authenticated;
GRANT ALL ON TABLE public.sched_event_type_resources TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_event_type_resources TO app_ledger;
GRANT SELECT ON TABLE public.sched_event_type_resources TO app_assistant_ro;



GRANT ALL ON TABLE public.sched_event_types TO anon;
GRANT ALL ON TABLE public.sched_event_types TO authenticated;
GRANT ALL ON TABLE public.sched_event_types TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_event_types TO app_ledger;
GRANT SELECT ON TABLE public.sched_event_types TO app_assistant_ro;



GRANT ALL ON TABLE public.sched_links TO anon;
GRANT ALL ON TABLE public.sched_links TO authenticated;
GRANT ALL ON TABLE public.sched_links TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_links TO app_ledger;
GRANT SELECT ON TABLE public.sched_links TO app_assistant_ro;



GRANT ALL ON TABLE public.sched_reminder_config TO anon;
GRANT ALL ON TABLE public.sched_reminder_config TO authenticated;
GRANT ALL ON TABLE public.sched_reminder_config TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_reminder_config TO app_ledger;



GRANT ALL ON TABLE public.sched_reminders TO anon;
GRANT ALL ON TABLE public.sched_reminders TO authenticated;
GRANT ALL ON TABLE public.sched_reminders TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_reminders TO app_ledger;
GRANT SELECT ON TABLE public.sched_reminders TO app_assistant_ro;



GRANT ALL ON TABLE public.sched_resources TO anon;
GRANT ALL ON TABLE public.sched_resources TO authenticated;
GRANT ALL ON TABLE public.sched_resources TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_resources TO app_ledger;
GRANT SELECT ON TABLE public.sched_resources TO app_assistant_ro;



GRANT ALL ON TABLE public.sched_schedules TO anon;
GRANT ALL ON TABLE public.sched_schedules TO authenticated;
GRANT ALL ON TABLE public.sched_schedules TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sched_schedules TO app_ledger;
GRANT SELECT ON TABLE public.sched_schedules TO app_assistant_ro;



GRANT ALL ON TABLE public.server_backups TO anon;
GRANT ALL ON TABLE public.server_backups TO authenticated;
GRANT ALL ON TABLE public.server_backups TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.server_backups TO app_ledger;



GRANT ALL ON TABLE public.server_provision_configs TO anon;
GRANT ALL ON TABLE public.server_provision_configs TO authenticated;
GRANT ALL ON TABLE public.server_provision_configs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.server_provision_configs TO app_ledger;



GRANT ALL ON TABLE public.session_tasks TO anon;
GRANT ALL ON TABLE public.session_tasks TO authenticated;
GRANT ALL ON TABLE public.session_tasks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.session_tasks TO app_ledger;



GRANT ALL ON TABLE public.sessions TO anon;
GRANT ALL ON TABLE public.sessions TO authenticated;
GRANT ALL ON TABLE public.sessions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sessions TO app_ledger;



GRANT ALL ON TABLE public.settings TO anon;
GRANT ALL ON TABLE public.settings TO authenticated;
GRANT ALL ON TABLE public.settings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.settings TO app_ledger;



GRANT ALL ON TABLE public.skill_execution_stats TO anon;
GRANT ALL ON TABLE public.skill_execution_stats TO authenticated;
GRANT ALL ON TABLE public.skill_execution_stats TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.skill_execution_stats TO app_ledger;



GRANT ALL ON SEQUENCE public.skill_execution_stats_id_seq TO anon;
GRANT ALL ON SEQUENCE public.skill_execution_stats_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.skill_execution_stats_id_seq TO service_role;



GRANT ALL ON TABLE public.skills TO anon;
GRANT ALL ON TABLE public.skills TO authenticated;
GRANT ALL ON TABLE public.skills TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.skills TO app_ledger;



GRANT ALL ON TABLE public.stk_accruals TO anon;
GRANT ALL ON TABLE public.stk_accruals TO authenticated;
GRANT ALL ON TABLE public.stk_accruals TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stk_accruals TO app_ledger;



GRANT ALL ON TABLE public.stk_bins TO anon;
GRANT ALL ON TABLE public.stk_bins TO authenticated;
GRANT ALL ON TABLE public.stk_bins TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stk_bins TO app_ledger;



GRANT ALL ON TABLE public.stk_bins_bak_insumos2608 TO anon;
GRANT ALL ON TABLE public.stk_bins_bak_insumos2608 TO authenticated;
GRANT ALL ON TABLE public.stk_bins_bak_insumos2608 TO service_role;



GRANT ALL ON TABLE public.stk_consumption TO anon;
GRANT ALL ON TABLE public.stk_consumption TO authenticated;
GRANT ALL ON TABLE public.stk_consumption TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stk_consumption TO app_ledger;



GRANT ALL ON TABLE public.stk_consumption_bak_insumos2608 TO anon;
GRANT ALL ON TABLE public.stk_consumption_bak_insumos2608 TO authenticated;
GRANT ALL ON TABLE public.stk_consumption_bak_insumos2608 TO service_role;



GRANT ALL ON TABLE public.stk_entries TO anon;
GRANT ALL ON TABLE public.stk_entries TO authenticated;
GRANT ALL ON TABLE public.stk_entries TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stk_entries TO app_ledger;



GRANT ALL ON TABLE public.stk_entries_bak_repair TO anon;
GRANT ALL ON TABLE public.stk_entries_bak_repair TO authenticated;
GRANT ALL ON TABLE public.stk_entries_bak_repair TO service_role;



GRANT ALL ON TABLE public.stk_entries_reclass_bak TO anon;
GRANT ALL ON TABLE public.stk_entries_reclass_bak TO authenticated;
GRANT ALL ON TABLE public.stk_entries_reclass_bak TO service_role;



GRANT ALL ON TABLE public.stk_entry_lines TO anon;
GRANT ALL ON TABLE public.stk_entry_lines TO authenticated;
GRANT ALL ON TABLE public.stk_entry_lines TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stk_entry_lines TO app_ledger;



GRANT ALL ON TABLE public.stk_item_components TO anon;
GRANT ALL ON TABLE public.stk_item_components TO authenticated;
GRANT ALL ON TABLE public.stk_item_components TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stk_item_components TO app_ledger;



GRANT ALL ON TABLE public.stk_items TO anon;
GRANT ALL ON TABLE public.stk_items TO authenticated;
GRANT ALL ON TABLE public.stk_items TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stk_items TO app_ledger;



GRANT ALL ON TABLE public.stk_items_bak_insumos2608 TO anon;
GRANT ALL ON TABLE public.stk_items_bak_insumos2608 TO authenticated;
GRANT ALL ON TABLE public.stk_items_bak_insumos2608 TO service_role;



GRANT ALL ON TABLE public.stk_ledger TO anon;
GRANT ALL ON TABLE public.stk_ledger TO authenticated;
GRANT ALL ON TABLE public.stk_ledger TO service_role;
GRANT SELECT,INSERT ON TABLE public.stk_ledger TO app_ledger;



GRANT ALL ON TABLE public.stk_ledger_bak_repair TO anon;
GRANT ALL ON TABLE public.stk_ledger_bak_repair TO authenticated;
GRANT ALL ON TABLE public.stk_ledger_bak_repair TO service_role;



GRANT ALL ON SEQUENCE public.stk_ledger_id_seq TO anon;
GRANT ALL ON SEQUENCE public.stk_ledger_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.stk_ledger_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.stk_ledger_id_seq TO app_ledger;



GRANT ALL ON TABLE public.stk_warehouses TO anon;
GRANT ALL ON TABLE public.stk_warehouses TO authenticated;
GRANT ALL ON TABLE public.stk_warehouses TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stk_warehouses TO app_ledger;



GRANT ALL ON TABLE public.support_issues TO anon;
GRANT ALL ON TABLE public.support_issues TO authenticated;
GRANT ALL ON TABLE public.support_issues TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.support_issues TO app_ledger;
GRANT SELECT ON TABLE public.support_issues TO app_assistant_ro;



GRANT ALL ON TABLE public.support_settings TO anon;
GRANT ALL ON TABLE public.support_settings TO authenticated;
GRANT ALL ON TABLE public.support_settings TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.support_settings TO app_ledger;



GRANT ALL ON TABLE public.tag_links TO anon;
GRANT ALL ON TABLE public.tag_links TO authenticated;
GRANT ALL ON TABLE public.tag_links TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tag_links TO app_ledger;



GRANT ALL ON TABLE public.tasks TO anon;
GRANT ALL ON TABLE public.tasks TO authenticated;
GRANT ALL ON TABLE public.tasks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tasks TO app_ledger;



GRANT ALL ON TABLE public.user_agents TO anon;
GRANT ALL ON TABLE public.user_agents TO authenticated;
GRANT ALL ON TABLE public.user_agents TO service_role;



GRANT ALL ON TABLE public.user_gateway TO anon;
GRANT ALL ON TABLE public.user_gateway TO authenticated;
GRANT ALL ON TABLE public.user_gateway TO service_role;



GRANT ALL ON TABLE public.user_identities TO anon;
GRANT ALL ON TABLE public.user_identities TO authenticated;
GRANT ALL ON TABLE public.user_identities TO service_role;



GRANT ALL ON TABLE public.user_preferences TO anon;
GRANT ALL ON TABLE public.user_preferences TO authenticated;
GRANT ALL ON TABLE public.user_preferences TO service_role;



GRANT ALL ON TABLE public.workflow_defs TO anon;
GRANT ALL ON TABLE public.workflow_defs TO authenticated;
GRANT ALL ON TABLE public.workflow_defs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workflow_defs TO app_ledger;



GRANT ALL ON TABLE public.workshop_comparison_outputs TO anon;
GRANT ALL ON TABLE public.workshop_comparison_outputs TO authenticated;
GRANT ALL ON TABLE public.workshop_comparison_outputs TO service_role;



GRANT ALL ON TABLE public.workshop_comparison_runs TO anon;
GRANT ALL ON TABLE public.workshop_comparison_runs TO authenticated;
GRANT ALL ON TABLE public.workshop_comparison_runs TO service_role;



GRANT ALL ON TABLE public.workshop_groupchat_agents TO anon;
GRANT ALL ON TABLE public.workshop_groupchat_agents TO authenticated;
GRANT ALL ON TABLE public.workshop_groupchat_agents TO service_role;



GRANT ALL ON TABLE public.workshop_groupchat_messages TO anon;
GRANT ALL ON TABLE public.workshop_groupchat_messages TO authenticated;
GRANT ALL ON TABLE public.workshop_groupchat_messages TO service_role;



GRANT ALL ON TABLE public.workshop_groupchat_runs TO anon;
GRANT ALL ON TABLE public.workshop_groupchat_runs TO authenticated;
GRANT ALL ON TABLE public.workshop_groupchat_runs TO service_role;



GRANT ALL ON TABLE public.workshop_prompt_categories TO anon;
GRANT ALL ON TABLE public.workshop_prompt_categories TO authenticated;
GRANT ALL ON TABLE public.workshop_prompt_categories TO service_role;



GRANT ALL ON TABLE public.workshop_rankings TO anon;
GRANT ALL ON TABLE public.workshop_rankings TO authenticated;
GRANT ALL ON TABLE public.workshop_rankings TO service_role;



GRANT ALL ON TABLE public.workshop_saves TO anon;
GRANT ALL ON TABLE public.workshop_saves TO authenticated;
GRANT ALL ON TABLE public.workshop_saves TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workshop_saves TO app_ledger;



GRANT ALL ON TABLE public.workspace_membership TO anon;
GRANT ALL ON TABLE public.workspace_membership TO authenticated;
GRANT ALL ON TABLE public.workspace_membership TO service_role;



ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;



ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;



ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;



ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;



ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;



ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;
