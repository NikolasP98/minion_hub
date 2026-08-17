-- CRM customers server pagination (spec 2026-08-13-crm-customers-server-pagination §4).
-- ADDITIVE INDEXES ONLY — no table, column or type is touched, so this carries no
-- cross-repo schema impact (minion_site shares the DB; @minion-stack/db is untouched).
--
-- 🚨 A1: `create index concurrently` is DELIBERATELY NOT USED. scripts/db-migrate.ts
-- applies every file inside ONE transaction under pg_advisory_xact_lock(826744), and
-- Postgres rejects CREATE INDEX CONCURRENTLY inside a transaction block — it would abort
-- the production Vercel build. At the current CRM scale (~15–17k rows) a plain
-- `create index` locks writes on crm_contacts for well under a second. If crm_contacts
-- ever grows by an order of magnitude, switch to the out-of-band psql + no-op-migration
-- path documented in the spec's A1 mitigation 2.

create extension if not exists pg_trgm;

-- Serves the roster search's `display_name ilike '%q%'`. Indexed on the RAW column, not
-- `lower(display_name)`: pg_trgm answers ILIKE from a plain `gin (col gin_trgm_ops)`
-- index, while a `lower(...)` expression index only matches a `lower(col) like …`
-- predicate and would never be chosen for the query we actually ship.
create index if not exists crm_contacts_display_name_trgm
  on crm_contacts using gin (display_name gin_trgm_ops);

-- Every ranked read starts from `where org_id = … and deleted_at is null`.
create index if not exists crm_contacts_org_deleted_idx
  on crm_contacts (org_id) where deleted_at is null;

-- The search now also matches `custom_fields->>'telefono'` and `->>'dni'` as EXACT
-- PREFIXES (mirrors the gateway `crm_search` tool). text_pattern_ops is what makes a
-- `like 'q%'` predicate index-usable regardless of the database collation.
create index if not exists crm_contacts_telefono_prefix_idx
  on crm_contacts ((custom_fields ->> 'telefono') text_pattern_ops)
  where deleted_at is null;
create index if not exists crm_contacts_dni_prefix_idx
  on crm_contacts ((custom_fields ->> 'dni') text_pattern_ops)
  where deleted_at is null;
