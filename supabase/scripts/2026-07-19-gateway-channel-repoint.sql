-- ⛔ NOT A MIGRATION. NOT AUTO-APPLIED. Review, fill the ⛔ placeholders, run by hand.
-- Lives outside supabase/migrations/ deliberately so `db:migrate` never picks it up.
--
-- Row repoint for spec 2026-07-19 §4.1 (build channels DEV/PRD).
-- PREREQUISITE: 20260719210000_gateway_channel_lease.sql must be applied first.
--
-- ⚠️ MERGE ORDER MATTERS. The hub code on feat/build-channels scopes gateway
-- visibility to the ACTIVE ORG and fails closed. PINONITE has NO gateway row
-- today, so merging the code WITHOUT running this script leaves every PINONITE
-- user with zero reachable gateways. Run this first, or merge both together.
--
-- Measured starting state (2026-07-19, verified — do not re-guess):
--   minion-1  870bd8f1…  wss://gateway.minion-ai.org               org MINION   c9e8dc46…
--   minion-2  a64274a8…  wss://netcup.donkey-agama.ts.net:10000    org FACES    21e0601b…
--   PINONITE  3e721e98…  has no row.
--   user_gateway links all 7 users to BOTH rows.

begin;

-- ── 0. Placeholders ─────────────────────────────────────────────────────────
-- ⛔ netcup `default` service direct route. `wss://gateway.minion-ai.org` is the
--    Cloudflare route that returns /health 200 but REFUSES the WS upgrade — it is
--    the root cause of the all-day intermittency and must not survive this script.
--    Fill in the tailnet/public route that actually carries an upgrade (WP-A/§2.2b:
--    netcup is reachable at 152.53.91.108; the tailnet name hung when probed).
\set netcup_default_url 'wss://⛔FILL-ME⛔'
-- ⛔ protopi DEV route. Port is chosen in WP-A step A0 (18789/18790 looked free but
--    the scan was truncated — confirm on the host before filling this in).
\set protopi_dev_url    'wss://protopi.donkey-agama.ts.net:⛔PORT⛔'

-- ── 1. FACES prd — rename only, URL and token unchanged ─────────────────────
update public.gateway
   set name = 'faces-prd', channel = 'prd'
 where id = 'a64274a8-0000-0000-0000-000000000000';  -- ⛔ full uuid of minion-2

-- ── 2. MINION prd — repoint off the dead Cloudflare route ───────────────────
update public.gateway
   set name = 'minion-prd', channel = 'prd', url = :'netcup_default_url'
 where id = '870bd8f1-0000-0000-0000-000000000000';  -- ⛔ full uuid of minion-1

-- ── 3. PINONITE prd — NEW row, same instance as MINION-prd ──────────────────
-- A row is an ASSIGNMENT, not ownership: this shares the netcup `default`
-- instance (and therefore its token) with MINION-prd. That is intentional and is
-- exactly why gateway_uniq_url was dropped.
insert into public.gateway (org_id, name, url, channel, token_ciphertext, token_iv, auth_mode)
select '3e721e98-0000-0000-0000-000000000000'::uuid,  -- ⛔ full uuid of PINONITE
       'pinonite-prd', g.url, 'prd', g.token_ciphertext, g.token_iv, g.auth_mode
  from public.gateway g
 where g.id = '870bd8f1-0000-0000-0000-000000000000'  -- ⛔ MINION-prd, post step 2
on conflict do nothing;

-- ── 4. DEV rows on protopi ──────────────────────────────────────────────────
-- ⛔ token_ciphertext/token_iv: the hub encrypts tokens with its own key, so the
--    protopi token CANNOT be inserted as plaintext here. Create these two rows via
--    the hub (Settings → Gateways → Add) with the token recorded in WP-A step A5,
--    then run step 5 to stamp the channel. The inserts below are shown for review
--    of the intended shape only and are commented out.
-- insert into public.gateway (org_id, name, url, channel) values
--   ('c9e8dc46-…'::uuid, 'minion-dev',   :'protopi_dev_url', 'dev'),
--   ('3e721e98-…'::uuid, 'pinonite-dev', :'protopi_dev_url', 'dev');

-- ── 5. Stamp channel on the hub-created DEV rows ────────────────────────────
update public.gateway set channel = 'dev' where url = :'protopi_dev_url';

-- ── 6. Verify before commit ─────────────────────────────────────────────────
-- Expect exactly 5 rows: 3 prd (faces, minion, pinonite) + 2 dev (minion, pinonite).
-- Every row must have a non-null org_id — an org_id-less row is invisible to the
-- org-scoped reader and would silently strand whoever depended on it.
select channel, org_id, name, url, token_ciphertext <> '' as has_token
  from public.gateway order by channel, name;

-- commit;   -- ⛔ uncomment only after the SELECT above matches §4.1
rollback;

-- ── 7. Hygiene, NOT security (run separately, after 1–6 are committed) ──────
-- user_gateway links all 7 users to both legacy rows. Visibility is now ANDed
-- with the active org server-side, so this sprawl no longer leaks anything — it
-- just makes the table lie about intent. Prune it to org membership when
-- convenient; deleting rows a user still needs costs them their connection, so
-- this is deliberately not part of the transaction above.
--
-- delete from public.user_gateway ug
--  using public.gateway g
--  where ug.gateway_id = g.id
--    and not exists (
--      select 1 from public.org_members m
--       where m.user_id = ug.profile_id and m.org_id = g.org_id
--    );
