-- Durable attachment identity and deletion admission. No storage/network work.
-- Refuse inconsistent legacy tenants rather than reassigning customer files.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.attachment_links l LEFT JOIN public.files f ON f.id=l.file_id
    WHERE f.id IS NULL OR l.org_id<>f.tenant_id::text) THEN
    RAISE EXCEPTION 'attachment links require tenant/file reconciliation before lifecycle migration';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.attachment_file_state (
  file_id text PRIMARY KEY,
  org_id text NOT NULL,
  file_key text NOT NULL,
  access_modules text[] NOT NULL DEFAULT '{}' CHECK (access_modules <@ ARRAY['crm','scheduling','pos','stock','finance']::text[]),
  delete_attempted_at timestamptz,
  upload_expires_at timestamptz,
  delete_reconciled_at timestamptz,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','deleting')),
  delete_requested_by uuid,
  delete_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state='active' AND delete_requested_at IS NULL) OR (state='deleting' AND delete_requested_at IS NOT NULL))
);
INSERT INTO public.attachment_file_state(file_id,org_id,file_key,access_modules,upload_expires_at)
SELECT f.id,f.tenant_id::text,f.b2_file_key,ARRAY(SELECT DISTINCT CASE l.object_type WHEN 'crm_contact' THEN 'crm' WHEN 'booking' THEN 'scheduling' WHEN 'event_type' THEN 'scheduling' WHEN 'product' THEN 'pos' WHEN 'pos_ticket' THEN 'pos' WHEN 'stk_item' THEN 'stock' WHEN 'stk_entry' THEN 'stock' WHEN 'fin_invoice' THEN 'finance' END
 FROM public.attachment_links l WHERE l.file_id=f.id AND l.org_id=f.tenant_id::text),
 CASE WHEN f.category='attachment' OR f.b2_file_key LIKE f.tenant_id::text || '/attachments/%' THEN now()+interval '15 minutes' END FROM public.files f
WHERE f.category='attachment' OR f.b2_file_key LIKE f.tenant_id::text || '/attachments/%'
  OR EXISTS (SELECT 1 FROM public.attachment_links l WHERE l.file_id=f.id)
ON CONFLICT (file_id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.attachment_file_state s JOIN public.files f ON f.id=s.file_id
    WHERE s.org_id<>f.tenant_id::text OR s.file_key<>f.b2_file_key) THEN
    RAISE EXCEPTION 'attachment lifecycle identity mismatch';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS attachment_file_state_pending_idx
  ON public.attachment_file_state(org_id,COALESCE(delete_attempted_at,delete_requested_at),file_id) WHERE state='deleting';
REVOKE ALL ON TABLE public.attachment_file_state FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE public.attachment_file_state FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE public.attachment_file_state FROM authenticated;
  END IF;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.attachment_file_state TO app_ledger;
ALTER TABLE public.attachment_file_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachment_file_state FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attachment_file_state' AND policyname='attachment_file_state_org_guc') THEN
    CREATE POLICY attachment_file_state_org_guc ON public.attachment_file_state FOR ALL TO app_ledger
      USING (org_id=current_setting('app.current_org_id',true))
      WITH CHECK (org_id=current_setting('app.current_org_id',true));
  END IF;
END $$;

ALTER POLICY attachment_file_state_org_guc ON public.attachment_file_state TO app_ledger;

CREATE OR REPLACE FUNCTION public.guard_attachment_file_state() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$ BEGIN
  IF NEW.file_id<>OLD.file_id OR NEW.org_id<>OLD.org_id OR NEW.file_key<>OLD.file_key
     OR NOT (OLD.access_modules <@ NEW.access_modules)
     OR (OLD.state='deleting' AND NEW.state<>'deleting') THEN
    RAISE EXCEPTION 'attachment lifecycle identity and deletion are immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_attachment_file_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_attachment_file_state() TO app_ledger;
DROP TRIGGER IF EXISTS attachment_file_state_immutable ON public.attachment_file_state;
CREATE TRIGGER attachment_file_state_immutable BEFORE UPDATE ON public.attachment_file_state
FOR EACH ROW EXECUTE FUNCTION public.guard_attachment_file_state();

-- Keep the source file identity aligned with its durable registration even if a
-- future metadata endpoint starts accepting key/tenant changes.
CREATE OR REPLACE FUNCTION public.guard_managed_file_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$ BEGIN
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
REVOKE ALL ON FUNCTION public.guard_managed_file_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_managed_file_identity() TO app_ledger;
DROP TRIGGER IF EXISTS managed_attachment_identity ON public.files;
CREATE TRIGGER managed_attachment_identity BEFORE INSERT OR UPDATE OF id,tenant_id,b2_file_key ON public.files
FOR EACH ROW EXECUTE FUNCTION public.guard_managed_file_identity();

-- Invoker rights: original record operation remains the authorization boundary;
-- app_ledger has only its existing tenant-scoped privileges. No provider I/O.
-- Record row is already held; file rows are locked in stable ID order.
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
  DELETE FROM public.attachment_links
    WHERE org_id=OLD.org_id AND object_type=object_kind AND object_id=OLD.id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.detach_deleted_record_attachments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detach_deleted_record_attachments() TO app_ledger;

DROP TRIGGER IF EXISTS attachment_record_deleted ON public.crm_contacts;
CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.crm_contacts
FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();

DROP TRIGGER IF EXISTS attachment_record_deleted ON public.sched_bookings;
CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.sched_bookings
FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();

DROP TRIGGER IF EXISTS attachment_record_deleted ON public.sched_event_types;
CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.sched_event_types
FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();

DROP TRIGGER IF EXISTS attachment_record_deleted ON public.fin_products;
CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.fin_products
FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();

DROP TRIGGER IF EXISTS attachment_record_deleted ON public.stk_items;
CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.stk_items
FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();

DROP TRIGGER IF EXISTS attachment_record_deleted ON public.stk_entries;
CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.stk_entries
FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();

DROP TRIGGER IF EXISTS attachment_record_deleted ON public.fin_invoices;
CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.fin_invoices
FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();

DROP TRIGGER IF EXISTS attachment_record_deleted ON public.pos_tickets;
CREATE TRIGGER attachment_record_deleted AFTER DELETE ON public.pos_tickets
FOR EACH ROW EXECUTE FUNCTION public.detach_deleted_record_attachments();

DROP TRIGGER IF EXISTS attachment_contact_soft_deleted ON public.crm_contacts;
CREATE TRIGGER attachment_contact_soft_deleted AFTER UPDATE OF deleted_at ON public.crm_contacts
FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION public.detach_deleted_record_attachments();
