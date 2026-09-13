import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260913200000_security_hardening.sql', import.meta.url),
  'utf8',
);
let db: PGlite;

/** A miniature of the production shapes the migration touches: an auth.uid()
 *  stub, browser roles, two auth.uid() policies (USING-only and CHECK-only),
 *  a SECURITY DEFINER view granted to the browser roles, the three RPC-exposed
 *  definer functions, an unpinned function and the broadcast trigger function. */
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth; CREATE SCHEMA realtime;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE ROLE app_ledger NOLOGIN;
    CREATE TABLE messages (id text PRIMARY KEY, org_id text NOT NULL, client_id text, channel text, account_id text, chat_id text, direction text, content text, agent_id text, metadata jsonb, occurred_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE TABLE crm_contact_identities (org_id text, channel text, external_id text, contact_id uuid);
    CREATE TABLE crm_activities (id text, org_id text, contact_id uuid, kind text, body text, data jsonb, occurred_at timestamptz);
    CREATE TABLE profiles (id uuid PRIMARY KEY, role text);
    CREATE TABLE join_request (id serial PRIMARY KEY, supabase_id uuid);
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE join_request ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profiles_self_select ON profiles FOR SELECT TO public USING (auth.uid() = id);
    CREATE POLICY join_request_self_insert ON join_request FOR INSERT TO public WITH CHECK (auth.uid() = supabase_id);
    CREATE POLICY profiles_admin_all ON profiles FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
    CREATE VIEW crm_contact_timeline WITH (security_invoker = off) AS
      SELECT ci.contact_id, m.org_id, m.id AS source_id FROM messages m
      JOIN crm_contact_identities ci ON ci.org_id = m.org_id AND ci.channel = m.channel AND ci.external_id = m.chat_id;
    GRANT SELECT ON crm_contact_timeline TO anon, authenticated, app_ledger;
    CREATE FUNCTION crm_refresh_sentiment_chat_daily(p_org_id text, p_from date, p_to date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END $$;
    CREATE FUNCTION crm_refresh_word_frequency_daily(p_from date, p_to date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END $$;
    CREATE FUNCTION rls_auto_enable() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END $$;
    GRANT EXECUTE ON FUNCTION crm_refresh_sentiment_chat_daily(text,date,date), crm_refresh_word_frequency_daily(date,date), rls_auto_enable() TO anon, authenticated, service_role;
    CREATE FUNCTION job_effect_vectors_valid(v jsonb, n integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
    CREATE FUNCTION hub_broadcast_message_committed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$ begin return null; end $$;
    CREATE TRIGGER messages_realtime_broadcast AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION hub_broadcast_message_committed();
  `);
  await db.exec(migration);
  await db.exec(migration); // idempotent
});
afterAll(async () => {
  await db?.close();
});

const policy = async (name: string) =>
  (
    await db.query<{ qual: string | null; with_check: string | null }>(
      'SELECT qual, with_check FROM pg_policies WHERE policyname = $1',
      [name],
    )
  ).rows[0];

describe('20260913200000 security hardening', () => {
  it('rewrites every auth.uid() policy predicate into an InitPlan and leaves already-wrapped ones alone', async () => {
    expect((await policy('profiles_self_select')).qual).toMatch(/\(\s*SELECT auth\.uid\(\)/i);
    expect((await policy('join_request_self_insert')).with_check).toMatch(
      /\(\s*SELECT auth\.uid\(\)/i,
    );
    const admin = await policy('profiles_admin_all');
    expect(admin.qual).toMatch(/\(\s*SELECT auth\.uid\(\)/i);
    expect(admin.with_check).toMatch(/\(\s*SELECT auth\.uid\(\)/i);
    // the second run found nothing left to rewrite: no double wrapping
    expect((await policy('profiles_self_select')).qual).not.toMatch(/select\s*\(\s*select/i);
    const roles = await db.query<{ roles: string }>(
      "SELECT roles::text AS roles FROM pg_policies WHERE policyname = 'profiles_admin_all'",
    );
    expect(roles.rows[0].roles).toBe('{authenticated}');
  });
  it('makes the timeline view run as the invoker and revokes browser roles', async () => {
    const opts = await db.query<{ reloptions: string[] | null }>(
      "SELECT reloptions FROM pg_class WHERE relname = 'crm_contact_timeline'",
    );
    expect(opts.rows[0].reloptions).toContain('security_invoker=on');
    const priv = await db.query<{ anon: boolean; authenticated: boolean; ledger: boolean }>(
      `SELECT has_table_privilege('anon','crm_contact_timeline','SELECT') AS anon,
              has_table_privilege('authenticated','crm_contact_timeline','SELECT') AS authenticated,
              has_table_privilege('app_ledger','crm_contact_timeline','SELECT') AS ledger`,
    );
    expect(priv.rows[0]).toEqual({ anon: false, authenticated: false, ledger: true });
  });
  it('revokes RPC execution of the definer maintenance functions from browser roles only', async () => {
    const priv = await db.query<{
      fn: string;
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(
      `SELECT f AS fn, has_function_privilege('anon', f, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', f, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', f, 'EXECUTE') AS service
       FROM unnest(ARRAY['crm_refresh_sentiment_chat_daily(text,date,date)','crm_refresh_word_frequency_daily(date,date)','rls_auto_enable()']) f`,
    );
    for (const row of priv.rows)
      expect(row).toMatchObject({ anon: false, authenticated: false, service: true });
  });
  it('pins job_effect_vectors_valid search_path and guards the broadcast on the partition', async () => {
    const cfg = await db.query<{ proconfig: string[] | null }>(
      "SELECT proconfig FROM pg_proc WHERE proname = 'job_effect_vectors_valid'",
    );
    expect(cfg.rows[0].proconfig?.join(';')).toMatch(/search_path=pg_catalog, public/);
    const body = await db.query<{ src: string }>(
      "SELECT prosrc AS src FROM pg_proc WHERE proname = 'hub_broadcast_message_committed'",
    );
    expect(body.rows[0].src).toMatch(/to_regclass\('realtime\.messages_'/);
    // no partition exists here: the insert must succeed silently instead of raising
    await db.exec("INSERT INTO messages(id, org_id) VALUES ('m1', 'org')");
    expect(
      (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM messages')).rows[0].n,
    ).toBe(1);
  });
});
