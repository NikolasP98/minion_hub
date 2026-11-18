-- Child-local canonical auth prerequisite (source: reconciliation-harness.ts restoreSupportedBaseline).
-- Test fixture only. Roles are cluster-level and are ensured by operator-native-auth-fixture.ts first.
CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO postgres;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO supabase_auth_admin;
SET ROLE supabase_auth_admin;
REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, dashboard_user;
RESET ROLE;
REVOKE USAGE ON SCHEMA auth FROM supabase_auth_admin;
