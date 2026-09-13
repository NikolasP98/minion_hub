-- Two-layer attachment deletion. Layer 1: a hidden link moves to the trash and
-- stays restorable for the retention window (30 days, TRASH_RETENTION_DAYS in
-- attachment-lifecycle.ts). Layer 2 is unchanged: the sweeper claims files whose
-- newest trash row is older than the window and the existing deleting tombstone
-- removes the object. No storage/network work here.
CREATE TABLE IF NOT EXISTS public.attachment_trash (
  org_id text NOT NULL,
  file_id text NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('crm_contact','booking','event_type','product','stk_item','fin_invoice','stk_entry','pos_ticket')),
  object_id uuid NOT NULL,
  linked_by uuid,
  linked_at timestamptz NOT NULL,
  hidden_by uuid,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_type, object_id, file_id)
);
CREATE INDEX IF NOT EXISTS attachment_trash_org_object_idx
  ON public.attachment_trash(org_id, object_type, object_id);
CREATE INDEX IF NOT EXISTS attachment_trash_org_file_hidden_idx
  ON public.attachment_trash(org_id, file_id, hidden_at);
REVOKE ALL ON TABLE public.attachment_trash FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE public.attachment_trash FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE public.attachment_trash FROM authenticated;
  END IF;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.attachment_trash TO app_ledger;
ALTER TABLE public.attachment_trash ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachment_trash FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attachment_trash' AND policyname='attachment_trash_org_guc') THEN
    CREATE POLICY attachment_trash_org_guc ON public.attachment_trash FOR ALL TO app_ledger
      USING (org_id=current_setting('app.current_org_id',true))
      WITH CHECK (org_id=current_setting('app.current_org_id',true));
  END IF;
END $$;

-- Record deletion now hides the record's links (layer 1) instead of dropping
-- them. Same lock order and registration as before; only the final DELETE
-- becomes a move. Privileges and the eight triggers are unchanged.
CREATE OR REPLACE FUNCTION public.detach_deleted_record_attachments() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
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
