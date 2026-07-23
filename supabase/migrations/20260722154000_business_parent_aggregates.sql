-- Business corpus v2 collapses high-cardinality line/telemetry rows into
-- stable parent documents. Tombstone prior standalone documents before the
-- bounded reconcile recreates parent aggregates, preventing duplicate search
-- evidence during rollout.
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
      where source.connector = 'hub-business'
        and document.status <> 'deleted'
        and (
          document.external_id like 'stk_entry_lines:%'
          or document.external_id like 'fin_invoice_items:%'
          or document.external_id like 'fin_payments:%'
          or document.external_id like 'pos_ticket_lines:%'
          or document.external_id like 'pos_payments:%'
          or document.external_id like 'meta_ad_posts:%'
          or document.metadata->>'recordType' in ('meta_post_insights', 'meta_ad_insights')
        )
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

  loop
    with batch as (
      select chunk.id
      from public.knowledge_chunks chunk
      join public.knowledge_documents document on document.id = chunk.document_id
      join public.knowledge_sources source
        on source.id = document.source_id
       and source.org_id = document.org_id
      where source.connector = 'hub-business'
        and document.status = 'deleted'
        and (
          document.external_id like 'stk_entry_lines:%'
          or document.external_id like 'fin_invoice_items:%'
          or document.external_id like 'fin_payments:%'
          or document.external_id like 'pos_ticket_lines:%'
          or document.external_id like 'pos_payments:%'
          or document.external_id like 'meta_ad_posts:%'
          or document.metadata->>'recordType' in ('meta_post_insights', 'meta_ad_insights')
        )
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
