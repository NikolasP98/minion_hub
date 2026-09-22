-- Installed under a dedicated schema. No grants on customer tables to the shadow role.
-- Schema/role ownership remains with the deployment administrator.
CREATE SCHEMA jev_shadow_source;
REVOKE ALL ON SCHEMA jev_shadow_source FROM PUBLIC;
CREATE FUNCTION jev_shadow_source.page(after_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $func$
 SELECT coalesce(jsonb_agg(row_to_json(c) ORDER BY c.contact_id),'[]'::jsonb)
 FROM (
  SELECT id AS contact_id FROM public.crm_contacts
  WHERE org_id=(SELECT id::text FROM public.organizations WHERE slug='faces-sculptors')
    AND deleted_at IS NULL AND (after_id IS NULL OR id>after_id)
  ORDER BY id LIMIT 50
 ) c
$func$;
CREATE FUNCTION jev_shadow_source.evidence(customer_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $func$
 SELECT jsonb_build_object('contact_id',c.id,'messages',(
   SELECT coalesce(jsonb_agg(row_to_json(m) ORDER BY m.occurred_at,m.source_id),'[]'::jsonb)
   FROM (
    SELECT source_id,direction,occurred_at,CASE WHEN octet_length(body)<=2000 THEN body ELSE NULL END AS body
    FROM public.crm_contact_timeline
    WHERE contact_id=c.id AND org_id=c.org_id AND kind='message'
      AND direction IN ('inbound','outbound') AND occurred_at>=now()-interval '30 days'
    ORDER BY occurred_at DESC,source_id DESC LIMIT 25
   ) m
 ),'baseline_tags',(
  SELECT coalesce(jsonb_agg(x.name),'[]'::jsonb) FROM (
   SELECT t.name FROM public.crm_contact_tags ct JOIN public.crm_tags t ON t.id=ct.tag_id AND t.org_id=ct.org_id
   WHERE ct.contact_id=c.id AND ct.org_id=c.org_id AND t.scope='crm' ORDER BY t.id LIMIT 20
  ) x
 ))
 FROM public.crm_contacts c
 WHERE c.id=customer_id AND c.deleted_at IS NULL
   AND c.org_id=(SELECT id::text FROM public.organizations WHERE slug='faces-sculptors')
$func$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA jev_shadow_source FROM PUBLIC;
GRANT USAGE ON SCHEMA jev_shadow_source TO minion_jev_shadow;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA jev_shadow_source TO minion_jev_shadow;
