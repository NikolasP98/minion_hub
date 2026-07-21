-- Rollout phase 1: add the tenant-local target while the old production code
-- can still conflict on messages_client_id_uniq. The global index is removed
-- only after the new Hub build is live, so existing ingest stays available
-- throughout the deployment.
create unique index if not exists messages_org_client_id_uniq
  on public.messages (org_id, client_id);
