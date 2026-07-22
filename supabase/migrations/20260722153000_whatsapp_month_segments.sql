-- WhatsApp canonical corpus v2: lifetime conversation documents are replaced
-- by stable UTC-calendar-month segments. Remove legacy chunks immediately so
-- retrieval cannot return stale duplicate lifetime documents; the bounded
-- reconciliation job repopulates monthly documents idempotently.
with legacy as (
  update public.knowledge_documents document
  set status = 'deleted', ingested_at = now(), updated_at = now()
  from public.knowledge_sources source
  where source.id = document.source_id
    and source.org_id = document.org_id
    and source.connector = 'whatsapp'
    and document.status <> 'deleted'
    and not (document.metadata ? 'segmentMonth')
  returning document.id
)
delete from public.knowledge_chunks chunk
using legacy
where chunk.document_id = legacy.id;

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
