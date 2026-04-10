-- SEC: Add userId + tenantId ownership columns to workshop_saves and flows
-- Existing rows get NULL (treated as legacy shared resources accessible to admins only)

ALTER TABLE workshop_saves ADD COLUMN user_id TEXT;
ALTER TABLE workshop_saves ADD COLUMN tenant_id TEXT;

ALTER TABLE flows ADD COLUMN user_id TEXT;
ALTER TABLE flows ADD COLUMN tenant_id TEXT;
