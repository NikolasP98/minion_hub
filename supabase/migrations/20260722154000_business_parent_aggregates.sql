-- Business corpus v2 collapses high-cardinality line/telemetry rows into
-- stable parent documents. Tombstone prior standalone documents before the
-- bounded reconcile recreates parent aggregates, preventing duplicate search
-- evidence during rollout.
with obsolete as (
  update public.knowledge_documents document
  set status = 'deleted', ingested_at = now(), updated_at = now()
  from public.knowledge_sources source
  where source.id = document.source_id
    and source.org_id = document.org_id
    and source.connector = 'hub-business'
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
  returning document.id
)
delete from public.knowledge_chunks chunk
using obsolete
where chunk.document_id = obsolete.id;
