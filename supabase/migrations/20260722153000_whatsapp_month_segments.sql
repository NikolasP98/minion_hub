-- WhatsApp canonical corpus v2: lifetime conversation documents are replaced
-- by stable UTC-calendar-month segments. Remove legacy chunks immediately so
-- retrieval cannot return stale duplicate lifetime documents; the bounded
-- reconciliation job repopulates monthly documents idempotently.
set local lock_timeout = '5s';
set local statement_timeout = '10min';

do $$
declare
  affected integer;
begin
  loop
    with batch as (
      select document.id
      from public.knowledge_documents document
      join public.knowledge_sources source
        on source.id = document.source_id
       and source.org_id = document.org_id
      where source.connector = 'whatsapp'
        and document.status <> 'deleted'
        and not (document.metadata ? 'segmentMonth')
      order by document.id
      limit 500
    )
    update public.knowledge_documents document
    set status = 'deleted', ingested_at = now(), updated_at = now()
    from batch
    where document.id = batch.id;

    get diagnostics affected = row_count;
    exit when affected = 0;
  end loop;

  -- Chunk fan-out can be much larger than the document set, so bound it
  -- independently. A retry also reaches this phase when documents were
  -- already tombstoned by an earlier run.
  loop
    with batch as (
      select chunk.id
      from public.knowledge_chunks chunk
      join public.knowledge_documents document on document.id = chunk.document_id
      join public.knowledge_sources source
        on source.id = document.source_id
       and source.org_id = document.org_id
      where source.connector = 'whatsapp'
        and document.status = 'deleted'
        and not (document.metadata ? 'segmentMonth')
      order by chunk.id
      limit 5000
    )
    delete from public.knowledge_chunks chunk
    using batch
    where chunk.id = batch.id;

    get diagnostics affected = row_count;
    exit when affected = 0;
  end loop;
end
$$;

-- Retrieval authorization will intersect this safe module key with caller
-- capabilities. Merge rather than replace account/channel config.
update public.knowledge_sources
set config = config || '{"domain":"whatsapp","requiredModule":"crm","requiredFieldLevel":1}'::jsonb,
    updated_at = now()
where connector = 'whatsapp'
  and (
    config->>'requiredModule' is distinct from 'crm'
    or config->>'domain' is distinct from 'whatsapp'
    or config->>'requiredFieldLevel' is distinct from '1'
  );
